import { Injectable } from '@nestjs/common';
import { FACE_THUMBNAIL_SIZE, JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { StorageCore, ThumbnailPathEntity } from 'src/cores/storage.core';
import { Exif } from 'src/database';
import { OnEvent, OnJob } from 'src/decorators';
import { SystemConfigFFmpegDto } from 'src/dtos/system-config.dto';
import {
  AssetFileType,
  AssetPathType,
  AssetType,
  AssetVisibility,
  AudioCodec,
  Colorspace,
  ImageFormat,
  JobName,
  JobStatus,
  LogLevel,
  QueueName,
  RawExtractedFormat,
  StorageFolder,
  TranscodeHardwareAcceleration,
  TranscodePolicy,
  TranscodeTarget,
  VideoCodec,
  VideoContainer,
} from 'src/enum';
import { BoundingBox } from 'src/repositories/machine-learning.repository';
import { BaseService } from 'src/services/base.service';
import {
  AudioStreamInfo,
  CropOptions,
  DecodeToBufferOptions,
  ImageDimensions,
  JobItem,
  JobOf,
  VideoFormat,
  VideoInterfaces,
  VideoStreamInfo,
} from 'src/types';
import { getAssetFiles } from 'src/utils/asset.util';
import { BaseConfig, ThumbnailConfig } from 'src/utils/media';
import { mimeTypes } from 'src/utils/mime-types';
import { clamp, isFaceImportEnabled, isFacialRecognitionEnabled } from 'src/utils/misc';
interface UpsertFileOptions {
  assetId: string;
  type: AssetFileType;
  path: string;
}

@Injectable()
export class MediaService extends BaseService {
  videoInterfaces: VideoInterfaces = { dri: [], mali: false };

  @OnEvent({ name: 'AppBootstrap' })
  async onBootstrap() {
    const [dri, mali] = await Promise.all([this.getDevices(), this.hasMaliOpenCL()]);
    this.videoInterfaces = { dri, mali };
  }

  @OnJob({ name: JobName.AssetGenerateThumbnailsQueueAll, queue: QueueName.ThumbnailGeneration })
  async handleQueueGenerateThumbnails({ force }: JobOf<JobName.AssetGenerateThumbnailsQueueAll>): Promise<JobStatus> {
    let jobs: JobItem[] = [];

    const queueAll = async () => {
      await this.jobRepository.queueAll(jobs);
      jobs = [];
    };

    for await (const asset of this.assetJobRepository.streamForThumbnailJob(!!force)) {
      const { previewFile, thumbnailFile } = getAssetFiles(asset.files);

      if (!previewFile || !thumbnailFile || !asset.thumbhash || force) {
        jobs.push({ name: JobName.AssetGenerateThumbnails, data: { id: asset.id } });
      }

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await queueAll();
      }
    }

    await queueAll();

    const people = this.personRepository.getAll(force ? undefined : { thumbnailPath: '' });

    for await (const person of people) {
      if (!person.faceAssetId) {
        const face = await this.personRepository.getRandomFace(person.id);
        if (!face) {
          continue;
        }

        await this.personRepository.update({ id: person.id, faceAssetId: face.id });
      }

      jobs.push({ name: JobName.PersonGenerateThumbnail, data: { id: person.id } });
      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await queueAll();
      }
    }

    await queueAll();

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.FileMigrationQueueAll, queue: QueueName.Migration })
  async handleQueueMigration(): Promise<JobStatus> {
    const { active, waiting } = await this.jobRepository.getJobCounts(QueueName.Migration);
    if (active === 1 && waiting === 0) {
      await this.storageCore.removeEmptyDirs(StorageFolder.Thumbnails);
      await this.storageCore.removeEmptyDirs(StorageFolder.EncodedVideo);
    }

    let jobs: JobItem[] = [];
    const assets = this.assetJobRepository.streamForMigrationJob();
    for await (const asset of assets) {
      jobs.push({ name: JobName.AssetFileMigration, data: { id: asset.id } });
      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    jobs = [];

    for await (const person of this.personRepository.getAll()) {
      jobs.push({ name: JobName.PersonFileMigration, data: { id: person.id } });

      if (jobs.length === JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetFileMigration, queue: QueueName.Migration })
  async handleAssetMigration({ id }: JobOf<JobName.AssetFileMigration>): Promise<JobStatus> {
    const { image } = await this.getConfig({ withCache: true });
    const asset = await this.assetJobRepository.getForMigrationJob(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    await this.storageCore.moveAssetImage(asset, AssetPathType.FullSize, image.fullsize.format);
    await this.storageCore.moveAssetImage(asset, AssetPathType.Preview, image.preview.format);
    await this.storageCore.moveAssetImage(asset, AssetPathType.Thumbnail, image.thumbnail.format);
    await this.storageCore.moveAssetVideo(asset);

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetGenerateThumbnails, queue: QueueName.ThumbnailGeneration })
  async handleGenerateThumbnails({ id }: JobOf<JobName.AssetGenerateThumbnails>): Promise<JobStatus> {
    const asset = await this.assetJobRepository.getForGenerateThumbnailJob(id);
    if (!asset) {
      this.logger.warn(`Thumbnail generation failed for asset ${id}: not found`);
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      this.logger.verbose(`Thumbnail generation skipped for asset ${id}: not visible`);
      return JobStatus.Skipped;
    }

    let generated: {
      previewPath: string;
      thumbnailPath: string;
      fullsizePath?: string;
      thumbhash: Buffer;
      exifImageWidth?: number;
      exifImageHeight?: number;
    };
    if (asset.type === AssetType.Video || asset.originalFileName.toLowerCase().endsWith('.gif')) {
      generated = await this.generateVideoThumbnails(asset);
    } else if (asset.type === AssetType.Image) {
      generated = await this.generateImageThumbnails(asset);
    } else if (asset.type === AssetType.Document) {
      generated = await this.generateDocumentThumbnails(asset);
    } else {
      this.logger.warn(`Skipping thumbnail generation for asset ${id}: ${asset.type} is not an image, video, or document`);
      return JobStatus.Skipped;
    }

    const { previewFile, thumbnailFile, fullsizeFile } = getAssetFiles(asset.files);
    const toUpsert: UpsertFileOptions[] = [];
    if (previewFile?.path !== generated.previewPath) {
      toUpsert.push({ assetId: asset.id, path: generated.previewPath, type: AssetFileType.Preview });
    }

    if (thumbnailFile?.path !== generated.thumbnailPath) {
      toUpsert.push({ assetId: asset.id, path: generated.thumbnailPath, type: AssetFileType.Thumbnail });
    }

    if (generated.fullsizePath && fullsizeFile?.path !== generated.fullsizePath) {
      toUpsert.push({ assetId: asset.id, path: generated.fullsizePath, type: AssetFileType.FullSize });
    }

    if (toUpsert.length > 0) {
      await this.assetRepository.upsertFiles(toUpsert);
    }

    const pathsToDelete: string[] = [];
    if (previewFile && previewFile.path !== generated.previewPath) {
      this.logger.debug(`Deleting old preview for asset ${asset.id}`);
      pathsToDelete.push(previewFile.path);
    }

    if (thumbnailFile && thumbnailFile.path !== generated.thumbnailPath) {
      this.logger.debug(`Deleting old thumbnail for asset ${asset.id}`);
      pathsToDelete.push(thumbnailFile.path);
    }

    if (fullsizeFile && fullsizeFile.path !== generated.fullsizePath) {
      this.logger.debug(`Deleting old fullsize preview image for asset ${asset.id}`);
      pathsToDelete.push(fullsizeFile.path);
      if (!generated.fullsizePath) {
        // did not generate a new fullsize image, delete the existing record
        await this.assetRepository.deleteFiles([fullsizeFile]);
      }
    }

    if (pathsToDelete.length > 0) {
      await Promise.all(pathsToDelete.map((path) => this.storageRepository.unlink(path)));
    }

    if (!asset.thumbhash || Buffer.compare(asset.thumbhash, generated.thumbhash) !== 0) {
      await this.assetRepository.update({ id: asset.id, thumbhash: generated.thumbhash });
    }

    // Update EXIF dimensions for documents (PDFs) so the frontend can display thumbnails with correct aspect ratio
    if (generated.exifImageWidth && generated.exifImageHeight) {
      await this.assetRepository.upsertExif({
        assetId: asset.id,
        exifImageWidth: generated.exifImageWidth,
        exifImageHeight: generated.exifImageHeight,
      });
    }

    await this.assetRepository.upsertJobStatus({ assetId: asset.id, previewAt: new Date(), thumbnailAt: new Date() });

    return JobStatus.Success;
  }

  private async extractImage(originalPath: string, minSize: number) {
    let extracted = await this.mediaRepository.extract(originalPath);
    if (extracted && !(await this.shouldUseExtractedImage(extracted.buffer, minSize))) {
      extracted = null;
    }

    return extracted;
  }

  private async decodeImage(thumbSource: string | Buffer, exifInfo: Exif, targetSize?: number) {
    const { image } = await this.getConfig({ withCache: true });
    const colorspace = this.isSRGB(exifInfo) ? Colorspace.Srgb : image.colorspace;
    const decodeOptions: DecodeToBufferOptions = {
      colorspace,
      processInvalidImages: process.env.IMMICH_PROCESS_INVALID_IMAGES === 'true',
      size: targetSize,
      orientation: exifInfo.orientation ? Number(exifInfo.orientation) : undefined,
    };

    const { info, data } = await this.mediaRepository.decodeImage(thumbSource, decodeOptions);
    return { info, data, colorspace };
  }

  private async generateImageThumbnails(asset: {
    id: string;
    ownerId: string;
    originalFileName: string;
    originalPath: string;
    exifInfo: Exif;
  }) {
    const { image } = await this.getConfig({ withCache: true });
    const previewPath = StorageCore.getImagePath(asset, AssetPathType.Preview, image.preview.format);
    const thumbnailPath = StorageCore.getImagePath(asset, AssetPathType.Thumbnail, image.thumbnail.format);
    this.storageCore.ensureFolders(previewPath);

    // Handle embedded preview extraction for RAW files
    const extractEmbedded = image.extractEmbedded && mimeTypes.isRaw(asset.originalFileName);
    const extracted = extractEmbedded ? await this.extractImage(asset.originalPath, image.preview.size) : null;
    const generateFullsize =
      (image.fullsize.enabled || asset.exifInfo.projectionType == 'EQUIRECTANGULAR') &&
      !mimeTypes.isWebSupportedImage(asset.originalPath);
    const convertFullsize = generateFullsize && (!extracted || !mimeTypes.isWebSupportedImage(` .${extracted.format}`));

    const { info, data, colorspace } = await this.decodeImage(
      extracted ? extracted.buffer : asset.originalPath,
      // only specify orientation to extracted images which don't have EXIF orientation data
      // or it can double rotate the image
      extracted ? asset.exifInfo : { ...asset.exifInfo, orientation: null },
      convertFullsize ? undefined : image.preview.size,
    );

    // generate final images
    const thumbnailOptions = { colorspace, processInvalidImages: false, raw: info };
    const promises = [
      this.mediaRepository.generateThumbhash(data, thumbnailOptions),
      this.mediaRepository.generateThumbnail(data, { ...image.thumbnail, ...thumbnailOptions }, thumbnailPath),
      this.mediaRepository.generateThumbnail(data, { ...image.preview, ...thumbnailOptions }, previewPath),
    ];

    let fullsizePath: string | undefined;

    if (convertFullsize) {
      // convert a new fullsize image from the same source as the thumbnail
      fullsizePath = StorageCore.getImagePath(asset, AssetPathType.FullSize, image.fullsize.format);
      const fullsizeOptions = { format: image.fullsize.format, quality: image.fullsize.quality, ...thumbnailOptions };
      promises.push(this.mediaRepository.generateThumbnail(data, fullsizeOptions, fullsizePath));
    } else if (generateFullsize && extracted && extracted.format === RawExtractedFormat.Jpeg) {
      fullsizePath = StorageCore.getImagePath(asset, AssetPathType.FullSize, extracted.format);
      this.storageCore.ensureFolders(fullsizePath);

      // Write the buffer to disk with essential EXIF data
      await this.storageRepository.createOrOverwriteFile(fullsizePath, extracted.buffer);
      await this.mediaRepository.writeExif(
        {
          orientation: asset.exifInfo.orientation,
          colorspace: asset.exifInfo.colorspace,
        },
        fullsizePath,
      );
    }

    const outputs = await Promise.all(promises);

    if (asset.exifInfo.projectionType === 'EQUIRECTANGULAR') {
      const promises = [
        this.mediaRepository.copyTagGroup('XMP-GPano', asset.originalPath, previewPath),
        fullsizePath
          ? this.mediaRepository.copyTagGroup('XMP-GPano', asset.originalPath, fullsizePath)
          : Promise.resolve(),
      ];
      await Promise.all(promises);
    }

    return { previewPath, thumbnailPath, fullsizePath, thumbhash: outputs[0] as Buffer };
  }

  @OnJob({ name: JobName.PersonGenerateThumbnail, queue: QueueName.ThumbnailGeneration })
  async handleGeneratePersonThumbnail({ id }: JobOf<JobName.PersonGenerateThumbnail>): Promise<JobStatus> {
    const { machineLearning, metadata, image } = await this.getConfig({ withCache: true });
    if (!isFacialRecognitionEnabled(machineLearning) && !isFaceImportEnabled(metadata)) {
      return JobStatus.Skipped;
    }

    const data = await this.personRepository.getDataForThumbnailGenerationJob(id);
    if (!data) {
      this.logger.error(`Could not generate person thumbnail for ${id}: missing data`);
      return JobStatus.Failed;
    }

    const { ownerId, x1, y1, x2, y2, oldWidth, oldHeight, exifOrientation, previewPath, originalPath } = data;
    let inputImage: string | Buffer;
    if (data.type === AssetType.Video) {
      if (!previewPath) {
        this.logger.error(`Could not generate person thumbnail for video ${id}: missing preview path`);
        return JobStatus.Failed;
      }
      inputImage = previewPath;
    } else if (image.extractEmbedded && mimeTypes.isRaw(originalPath)) {
      const extracted = await this.extractImage(originalPath, image.preview.size);
      inputImage = extracted ? extracted.buffer : originalPath;
    } else {
      inputImage = originalPath;
    }

    const { data: decodedImage, info } = await this.mediaRepository.decodeImage(inputImage, {
      colorspace: image.colorspace,
      processInvalidImages: process.env.IMMICH_PROCESS_INVALID_IMAGES === 'true',
      // if this is an extracted image, it may not have orientation metadata
      orientation: Buffer.isBuffer(inputImage) && exifOrientation ? Number(exifOrientation) : undefined,
    });

    const thumbnailPath = StorageCore.getPersonThumbnailPath({ id, ownerId });
    this.storageCore.ensureFolders(thumbnailPath);

    const thumbnailOptions = {
      colorspace: image.colorspace,
      format: ImageFormat.Jpeg,
      raw: info,
      quality: image.thumbnail.quality,
      crop: this.getCrop(
        { old: { width: oldWidth, height: oldHeight }, new: { width: info.width, height: info.height } },
        { x1, y1, x2, y2 },
      ),
      processInvalidImages: false,
      size: FACE_THUMBNAIL_SIZE,
    };

    await this.mediaRepository.generateThumbnail(decodedImage, thumbnailOptions, thumbnailPath);
    await this.personRepository.update({ id, thumbnailPath });

    return JobStatus.Success;
  }

  private getCrop(dims: { old: ImageDimensions; new: ImageDimensions }, { x1, y1, x2, y2 }: BoundingBox): CropOptions {
    // face bounding boxes can spill outside the image dimensions
    const clampedX1 = clamp(x1, 0, dims.old.width);
    const clampedY1 = clamp(y1, 0, dims.old.height);
    const clampedX2 = clamp(x2, 0, dims.old.width);
    const clampedY2 = clamp(y2, 0, dims.old.height);

    const widthScale = dims.new.width / dims.old.width;
    const heightScale = dims.new.height / dims.old.height;

    const halfWidth = (widthScale * (clampedX2 - clampedX1)) / 2;
    const halfHeight = (heightScale * (clampedY2 - clampedY1)) / 2;

    const middleX = Math.round(widthScale * clampedX1 + halfWidth);
    const middleY = Math.round(heightScale * clampedY1 + halfHeight);

    // zoom out 10%
    const targetHalfSize = Math.floor(Math.max(halfWidth, halfHeight) * 1.1);

    // get the longest distance from the center of the image without overflowing
    const newHalfSize = Math.min(
      middleX - Math.max(0, middleX - targetHalfSize),
      middleY - Math.max(0, middleY - targetHalfSize),
      Math.min(dims.new.width - 1, middleX + targetHalfSize) - middleX,
      Math.min(dims.new.height - 1, middleY + targetHalfSize) - middleY,
    );

    return {
      left: middleX - newHalfSize,
      top: middleY - newHalfSize,
      width: newHalfSize * 2,
      height: newHalfSize * 2,
    };
  }

  private async generateVideoThumbnails(asset: ThumbnailPathEntity & { originalPath: string }) {
    const { image, ffmpeg } = await this.getConfig({ withCache: true });
    const previewPath = StorageCore.getImagePath(asset, AssetPathType.Preview, image.preview.format);
    const thumbnailPath = StorageCore.getImagePath(asset, AssetPathType.Thumbnail, image.thumbnail.format);
    this.storageCore.ensureFolders(previewPath);

    const { format, audioStreams, videoStreams } = await this.mediaRepository.probe(asset.originalPath);
    const mainVideoStream = this.getMainStream(videoStreams);
    if (!mainVideoStream) {
      throw new Error(`No video streams found for asset ${asset.id}`);
    }
    const mainAudioStream = this.getMainStream(audioStreams);

    const previewConfig = ThumbnailConfig.create({ ...ffmpeg, targetResolution: image.preview.size.toString() });
    const thumbnailConfig = ThumbnailConfig.create({ ...ffmpeg, targetResolution: image.thumbnail.size.toString() });
    const previewOptions = previewConfig.getCommand(TranscodeTarget.Video, mainVideoStream, mainAudioStream, format);
    const thumbnailOptions = thumbnailConfig.getCommand(
      TranscodeTarget.Video,
      mainVideoStream,
      mainAudioStream,
      format,
    );

    await this.mediaRepository.transcode(asset.originalPath, previewPath, previewOptions);
    await this.mediaRepository.transcode(asset.originalPath, thumbnailPath, thumbnailOptions);

    const thumbhash = await this.mediaRepository.generateThumbhash(previewPath, {
      colorspace: image.colorspace,
      processInvalidImages: process.env.IMMICH_PROCESS_INVALID_IMAGES === 'true',
    });

    return { previewPath, thumbnailPath, thumbhash };
  }

  private async generateDocumentThumbnails(asset: ThumbnailPathEntity & { originalPath: string }) {
    const { image } = await this.getConfig({ withCache: true });
    const previewPath = StorageCore.getImagePath(asset, AssetPathType.Preview, image.preview.format);
    const thumbnailPath = StorageCore.getImagePath(asset, AssetPathType.Thumbnail, image.thumbnail.format);
    this.storageCore.ensureFolders(previewPath);

    // For PDFs, try to render the first page using sharp if available
    // Otherwise, generate a placeholder thumbnail
    const isPdf = mimeTypes.isPdf(asset.originalPath);
    const isOfficeDoc = this.isOfficeDocument(asset.originalPath);

    this.logger.log(`Generating document thumbnail for ${asset.id}: isPdf=${isPdf}, isOfficeDoc=${isOfficeDoc}, path=${asset.originalPath}`);

    if (isPdf) {
      try {
        // Try to render PDF first page using pdftoppm (poppler-utils)
        this.logger.debug(`Attempting PDF thumbnail generation for ${asset.id}`);
        const generated = await this.generatePdfThumbnails(asset, previewPath, thumbnailPath, image);
        if (generated) {
          this.logger.log(`Successfully generated PDF thumbnail for ${asset.id}`);
          return generated;
        }
      } catch (error) {
        this.logger.warn(`Failed to render PDF thumbnail for ${asset.id}, falling back to placeholder: ${error}`);
      }
    } else if (isOfficeDoc) {
      try {
        // Try to convert Office document to PDF, then render first page
        this.logger.debug(`Attempting Office document thumbnail generation for ${asset.id}`);
        const generated = await this.generateOfficeThumbnails(asset, previewPath, thumbnailPath, image);
        if (generated) {
          this.logger.log(`Successfully generated Office document thumbnail for ${asset.id}`);
          return generated;
        }
        this.logger.warn(`Office thumbnail generation returned null for ${asset.id}`);
      } catch (error) {
        this.logger.warn(`Failed to render Office document thumbnail for ${asset.id}, falling back to placeholder: ${error}`);
      }
    }

    // Generate a placeholder thumbnail for documents
    // Create a simple gray placeholder image (square placeholder, no dimensions stored)
    const placeholderBuffer = await this.generateDocumentPlaceholder(image.preview.size, image.preview.size);

    await this.mediaRepository.generateThumbnail(placeholderBuffer, { ...image.preview, colorspace: Colorspace.Srgb, processInvalidImages: false }, previewPath);
    await this.mediaRepository.generateThumbnail(placeholderBuffer, { ...image.thumbnail, colorspace: Colorspace.Srgb, processInvalidImages: false }, thumbnailPath);

    const thumbhash = await this.mediaRepository.generateThumbhash(placeholderBuffer, {
      colorspace: Colorspace.Srgb,
      processInvalidImages: false,
    });

    // Placeholder thumbnails are square, don't set dimensions so frontend uses default aspect ratio
    return { previewPath, thumbnailPath, thumbhash };
  }

  private async generatePdfThumbnails(
    asset: ThumbnailPathEntity & { originalPath: string },
    previewPath: string,
    thumbnailPath: string,
    imageConfig: { preview: { size: number; format: ImageFormat; quality: number }; thumbnail: { size: number; format: ImageFormat; quality: number } },
  ): Promise<{ previewPath: string; thumbnailPath: string; thumbhash: Buffer; exifImageWidth: number; exifImageHeight: number } | null> {
    // Use pdftoppm (poppler-utils) to render the first page of the PDF
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const execFileAsync = promisify(execFile);

    // Create a temp file for the rendered PDF page
    const tempDir = path.dirname(previewPath);
    const tempBasename = `pdf-render-${asset.id}`;
    const tempPath = path.join(tempDir, tempBasename);

    try {
      // Render first page of PDF to PNG using pdftoppm
      // -f 1 -l 1: first page only
      // -png: output PNG format
      // -r 150: 150 DPI resolution (good balance of quality and size)
      // -singlefile: don't add page number suffix
      await execFileAsync('/usr/bin/pdftoppm', [
        '-f', '1',
        '-l', '1',
        '-png',
        '-r', '150',
        '-singlefile',
        asset.originalPath,
        tempPath,
      ]);

      // pdftoppm creates file with .png extension
      const renderedPath = `${tempPath}.png`;

      // Check if the rendered file exists
      await fs.access(renderedPath);

      // Read the rendered image and get its dimensions
      const pdfImageBuffer = await fs.readFile(renderedPath);
      const sharpModule = await import('sharp');
      const sharp = sharpModule.default;
      const metadata = await sharp(pdfImageBuffer).metadata();
      const originalWidth = metadata.width || 1;
      const originalHeight = metadata.height || 1;

      // Calculate aspect ratio and cap at 9:16 (portrait) or 16:9 (landscape)
      const aspectRatio = originalWidth / originalHeight;
      const maxAspectRatio = 16 / 9; // ~1.78
      const minAspectRatio = 9 / 16; // ~0.56

      let targetWidth: number;
      let targetHeight: number;

      if (aspectRatio > maxAspectRatio) {
        // Too wide, cap at 16:9
        targetWidth = imageConfig.preview.size;
        targetHeight = Math.round(targetWidth / maxAspectRatio);
      } else if (aspectRatio < minAspectRatio) {
        // Too tall, cap at 9:16
        targetHeight = imageConfig.preview.size;
        targetWidth = Math.round(targetHeight * minAspectRatio);
      } else {
        // Within acceptable range, preserve original aspect ratio
        if (originalWidth > originalHeight) {
          targetWidth = imageConfig.preview.size;
          targetHeight = Math.round(targetWidth / aspectRatio);
        } else {
          targetHeight = imageConfig.preview.size;
          targetWidth = Math.round(targetHeight * aspectRatio);
        }
      }

      // Generate preview with preserved aspect ratio (fit: 'inside')
      await sharp(pdfImageBuffer)
        .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: true })
        .toFormat(imageConfig.preview.format, { quality: imageConfig.preview.quality })
        .toFile(previewPath);

      // Generate thumbnail with preserved aspect ratio
      const thumbTargetWidth = Math.round(targetWidth * (imageConfig.thumbnail.size / imageConfig.preview.size));
      const thumbTargetHeight = Math.round(targetHeight * (imageConfig.thumbnail.size / imageConfig.preview.size));
      await sharp(pdfImageBuffer)
        .resize(thumbTargetWidth, thumbTargetHeight, { fit: 'inside', withoutEnlargement: true })
        .toFormat(imageConfig.thumbnail.format, { quality: imageConfig.thumbnail.quality })
        .toFile(thumbnailPath);

      // Generate thumbhash from the preview
      const thumbhash = await this.mediaRepository.generateThumbhash(pdfImageBuffer, {
        colorspace: Colorspace.Srgb,
        processInvalidImages: false,
      });

      // Clean up temp file
      await fs.unlink(renderedPath).catch(() => {});

      return { previewPath, thumbnailPath, thumbhash, exifImageWidth: originalWidth, exifImageHeight: originalHeight };
    } catch (error) {
      this.logger.debug(`Failed to render PDF with pdftoppm: ${error}`);
      // Clean up any temp files on error
      const renderedPath = `${tempPath}.png`;
      await fs.unlink(renderedPath).catch(() => {});
      return null;
    }
  }

  private async generateDocumentPlaceholder(width: number, height: number): Promise<Buffer> {
    // Create a simple placeholder image using sharp
    // This creates a light gray image with a document icon pattern
    const sharp = await import('sharp').then((m) => m.default || m);

    // Create a simple gray placeholder
    const placeholderSvg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#e5e7eb"/>
        <g transform="translate(${width / 2 - 40}, ${height / 2 - 50})">
          <rect x="10" y="0" width="60" height="80" rx="4" fill="#9ca3af" stroke="#6b7280" stroke-width="2"/>
          <rect x="20" y="15" width="40" height="4" fill="#6b7280"/>
          <rect x="20" y="25" width="40" height="4" fill="#6b7280"/>
          <rect x="20" y="35" width="30" height="4" fill="#6b7280"/>
          <rect x="20" y="45" width="35" height="4" fill="#6b7280"/>
          <rect x="20" y="55" width="25" height="4" fill="#6b7280"/>
        </g>
        <text x="${width / 2}" y="${height / 2 + 60}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="#6b7280">Document</text>
      </svg>
    `;

    return sharp(Buffer.from(placeholderSvg))
      .resize(width, height, { fit: 'inside' })
      .png()
      .toBuffer();
  }

  private isOfficeDocument(filePath: string): boolean {
    const ext = filePath.toLowerCase().split('.').pop();
    return ['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'odt'].includes(ext || '');
  }

  private async generateOfficeThumbnails(
    asset: ThumbnailPathEntity & { originalPath: string },
    previewPath: string,
    thumbnailPath: string,
    imageConfig: { preview: { size: number; format: ImageFormat; quality: number }; thumbnail: { size: number; format: ImageFormat; quality: number } },
  ): Promise<{ previewPath: string; thumbnailPath: string; thumbhash: Buffer; exifImageWidth: number; exifImageHeight: number } | null> {
    // Use LibreOffice to convert Office document to PDF, then render first page
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const execFileAsync = promisify(execFile);

    // Create temp directory for LibreOffice output
    const tempDir = path.dirname(previewPath);
    const _tempPdfBasename = `office-convert-${asset.id}`;
    const sourceBasename = path.basename(asset.originalPath, path.extname(asset.originalPath));

    try {
      this.logger.log(`LibreOffice conversion starting for ${asset.id}`);
      this.logger.log(`  Source: ${asset.originalPath}`);
      this.logger.log(`  Output dir: ${tempDir}`);
      this.logger.log(`  Expected output: ${sourceBasename}.pdf`);

      // Convert Office document to PDF using LibreOffice
      // --headless: Run without GUI
      // --convert-to pdf: Convert to PDF format
      // --outdir: Output directory
      // Note: LD_PRELOAD forces LibreOffice to use the system HarfBuzz library instead of
      // the jellyfin-ffmpeg bundled one, which lacks graphite2 support required by LibreOffice
      // The path differs by architecture: aarch64 vs x86_64
      const harfbuzzPath = process.arch === 'arm64'
        ? '/usr/lib/aarch64-linux-gnu/libharfbuzz.so'
        : '/usr/lib/x86_64-linux-gnu/libharfbuzz.so';

      // Create unique user profile to allow concurrent LibreOffice instances
      const userProfileDir = path.join(tempDir, `lo-profile-${asset.id}`);
      await fs.mkdir(userProfileDir, { recursive: true });

      const { stdout, stderr } = await execFileAsync('/usr/bin/libreoffice', [
        '--headless',
        `-env:UserInstallation=file://${userProfileDir}`,
        '--convert-to', 'pdf',
        '--outdir', tempDir,
        asset.originalPath,
      ], {
        timeout: 60_000, // 60 second timeout
        env: {
          ...process.env,
          LD_PRELOAD: harfbuzzPath,
        },
      });

      // Clean up user profile directory
      await fs.rm(userProfileDir, { recursive: true, force: true }).catch(() => {});

      this.logger.log(`LibreOffice stdout: ${stdout}`);
      if (stderr) {
        this.logger.warn(`LibreOffice stderr: ${stderr}`);
      }

      // LibreOffice creates PDF with same basename as input file
      const convertedPdfPath = path.join(tempDir, `${sourceBasename}.pdf`);
      this.logger.log(`Looking for converted PDF at: ${convertedPdfPath}`);

      // Check if the converted PDF exists
      await fs.access(convertedPdfPath);
      this.logger.log(`Converted PDF found, generating thumbnail`);

      // Now use the existing PDF thumbnail generation
      // Create a temporary asset-like object for the PDF
      const pdfAsset = {
        ...asset,
        originalPath: convertedPdfPath,
      };

      const result = await this.generatePdfThumbnails(pdfAsset, previewPath, thumbnailPath, imageConfig);

      // Clean up the temporary PDF
      await fs.unlink(convertedPdfPath).catch(() => {});

      this.logger.log(`Successfully generated Office document thumbnail for ${asset.id}`);
      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to convert Office document with LibreOffice for ${asset.id}: ${errorMessage}`);
      if (errorStack) {
        this.logger.error(`Stack trace: ${errorStack}`);
      }
      // Clean up any temp files on error
      const possiblePdfPath = path.join(tempDir, `${sourceBasename}.pdf`);
      await fs.unlink(possiblePdfPath).catch(() => {});
      return null;
    }
  }

  @OnJob({ name: JobName.AssetEncodeVideoQueueAll, queue: QueueName.VideoConversion })
  async handleQueueVideoConversion(job: JobOf<JobName.AssetEncodeVideoQueueAll>): Promise<JobStatus> {
    const { force } = job;

    let queue: { name: JobName.AssetEncodeVideo; data: { id: string } }[] = [];
    for await (const asset of this.assetJobRepository.streamForVideoConversion(force)) {
      queue.push({ name: JobName.AssetEncodeVideo, data: { id: asset.id } });

      if (queue.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(queue);
        queue = [];
      }
    }

    await this.jobRepository.queueAll(queue);

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetEncodeVideo, queue: QueueName.VideoConversion })
  async handleVideoConversion({ id }: JobOf<JobName.AssetEncodeVideo>): Promise<JobStatus> {
    const asset = await this.assetJobRepository.getForVideoConversion(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    const input = asset.originalPath;
    const output = StorageCore.getEncodedVideoPath(asset);
    this.storageCore.ensureFolders(output);

    const { videoStreams, audioStreams, format } = await this.mediaRepository.probe(input, {
      countFrames: this.logger.isLevelEnabled(LogLevel.Debug), // makes frame count more reliable for progress logs
    });
    const videoStream = this.getMainStream(videoStreams);
    const audioStream = this.getMainStream(audioStreams);
    if (!videoStream || !format.formatName) {
      return JobStatus.Failed;
    }

    if (!videoStream.height || !videoStream.width) {
      this.logger.warn(`Skipped transcoding for asset ${asset.id}: no video streams found`);
      return JobStatus.Failed;
    }

    let { ffmpeg } = await this.getConfig({ withCache: true });
    const target = this.getTranscodeTarget(ffmpeg, videoStream, audioStream);
    if (target === TranscodeTarget.None && !this.isRemuxRequired(ffmpeg, format)) {
      if (asset.encodedVideoPath) {
        this.logger.log(`Transcoded video exists for asset ${asset.id}, but is no longer required. Deleting...`);
        await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [asset.encodedVideoPath] } });
        await this.assetRepository.update({ id: asset.id, encodedVideoPath: null });
      } else {
        this.logger.verbose(`Asset ${asset.id} does not require transcoding based on current policy, skipping`);
      }

      return JobStatus.Skipped;
    }

    const command = BaseConfig.create(ffmpeg, this.videoInterfaces).getCommand(target, videoStream, audioStream);
    if (ffmpeg.accel === TranscodeHardwareAcceleration.Disabled) {
      this.logger.log(`Transcoding video ${asset.id} without hardware acceleration`);
    } else {
      this.logger.log(
        `Transcoding video ${asset.id} with ${ffmpeg.accel.toUpperCase()}-accelerated encoding and${ffmpeg.accelDecode ? '' : ' software'} decoding`,
      );
    }

    try {
      await this.mediaRepository.transcode(input, output, command);
    } catch (error: any) {
      this.logger.error(`Error occurred during transcoding: ${error.message}`);
      if (ffmpeg.accel === TranscodeHardwareAcceleration.Disabled) {
        return JobStatus.Failed;
      }

      let partialFallbackSuccess = false;
      if (ffmpeg.accelDecode) {
        try {
          this.logger.error(`Retrying with ${ffmpeg.accel.toUpperCase()}-accelerated encoding and software decoding`);
          ffmpeg = { ...ffmpeg, accelDecode: false };
          const command = BaseConfig.create(ffmpeg, this.videoInterfaces).getCommand(target, videoStream, audioStream);
          await this.mediaRepository.transcode(input, output, command);
          partialFallbackSuccess = true;
        } catch (error: any) {
          this.logger.error(`Error occurred during transcoding: ${error.message}`);
        }
      }

      if (!partialFallbackSuccess) {
        this.logger.error(`Retrying with ${ffmpeg.accel.toUpperCase()} acceleration disabled`);
        ffmpeg = { ...ffmpeg, accel: TranscodeHardwareAcceleration.Disabled };
        const command = BaseConfig.create(ffmpeg, this.videoInterfaces).getCommand(target, videoStream, audioStream);
        await this.mediaRepository.transcode(input, output, command);
      }
    }

    this.logger.log(`Successfully encoded ${asset.id}`);

    await this.assetRepository.update({ id: asset.id, encodedVideoPath: output });

    return JobStatus.Success;
  }

  private getMainStream<T extends VideoStreamInfo | AudioStreamInfo>(streams: T[]): T {
    return streams
      .filter((stream) => stream.codecName !== 'unknown')
      .sort((stream1, stream2) => stream2.bitrate - stream1.bitrate)[0];
  }

  private getTranscodeTarget(
    config: SystemConfigFFmpegDto,
    videoStream: VideoStreamInfo,
    audioStream?: AudioStreamInfo,
  ): TranscodeTarget {
    const isAudioTranscodeRequired = this.isAudioTranscodeRequired(config, audioStream);
    const isVideoTranscodeRequired = this.isVideoTranscodeRequired(config, videoStream);

    if (isAudioTranscodeRequired && isVideoTranscodeRequired) {
      return TranscodeTarget.All;
    }

    if (isAudioTranscodeRequired) {
      return TranscodeTarget.Audio;
    }

    if (isVideoTranscodeRequired) {
      return TranscodeTarget.Video;
    }

    return TranscodeTarget.None;
  }

  private isAudioTranscodeRequired(ffmpegConfig: SystemConfigFFmpegDto, stream?: AudioStreamInfo): boolean {
    if (!stream) {
      return false;
    }

    switch (ffmpegConfig.transcode) {
      case TranscodePolicy.Disabled: {
        return false;
      }
      case TranscodePolicy.All: {
        return true;
      }
      case TranscodePolicy.Required:
      case TranscodePolicy.Optimal:
      case TranscodePolicy.Bitrate: {
        return !ffmpegConfig.acceptedAudioCodecs.includes(stream.codecName as AudioCodec);
      }
      default: {
        throw new Error(`Unsupported transcode policy: ${ffmpegConfig.transcode}`);
      }
    }
  }

  private isVideoTranscodeRequired(ffmpegConfig: SystemConfigFFmpegDto, stream: VideoStreamInfo): boolean {
    const scalingEnabled = ffmpegConfig.targetResolution !== 'original';
    const targetRes = Number.parseInt(ffmpegConfig.targetResolution);
    const isLargerThanTargetRes = scalingEnabled && Math.min(stream.height, stream.width) > targetRes;
    const isLargerThanTargetBitrate = stream.bitrate > this.parseBitrateToBps(ffmpegConfig.maxBitrate);

    const isTargetVideoCodec = ffmpegConfig.acceptedVideoCodecs.includes(stream.codecName as VideoCodec);
    const isRequired = !isTargetVideoCodec || !stream.pixelFormat.endsWith('420p');

    switch (ffmpegConfig.transcode) {
      case TranscodePolicy.Disabled: {
        return false;
      }
      case TranscodePolicy.All: {
        return true;
      }
      case TranscodePolicy.Required: {
        return isRequired;
      }
      case TranscodePolicy.Optimal: {
        return isRequired || isLargerThanTargetRes;
      }
      case TranscodePolicy.Bitrate: {
        return isRequired || isLargerThanTargetBitrate;
      }
      default: {
        throw new Error(`Unsupported transcode policy: ${ffmpegConfig.transcode}`);
      }
    }
  }

  private isRemuxRequired(ffmpegConfig: SystemConfigFFmpegDto, { formatName, formatLongName }: VideoFormat): boolean {
    if (ffmpegConfig.transcode === TranscodePolicy.Disabled) {
      return false;
    }

    const name = formatLongName === 'QuickTime / MOV' ? VideoContainer.Mov : (formatName as VideoContainer);
    return name !== VideoContainer.Mp4 && !ffmpegConfig.acceptedContainers.includes(name);
  }

  isSRGB({ colorspace, profileDescription, bitsPerSample }: Exif): boolean {
    if (colorspace || profileDescription) {
      return [colorspace, profileDescription].some((s) => s?.toLowerCase().includes('srgb'));
    } else if (bitsPerSample) {
      // assume sRGB for 8-bit images with no color profile or colorspace metadata
      return bitsPerSample === 8;
    } else {
      // assume sRGB for images with no relevant metadata
      return true;
    }
  }

  private parseBitrateToBps(bitrateString: string) {
    const bitrateValue = Number.parseInt(bitrateString);

    if (Number.isNaN(bitrateValue)) {
      return 0;
    }

    if (bitrateString.toLowerCase().endsWith('k')) {
      return bitrateValue * 1000; // Kilobits per second to bits per second
    } else if (bitrateString.toLowerCase().endsWith('m')) {
      return bitrateValue * 1_000_000; // Megabits per second to bits per second
    } else {
      return bitrateValue;
    }
  }

  private async shouldUseExtractedImage(extractedPathOrBuffer: string | Buffer, targetSize: number) {
    const { width, height } = await this.mediaRepository.getImageDimensions(extractedPathOrBuffer);
    const extractedSize = Math.min(width, height);
    return extractedSize >= targetSize;
  }

  private async getDevices() {
    try {
      return await this.storageRepository.readdir('/dev/dri');
    } catch {
      this.logger.debug('No devices found in /dev/dri.');
      return [];
    }
  }

  private async hasMaliOpenCL() {
    try {
      const [maliIcdStat, maliDeviceStat] = await Promise.all([
        this.storageRepository.stat('/etc/OpenCL/vendors/mali.icd'),
        this.storageRepository.stat('/dev/mali0'),
      ]);
      return maliIcdStat.isFile() && maliDeviceStat.isCharacterDevice();
    } catch {
      this.logger.debug('OpenCL not available for transcoding, so RKMPP acceleration will use CPU tonemapping');
      return false;
    }
  }
}
