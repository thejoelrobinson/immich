import { BadRequestException, Injectable } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
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

/**
 * Response from ONLYOFFICE Conversion API
 */
interface ConversionResponse {
  endConvert: boolean;
  fileType?: string;
  fileUrl?: string;
  percent: number;
  error?: number;
}

/**
 * Office formats that can be converted to PDF via ONLYOFFICE
 */
const CONVERTIBLE_FORMATS = ['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.odt', '.odp', '.ods'];

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
    const documentKey = hash.replaceAll('+', 'A').replaceAll('/', 'B').slice(0, 20);

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
   * Supports both user tokens (from frontend) and system tokens (from server-side conversion)
   */
  validateDownloadToken(token: string, assetId: string): { valid: boolean; userId?: string; system?: boolean } {
    try {
      const config = this.configRepository.getEnv();
      const decoded = this.cryptoRepository.verifyJwt<{
        userId?: string;
        assetId: string;
        purpose: string;
        system?: boolean;
      }>(token, config.onlyoffice.jwtSecret);

      if (decoded.assetId !== assetId || decoded.purpose !== 'onlyoffice-download') {
        this.logger.warn(`Token validation failed: assetId or purpose mismatch`);
        return { valid: false };
      }

      // System tokens are valid for conversion API calls (no user context)
      if (decoded.system) {
        return { valid: true, system: true };
      }

      return { valid: true, userId: decoded.userId };
    } catch (error) {
      this.logger.warn(`Token validation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
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

  /**
   * Convert an Office document to PDF using ONLYOFFICE Conversion API.
   * Returns the path to a temporary PDF file.
   * Caller is responsible for cleaning up the temp file.
   */
  async convertToPdf(assetId: string, originalPath: string): Promise<string | null> {
    const config = this.configRepository.getEnv();

    if (!config.onlyoffice.enabled || !config.onlyoffice.jwtSecret) {
      this.logger.debug('ONLYOFFICE not enabled or missing JWT secret');
      return null;
    }

    const ext = extname(originalPath).toLowerCase();
    if (!CONVERTIBLE_FORMATS.includes(ext)) {
      this.logger.debug(`File type ${ext} not supported for ONLYOFFICE conversion`);
      return null;
    }

    // Check if ONLYOFFICE is available
    const available = await this.isAvailable();
    if (!available) {
      this.logger.debug('ONLYOFFICE server not available');
      return null;
    }

    try {
      // Generate unique document key for this conversion
      const documentKey = this.generateConversionKey(assetId);

      // Create download token for ONLYOFFICE to fetch the source document
      const downloadToken = this.generateSystemDownloadToken(assetId, config.onlyoffice.jwtSecret);
      const sourceUrl = `${config.onlyoffice.immichInternalUrl}/api/onlyoffice/download/${assetId}?token=${downloadToken}`;

      // Build conversion request payload
      const conversionPayload = {
        async: true,
        filetype: ext.slice(1), // Remove leading dot
        key: documentKey,
        outputtype: 'pdf',
        url: sourceUrl,
      };

      // Sign the conversion request with JWT
      const signedToken = this.cryptoRepository.signJwt(conversionPayload, config.onlyoffice.jwtSecret, {
        expiresIn: '1h',
      });

      // Send conversion request
      const conversionUrl = `${config.onlyoffice.url}/ConvertService.ashx`;
      this.logger.debug(`Sending conversion request to ${conversionUrl} for asset ${assetId}`);

      const response = await fetch(conversionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ token: signedToken }),
      });

      if (!response.ok) {
        this.logger.warn(`ONLYOFFICE conversion request failed: ${response.status} ${response.statusText}`);
        return null;
      }

      const result = (await response.json()) as ConversionResponse;
      this.logger.debug(`Initial conversion response: ${JSON.stringify(result)}`);

      if (result.error) {
        this.logger.warn(`ONLYOFFICE conversion error code: ${result.error}`);
        return null;
      }

      // Handle async conversion - poll until complete
      const pdfUrl = await this.pollConversion(conversionUrl, signedToken, result);

      if (!pdfUrl) {
        this.logger.warn('ONLYOFFICE conversion did not return a PDF URL');
        return null;
      }

      // Download the converted PDF to a temp file
      const tempPath = await this.downloadConvertedPdf(pdfUrl, assetId);
      this.logger.log(`Successfully converted ${assetId} to PDF at ${tempPath}`);
      return tempPath;
    } catch (error) {
      this.logger.warn(`ONLYOFFICE conversion failed for asset ${assetId}: ${error}`);
      return null;
    }
  }

  /**
   * Poll ONLYOFFICE conversion API until conversion completes or times out
   */
  private async pollConversion(
    conversionUrl: string,
    token: string,
    initialResult: ConversionResponse,
    maxAttempts: number = 60,
    delayMs: number = 2000,
  ): Promise<string | null> {
    let result = initialResult;
    let attempts = 0;

    while (!result.endConvert && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      const response = await fetch(conversionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        this.logger.warn(`ONLYOFFICE poll request failed: ${response.status}`);
        return null;
      }

      result = (await response.json()) as ConversionResponse;
      attempts++;

      this.logger.debug(`Conversion poll attempt ${attempts}: ${result.percent}% complete`);

      if (result.error) {
        this.logger.warn(`ONLYOFFICE conversion error during poll: ${result.error}`);
        return null;
      }
    }

    if (!result.endConvert) {
      this.logger.warn(`ONLYOFFICE conversion timed out after ${attempts} attempts`);
      return null;
    }

    // Check for error even after conversion completes (partial conversion)
    if (result.error) {
      this.logger.warn(`ONLYOFFICE conversion completed with error: ${result.error}`);
      return null;
    }

    return result.fileUrl ?? null;
  }

  /**
   * Download the converted PDF from ONLYOFFICE to a temporary file
   */
  private async downloadConvertedPdf(pdfUrl: string, assetId: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000); // 60 second timeout

    try {
      const response = await fetch(pdfUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to download converted PDF: ${response.status} ${response.statusText}`);
      }

      // Create temp directory for the converted PDF
      const tempDir = await fs.mkdtemp(join(os.tmpdir(), 'immich-oo-convert-'));
      const tempPath = join(tempDir, `${assetId}.pdf`);

      // Stream the response body to the temp file
      const body = response.body;
      if (!body) {
        throw new Error('No response body from ONLYOFFICE');
      }

      const fileStream = createWriteStream(tempPath);
      // Convert web ReadableStream to Node.js Readable
      const nodeStream = Readable.fromWeb(body as any);
      await pipeline(nodeStream, fileStream);

      return tempPath;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Generate a unique key for ONLYOFFICE conversion
   * ONLYOFFICE only accepts pattern: 0-9-.a-zA-Z_=
   */
  private generateConversionKey(assetId: string): string {
    const timestamp = Date.now();
    const keySource = `convert-${assetId}-${timestamp}`;
    const hash = this.cryptoRepository.hashSha256(keySource);
    // Replace base64 chars that ONLYOFFICE rejects: + -> A, / -> B
    return hash.replaceAll('+', 'A').replaceAll('/', 'B').slice(0, 20);
  }

  /**
   * Generate a system download token (no user context required)
   * Used for server-to-server communication during conversion
   */
  private generateSystemDownloadToken(assetId: string, secret: string): string {
    const payload = {
      assetId,
      purpose: 'onlyoffice-download',
      system: true,
    };
    return this.cryptoRepository.signJwt(payload, secret, { expiresIn: '1h' });
  }
}
