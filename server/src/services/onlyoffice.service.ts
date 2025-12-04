import { BadRequestException, Injectable } from '@nestjs/common';
import { extname } from 'node:path';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  OnlyOfficeConfigResponseDto,
  OnlyOfficeDocumentConfigDto,
  ONLYOFFICE_FILE_TYPES,
} from 'src/dtos/onlyoffice.dto';
import { CacheControl, Permission } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { ImmichFileResponse } from 'src/utils/file';
import { mimeTypes } from 'src/utils/mime-types';

@Injectable()
export class OnlyOfficeService extends BaseService {
  /**
   * Get ONLYOFFICE configuration for the frontend
   */
  async getOnlyOfficeConfig(): Promise<OnlyOfficeConfigResponseDto> {
    const config = this.configRepository.getEnv();
    const isAvailable = await this.isAvailable();

    return {
      enabled: config.onlyoffice.enabled && isAvailable,
      externalUrl: config.onlyoffice.externalUrl,
    };
  }

  /**
   * Check if ONLYOFFICE is enabled and the server is reachable
   */
  async isAvailable(): Promise<boolean> {
    const config = this.configRepository.getEnv();

    if (!config.onlyoffice.enabled || !config.onlyoffice.jwtSecret) {
      return false;
    }

    // Health check the ONLYOFFICE server
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${config.onlyoffice.url}/healthcheck`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      this.logger.warn(`ONLYOFFICE server health check failed: ${error}`);
      return false;
    }
  }

  /**
   * Check if a file extension is supported by ONLYOFFICE
   */
  isSupported(filename: string): boolean {
    const ext = extname(filename).toLowerCase();
    return ext in ONLYOFFICE_FILE_TYPES;
  }

  /**
   * Generate ONLYOFFICE document configuration with JWT token
   */
  async getDocumentConfig(auth: AuthDto, assetId: string): Promise<OnlyOfficeDocumentConfigDto> {
    // Verify user has permission to view this asset
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });

    // Get the asset
    const asset = await this.assetRepository.getById(assetId);
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    // Check if file type is supported
    const ext = extname(asset.originalPath).toLowerCase();
    const fileConfig = ONLYOFFICE_FILE_TYPES[ext];
    if (!fileConfig) {
      throw new BadRequestException(`File type ${ext} is not supported by ONLYOFFICE`);
    }

    const config = this.configRepository.getEnv();
    if (!config.onlyoffice.enabled) {
      throw new BadRequestException('ONLYOFFICE is not enabled');
    }

    // Generate unique document key
    // Changes when document is modified to invalidate ONLYOFFICE cache
    // ONLYOFFICE only accepts pattern: 0-9-.a-zA-Z_= (no + or /)
    const keySource = `${asset.id}-${asset.checksum}-${asset.updatedAt.toISOString()}`;
    const hash = this.cryptoRepository.hashSha256(keySource);
    // Replace base64 chars that ONLYOFFICE rejects: + -> A, / -> B
    const documentKey = hash.replace(/\+/g, 'A').replace(/\//g, 'B').substring(0, 20);

    // Build the document download URL that ONLYOFFICE will fetch from
    const immichInternalUrl = config.onlyoffice.immichInternalUrl;

    // Generate a temporary access token for ONLYOFFICE to download the document
    const downloadToken = this.generateDownloadToken(auth, assetId, config.onlyoffice.jwtSecret);
    const documentUrl = `${immichInternalUrl}/api/onlyoffice/download/${assetId}?token=${downloadToken}`;

    // Build the ONLYOFFICE config payload
    const payload = {
      document: {
        fileType: fileConfig.fileType,
        key: documentKey,
        title: asset.originalFileName,
        url: documentUrl,
        permissions: {
          edit: false,
          download: true,
          print: true,
          copy: true,
        },
      },
      documentType: fileConfig.documentType,
      editorConfig: {
        mode: 'view',
        lang: 'en',
        customization: {
          chat: false,
          comments: false,
          help: false,
          plugins: false,
          toolbarNoTabs: true,
          compactHeader: true,
        },
      },
    };

    // Sign the entire config as JWT for ONLYOFFICE
    const token = this.cryptoRepository.signJwt(payload, config.onlyoffice.jwtSecret, {
      expiresIn: '1h',
    });

    return {
      documentKey,
      documentUrl,
      documentType: fileConfig.documentType,
      fileType: fileConfig.fileType,
      title: asset.originalFileName,
      token,
    };
  }

  /**
   * Generate a temporary token for ONLYOFFICE to download the document
   */
  private generateDownloadToken(auth: AuthDto, assetId: string, secret: string): string {
    const payload = {
      userId: auth.user.id,
      assetId,
      purpose: 'onlyoffice-download',
    };

    return this.cryptoRepository.signJwt(payload, secret, {
      expiresIn: '1h',
    });
  }

  /**
   * Validate a download token from ONLYOFFICE
   */
  validateDownloadToken(token: string, assetId: string): { valid: boolean; userId?: string } {
    try {
      const config = this.configRepository.getEnv();
      const decoded = this.cryptoRepository.verifyJwt<{
        userId: string;
        assetId: string;
        purpose: string;
      }>(token, config.onlyoffice.jwtSecret);

      if (decoded.assetId !== assetId || decoded.purpose !== 'onlyoffice-download') {
        return { valid: false };
      }

      return { valid: true, userId: decoded.userId };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Download document for ONLYOFFICE server
   * Returns file info for sendFile to serve
   */
  async downloadDocument(assetId: string): Promise<ImmichFileResponse> {
    const asset = await this.assetRepository.getById(assetId);
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    return new ImmichFileResponse({
      path: asset.originalPath,
      fileName: asset.originalFileName,
      contentType: mimeTypes.lookup(asset.originalPath),
      cacheControl: CacheControl.None,
    });
  }
}
