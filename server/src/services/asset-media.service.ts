import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { extname } from 'node:path';
import sanitize from 'sanitize-filename';
import { StorageCore } from 'src/cores/storage.core';
import { Asset } from 'src/database';
import {
  AssetBulkUploadCheckResponseDto,
  AssetMediaResponseDto,
  AssetMediaStatus,
  AssetRejectReason,
  AssetUploadAction,
  CheckExistingAssetsResponseDto,
} from 'src/dtos/asset-media-response.dto';
import {
  AssetBulkUploadCheckDto,
  AssetMediaCreateDto,
  AssetMediaOptionsDto,
  AssetMediaReplaceDto,
  AssetMediaSize,
  CheckExistingAssetsDto,
  UploadFieldName,
} from 'src/dtos/asset-media.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { AssetStatus, AssetType, AssetVisibility, CacheControl, JobName, Permission, StorageFolder } from 'src/enum';
import { AuthRequest } from 'src/middleware/auth.guard';
import { BaseService } from 'src/services/base.service';
import { UploadFile, UploadRequest } from 'src/types';
import { requireUploadAccess } from 'src/utils/access';
import { asUploadRequest, getAssetFiles, onBeforeLink } from 'src/utils/asset.util';
import { isAssetChecksumConstraint } from 'src/utils/database';
import { getFilenameExtension, getFileNameWithoutExtension, ImmichFileResponse } from 'src/utils/file';
import { mimeTypes } from 'src/utils/mime-types';
import { fromChecksum } from 'src/utils/request';

export interface AssetMediaRedirectResponse {
  targetSize: AssetMediaSize | 'original';
}

@Injectable()
export class AssetMediaService extends BaseService {
  async getUploadAssetIdByChecksum(auth: AuthDto, checksum?: string): Promise<AssetMediaResponseDto | undefined> {
    if (!checksum) {
      return;
    }

    const assetId = await this.assetRepository.getUploadAssetIdByChecksum(auth.user.id, fromChecksum(checksum));
    if (!assetId) {
      return;
    }

    return { id: assetId, status: AssetMediaStatus.DUPLICATE };
  }

  canUploadFile({ auth, fieldName, file, body }: UploadRequest): true {
    requireUploadAccess(auth);

    const filename = body.filename || file.originalName;

    switch (fieldName) {
      case UploadFieldName.ASSET_DATA: {
        if (mimeTypes.isAsset(filename)) {
          return true;
        }
        break;
      }

      case UploadFieldName.SIDECAR_DATA: {
        if (mimeTypes.isSidecar(filename)) {
          return true;
        }
        break;
      }

      case UploadFieldName.PROFILE_DATA: {
        if (mimeTypes.isProfile(filename)) {
          return true;
        }
        break;
      }
    }

    this.logger.error(`Unsupported file type ${filename}`);
    throw new BadRequestException(`Unsupported file type ${filename}`);
  }

  getUploadFilename({ auth, fieldName, file, body }: UploadRequest): string {
    requireUploadAccess(auth);

    const extension = extname(body.filename || file.originalName);

    const lookup = {
      [UploadFieldName.ASSET_DATA]: extension,
      [UploadFieldName.SIDECAR_DATA]: '.xmp',
      [UploadFieldName.PROFILE_DATA]: extension,
    };

    return sanitize(`${file.uuid}${lookup[fieldName]}`);
  }

  getUploadFolder({ auth, fieldName, file }: UploadRequest): string {
    auth = requireUploadAccess(auth);

    let folder = StorageCore.getNestedFolder(StorageFolder.Upload, auth.user.id, file.uuid);
    if (fieldName === UploadFieldName.PROFILE_DATA) {
      folder = StorageCore.getFolderLocation(StorageFolder.Profile, auth.user.id);
    }

    this.storageRepository.mkdirSync(folder);

    return folder;
  }

  async onUploadError(request: AuthRequest, file: Express.Multer.File) {
    const uploadFilename = this.getUploadFilename(asUploadRequest(request, file));
    const uploadFolder = this.getUploadFolder(asUploadRequest(request, file));
    const uploadPath = `${uploadFolder}/${uploadFilename}`;

    await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [uploadPath] } });
  }

  async uploadAsset(
    auth: AuthDto,
    dto: AssetMediaCreateDto,
    file: UploadFile,
    sidecarFile?: UploadFile,
  ): Promise<AssetMediaResponseDto> {
    try {
      await this.requireAccess({
        auth,
        permission: Permission.AssetUpload,
        // do not need an id here, but the interface requires it
        ids: [auth.user.id],
      });

      this.requireQuota(auth, file.size);

      if (dto.livePhotoVideoId) {
        await onBeforeLink(
          { asset: this.assetRepository, event: this.eventRepository },
          { userId: auth.user.id, livePhotoVideoId: dto.livePhotoVideoId },
        );
      }
      const asset = await this.create(auth.user.id, dto, file, sidecarFile);

      await this.userRepository.updateUsage(auth.user.id, file.size);

      return { id: asset.id, status: AssetMediaStatus.CREATED };
    } catch (error: any) {
      return this.handleUploadError(error, auth, file, sidecarFile);
    }
  }

  async replaceAsset(
    auth: AuthDto,
    id: string,
    dto: AssetMediaReplaceDto,
    file: UploadFile,
    sidecarFile?: UploadFile,
  ): Promise<AssetMediaResponseDto> {
    try {
      await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [id] });
      const asset = await this.assetRepository.getById(id);

      if (!asset) {
        throw new Error('Asset not found');
      }

      this.requireQuota(auth, file.size);

      await this.replaceFileData(asset.id, dto, file, sidecarFile?.originalPath);

      // Next, create a backup copy of the existing record. The db record has already been updated above,
      // but the local variable holds the original file data paths.
      const copiedPhoto = await this.createCopy(asset);
      // and immediate trash it
      await this.assetRepository.updateAll([copiedPhoto.id], { deletedAt: new Date(), status: AssetStatus.Trashed });
      await this.eventRepository.emit('AssetTrash', { assetId: copiedPhoto.id, userId: auth.user.id });

      await this.userRepository.updateUsage(auth.user.id, file.size);

      return { status: AssetMediaStatus.REPLACED, id: copiedPhoto.id };
    } catch (error: any) {
      return this.handleUploadError(error, auth, file, sidecarFile);
    }
  }

  async downloadOriginal(auth: AuthDto, id: string): Promise<ImmichFileResponse> {
    await this.requireAccess({ auth, permission: Permission.AssetDownload, ids: [id] });

    const asset = await this.findOrFail(id);

    return new ImmichFileResponse({
      path: asset.originalPath,
      fileName: asset.originalFileName,
      contentType: mimeTypes.lookup(asset.originalPath),
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  async viewThumbnail(
    auth: AuthDto,
    id: string,
    dto: AssetMediaOptionsDto,
  ): Promise<ImmichFileResponse | AssetMediaRedirectResponse> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [id] });

    const asset = await this.findOrFail(id);
    const size = dto.size ?? AssetMediaSize.THUMBNAIL;

    const { thumbnailFile, previewFile, fullsizeFile } = getAssetFiles(asset.files ?? []);
    let filepath = previewFile?.path;
    if (size === AssetMediaSize.THUMBNAIL && thumbnailFile) {
      filepath = thumbnailFile.path;
    } else if (size === AssetMediaSize.FULLSIZE) {
      if (mimeTypes.isWebSupportedImage(asset.originalPath)) {
        // use original file for web supported images
        return { targetSize: 'original' };
      }
      if (!fullsizeFile) {
        // downgrade to preview if fullsize is not available.
        // e.g. disabled or not yet (re)generated
        return { targetSize: AssetMediaSize.PREVIEW };
      }
      filepath = fullsizeFile.path;
    }

    if (!filepath) {
      throw new NotFoundException('Asset media not found');
    }
    let fileName = getFileNameWithoutExtension(asset.originalFileName);
    fileName += `_${size}`;
    fileName += getFilenameExtension(filepath);

    return new ImmichFileResponse({
      fileName,
      path: filepath,
      contentType: mimeTypes.lookup(filepath),
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  async playbackVideo(auth: AuthDto, id: string): Promise<ImmichFileResponse> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [id] });

    const asset = await this.findOrFail(id);

    if (asset.type !== AssetType.Video) {
      throw new BadRequestException('Asset is not a video');
    }

    const filepath = asset.encodedVideoPath || asset.originalPath;

    return new ImmichFileResponse({
      path: filepath,
      contentType: mimeTypes.lookup(filepath),
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  async documentPdf(auth: AuthDto, id: string): Promise<ImmichFileResponse> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [id] });

    const asset = await this.findOrFail(id);

    // If it's already a PDF, return the original
    if (mimeTypes.isPdf(asset.originalPath)) {
      return new ImmichFileResponse({
        path: asset.originalPath,
        fileName: asset.originalFileName,
        contentType: 'application/pdf',
        cacheControl: CacheControl.PrivateWithCache,
      });
    }

    // For Office documents, convert to PDF using LibreOffice
    if (!mimeTypes.isDocument(asset.originalPath)) {
      throw new BadRequestException('Asset is not a document');
    }

    const pdfPath = await this.convertToPdf(asset);

    return new ImmichFileResponse({
      path: pdfPath,
      fileName: getFileNameWithoutExtension(asset.originalFileName) + '.pdf',
      contentType: 'application/pdf',
      cacheControl: CacheControl.PrivateWithCache,
    });
  }

  private async convertToPdf(asset: { id: string; originalPath: string }): Promise<string> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const execFileAsync = promisify(execFile);

    // Create temp directory for LibreOffice output
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-pdf-'));
    const sourceBasename = path.basename(asset.originalPath, path.extname(asset.originalPath));

    try {
      // Convert Office document to PDF using LibreOffice
      const harfbuzzPath = process.arch === 'arm64'
        ? '/lib/aarch64-linux-gnu/libharfbuzz.so.0'
        : '/lib/x86_64-linux-gnu/libharfbuzz.so.0';

      // Create unique user profile to allow concurrent LibreOffice instances
      const userProfileDir = path.join(tempDir, `lo-profile-${asset.id}`);
      await fs.mkdir(userProfileDir, { recursive: true });

      await execFileAsync('/usr/bin/libreoffice', [
        '--headless',
        `-env:UserInstallation=file://${userProfileDir}`,
        '--convert-to', 'pdf',
        '--outdir', tempDir,
        asset.originalPath,
      ], {
        timeout: 120000, // 2 minute timeout for full document conversion
        env: {
          ...process.env,
          LD_PRELOAD: harfbuzzPath,
        },
      });

      // Clean up user profile directory
      await fs.rm(userProfileDir, { recursive: true, force: true }).catch(() => {});

      // LibreOffice creates PDF with same basename as input file
      const convertedPdfPath = path.join(tempDir, `${sourceBasename}.pdf`);

      // Check if the converted PDF exists
      await fs.access(convertedPdfPath);

      return convertedPdfPath;
    } catch (error: unknown) {
      // Clean up temp directory on error
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`Failed to convert document to PDF: ${errorMessage}`);
    }
  }

  async checkExistingAssets(
    auth: AuthDto,
    checkExistingAssetsDto: CheckExistingAssetsDto,
  ): Promise<CheckExistingAssetsResponseDto> {
    const existingIds = await this.assetRepository.getByDeviceIds(
      auth.user.id,
      checkExistingAssetsDto.deviceId,
      checkExistingAssetsDto.deviceAssetIds,
    );
    return { existingIds };
  }

  async bulkUploadCheck(auth: AuthDto, dto: AssetBulkUploadCheckDto): Promise<AssetBulkUploadCheckResponseDto> {
    const checksums: Buffer[] = dto.assets.map((asset) => fromChecksum(asset.checksum));
    const results = await this.assetRepository.getByChecksums(auth.user.id, checksums);
    const checksumMap: Record<string, { id: string; isTrashed: boolean }> = {};

    for (const { id, deletedAt, checksum } of results) {
      checksumMap[checksum.toString('hex')] = { id, isTrashed: !!deletedAt };
    }

    return {
      results: dto.assets.map(({ id, checksum }) => {
        const duplicate = checksumMap[fromChecksum(checksum).toString('hex')];
        if (duplicate) {
          return {
            id,
            action: AssetUploadAction.REJECT,
            reason: AssetRejectReason.DUPLICATE,
            assetId: duplicate.id,
            isTrashed: duplicate.isTrashed,
          };
        }

        return {
          id,
          action: AssetUploadAction.ACCEPT,
        };
      }),
    };
  }

  private async handleUploadError(
    error: any,
    auth: AuthDto,
    file: UploadFile,
    sidecarFile?: UploadFile,
  ): Promise<AssetMediaResponseDto> {
    // clean up files
    await this.jobRepository.queue({
      name: JobName.FileDelete,
      data: { files: [file.originalPath, sidecarFile?.originalPath] },
    });

    // handle duplicates with a success response
    if (isAssetChecksumConstraint(error)) {
      const duplicateId = await this.assetRepository.getUploadAssetIdByChecksum(auth.user.id, file.checksum);
      if (!duplicateId) {
        this.logger.error(`Error locating duplicate for checksum constraint`);
        throw new InternalServerErrorException();
      }
      return { status: AssetMediaStatus.DUPLICATE, id: duplicateId };
    }

    this.logger.error(`Error uploading file ${error}`, error?.stack);
    throw error;
  }

  /**
   * Updates the specified assetId to the specified photo data file properties: checksum, path,
   * timestamps, deviceIds, and sidecar. Derived properties like: faces, smart search info, etc
   * are UNTOUCHED. The photo data files modification times on the filesysytem are updated to
   * the specified timestamps. The exif db record is upserted, and then A METADATA_EXTRACTION
   * job is queued to update these derived properties.
   */
  private async replaceFileData(
    assetId: string,
    dto: AssetMediaReplaceDto,
    file: UploadFile,
    sidecarPath?: string,
  ): Promise<void> {
    await this.assetRepository.update({
      id: assetId,

      checksum: file.checksum,
      originalPath: file.originalPath,
      type: mimeTypes.assetType(file.originalPath),
      originalFileName: file.originalName,

      deviceAssetId: dto.deviceAssetId,
      deviceId: dto.deviceId,
      fileCreatedAt: dto.fileCreatedAt,
      fileModifiedAt: dto.fileModifiedAt,
      localDateTime: dto.fileCreatedAt,
      duration: dto.duration || null,

      livePhotoVideoId: null,
      sidecarPath: sidecarPath || null,
    });

    await this.storageRepository.utimes(file.originalPath, new Date(), new Date(dto.fileModifiedAt));
    await this.assetRepository.upsertExif({ assetId, fileSizeInByte: file.size });
    await this.jobRepository.queue({
      name: JobName.AssetExtractMetadata,
      data: { id: assetId, source: 'upload' },
    });
  }

  /**
   * Create a 'shallow' copy of the specified asset record creating a new asset record in the database.
   * Uses only vital properties excluding things like: stacks, faces, smart search info, etc,
   * and then queues a METADATA_EXTRACTION job.
   */
  private async createCopy(asset: Omit<Asset, 'id'>) {
    const created = await this.assetRepository.create({
      ownerId: asset.ownerId,
      originalPath: asset.originalPath,
      originalFileName: asset.originalFileName,
      libraryId: asset.libraryId,
      deviceAssetId: asset.deviceAssetId,
      deviceId: asset.deviceId,
      type: asset.type,
      checksum: asset.checksum,
      fileCreatedAt: asset.fileCreatedAt,
      localDateTime: asset.localDateTime,
      fileModifiedAt: asset.fileModifiedAt,
      livePhotoVideoId: asset.livePhotoVideoId,
      sidecarPath: asset.sidecarPath,
    });

    const { size } = await this.storageRepository.stat(created.originalPath);
    await this.assetRepository.upsertExif({ assetId: created.id, fileSizeInByte: size });
    await this.jobRepository.queue({ name: JobName.AssetExtractMetadata, data: { id: created.id, source: 'copy' } });
    return created;
  }

  private async create(ownerId: string, dto: AssetMediaCreateDto, file: UploadFile, sidecarFile?: UploadFile) {
    const asset = await this.assetRepository.create({
      ownerId,
      libraryId: null,

      checksum: file.checksum,
      originalPath: file.originalPath,

      deviceAssetId: dto.deviceAssetId,
      deviceId: dto.deviceId,

      fileCreatedAt: dto.fileCreatedAt,
      fileModifiedAt: dto.fileModifiedAt,
      localDateTime: dto.fileCreatedAt,

      type: mimeTypes.assetType(file.originalPath),
      isFavorite: dto.isFavorite,
      duration: dto.duration || null,
      visibility: dto.visibility ?? AssetVisibility.Timeline,
      livePhotoVideoId: dto.livePhotoVideoId,
      originalFileName: dto.filename || file.originalName,
      sidecarPath: sidecarFile?.originalPath,
    });

    if (dto.metadata) {
      await this.assetRepository.upsertMetadata(asset.id, dto.metadata);
    }

    if (sidecarFile) {
      await this.storageRepository.utimes(sidecarFile.originalPath, new Date(), new Date(dto.fileModifiedAt));
    }
    await this.storageRepository.utimes(file.originalPath, new Date(), new Date(dto.fileModifiedAt));
    await this.assetRepository.upsertExif({ assetId: asset.id, fileSizeInByte: file.size });

    await this.eventRepository.emit('AssetCreate', { asset });

    await this.jobRepository.queue({ name: JobName.AssetExtractMetadata, data: { id: asset.id, source: 'upload' } });

    return asset;
  }

  private requireQuota(auth: AuthDto, size: number) {
    if (auth.user.quotaSizeInBytes !== null && auth.user.quotaSizeInBytes < auth.user.quotaUsageInBytes + size) {
      throw new BadRequestException('Quota has been exceeded!');
    }
  }

  private async findOrFail(id: string) {
    const asset = await this.assetRepository.getById(id, { files: true });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    return asset;
  }
}
