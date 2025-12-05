import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  DocumentSearchMatchDto,
  DocumentSearchMatchesResponseDto,
  PageTextPositionsResponseDto,
  TextPositionDto,
} from 'src/dtos/document.dto';
import { AssetType, AssetVisibility, JobName, JobStatus, Permission, QueueName } from 'src/enum';
import { PageTextData, TextItem } from 'src/repositories/document-text.repository';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';

const execFileAsync = promisify(execFile);

@Injectable()
export class DocumentService extends BaseService {
  /**
   * Get all search matches for a document with page context
   */
  async getSearchMatches(
    auth: AuthDto,
    assetId: string,
    searchTerm: string,
  ): Promise<DocumentSearchMatchesResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });

    // Use findMatchingPages to leverage database index for better performance
    const pages = await this.documentTextRepository.findMatchingPages(assetId, searchTerm);
    const matches: DocumentSearchMatchDto[] = [];

    const searchLower = searchTerm.toLowerCase();

    for (const page of pages) {
      const textLower = page.text.toLowerCase();
      let startIndex = 0;

      while ((startIndex = textLower.indexOf(searchLower, startIndex)) !== -1) {
        // Extract snippet with context (~50 chars before and after)
        const snippetStart = Math.max(0, startIndex - 50);
        const snippetEnd = Math.min(page.text.length, startIndex + searchTerm.length + 50);

        matches.push({
          pageNumber: page.pageNumber,
          textSnippet: page.text.slice(snippetStart, snippetEnd),
          matchStart: startIndex,
          matchEnd: startIndex + searchTerm.length,
        });

        startIndex += searchTerm.length;
      }
    }

    return {
      assetId,
      searchTerm,
      totalMatches: matches.length,
      matches,
    };
  }

  /**
   * Get text positions for a specific page (for highlighting)
   */
  async getPageTextPositions(
    auth: AuthDto,
    assetId: string,
    pageNumber: number,
  ): Promise<PageTextPositionsResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });

    const page = await this.documentTextRepository.getPage(assetId, pageNumber);

    if (!page) {
      return {
        pageNumber,
        text: '',
        textItems: null,
      };
    }

    let textItems: TextPositionDto[] | null = null;
    if (page.textItems) {
      try {
        textItems = JSON.parse(page.textItems as string) as TextPositionDto[];
      } catch (error) {
        this.logger.warn(`Failed to parse text items for page ${pageNumber} of asset ${assetId}: ${error}`);
        textItems = null;
      }
    }

    return {
      pageNumber: page.pageNumber,
      text: page.text,
      textItems,
    };
  }

  /**
   * Get all pages with text and positions for a document
   */
  async getAllPages(auth: AuthDto, assetId: string): Promise<PageTextPositionsResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });

    const pages = await this.documentTextRepository.getByAssetId(assetId);

    return pages.map((page) => {
      let textItems: TextPositionDto[] | null = null;
      if (page.textItems) {
        try {
          textItems = JSON.parse(page.textItems as string) as TextPositionDto[];
        } catch (error) {
          this.logger.warn(`Failed to parse text items for page ${page.pageNumber} of asset ${assetId}: ${error}`);
          textItems = null;
        }
      }

      return {
        pageNumber: page.pageNumber,
        text: page.text,
        textItems,
      };
    });
  }

  @OnJob({ name: JobName.DocumentTextExtractionQueueAll, queue: QueueName.DocumentExtraction })
  async handleQueueDocumentTextExtraction({
    force,
  }: JobOf<JobName.DocumentTextExtractionQueueAll>): Promise<JobStatus> {
    if (force) {
      this.logger.log('Force flag set - will re-extract text from all documents');
    }

    let jobs: JobItem[] = [];
    const assets = this.assetJobRepository.streamForDocumentTextExtractionJob(force);

    for await (const asset of assets) {
      // Calculate priority based on file size: smaller files = lower number = higher priority
      const fileSizeMB = asset.fileSizeInByte ? Number(asset.fileSizeInByte) / (1024 * 1024) : 999;

      // Priority mapping: 0-1MB=1, 1-10MB=10, 10-50MB=50, 50-100MB=100, 100MB+=200
      let priority = 200;
      if (fileSizeMB < 1) {
        priority = 1;
      } else if (fileSizeMB < 10) {
        priority = 10;
      } else if (fileSizeMB < 50) {
        priority = 50;
      } else if (fileSizeMB < 100) {
        priority = 100;
      }

      jobs.push({
        name: JobName.DocumentTextExtraction,
        data: { id: asset.id, priority },
      });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.DocumentTextExtraction, queue: QueueName.DocumentExtraction })
  async handleDocumentTextExtraction({ id }: JobOf<JobName.DocumentTextExtraction>): Promise<JobStatus> {
    const asset = await this.assetJobRepository.getForDocumentTextExtraction(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    if (asset.type !== AssetType.Document) {
      this.logger.debug(`Skipping non-document asset ${id}`);
      return JobStatus.Skipped;
    }

    const extension = path.extname(asset.originalFileName).toLowerCase();
    let allText = '';

    try {
      this.logger.log(`Processing document: ${asset.originalFileName} (${extension})`);

      // Route to appropriate extractor based on file type
      switch (extension) {
        case '.pdf': {
          const { fullText, pages } = await this.extractTextFromPdfWithPages(asset.originalPath);
          allText = fullText;

          // Store page-level text with positions for highlighting
          if (pages.length > 0) {
            await this.documentTextRepository.upsertPages(id, pages);
            this.logger.debug(`Stored ${pages.length} pages with positions for document ${id}`);
          }
          break;
        }

        case '.docx':
        case '.doc':
        case '.pptx':
        case '.ppt':
        case '.xlsx':
        case '.xls':
        case '.odt':
        case '.odp':
        case '.ods': {
          // Try ONLYOFFICE conversion for accurate text position extraction
          const convertedPdfPath = await this.convertWithOnlyOffice(id, asset.originalPath);

          if (convertedPdfPath) {
            try {
              // Extract text WITH POSITIONS from the converted PDF
              const { fullText, pages } = await this.extractTextFromPdfWithPages(convertedPdfPath);
              const textParts: string[] = [fullText];

              // OCR sparse pages (slides/pages with mostly images)
              // This extracts text from embedded images on a per-page basis
              const { ocrText, ocrPageCount } = await this.ocrSparsePdfPages(convertedPdfPath, pages);
              if (ocrText) {
                textParts.push(ocrText);
                this.logger.debug(`OCR'd ${ocrPageCount} sparse pages for ${id}`);
              }

              allText = textParts.join('\n\n');

              // Store page-level text with positions for highlighting
              // (pages array was updated in-place by ocrSparsePdfPages with OCR'd text)
              if (pages.length > 0) {
                await this.documentTextRepository.upsertPages(id, pages);
                this.logger.debug(`Stored ${pages.length} pages with positions from ONLYOFFICE PDF for ${id}`);
              }

              // Store the converted PDF for web viewing
              await this.storePdfForViewing(id, asset.originalPath, convertedPdfPath);
            } finally {
              // Clean up temp PDF
              await this.cleanupTempFile(convertedPdfPath);
            }
          } else {
            // Fallback: text-only extraction (no positions, no stored PDF)
            this.logger.debug(`ONLYOFFICE not available, using text-only extraction for ${id}`);
            allText = await this.extractTextFromOfficeDocument(asset.originalPath, extension);
          }
          break;
        }

        case '.epub': {
          allText = await this.extractTextFromEpub(asset.originalPath);
          break;
        }

        case '.txt':
        case '.md':
        case '.csv':
        case '.json':
        case '.xml':
        case '.html':
        case '.htm': {
          allText = await fs.readFile(asset.originalPath, 'utf8');
          break;
        }

        case '.rtf': {
          allText = await this.extractTextFromRtf(asset.originalPath);
          break;
        }

        default: {
          this.logger.warn(`Unsupported document type: ${extension}`);
        }
      }

      // Store extracted text for search
      if (allText && allText.trim().length > 0) {
        await this.ocrRepository.upsert(id, [
          {
            assetId: id,
            x1: 0,
            y1: 0,
            x2: 1,
            y2: 1,
            x3: 1,
            y3: 1,
            x4: 0,
            y4: 1,
            boxScore: 1,
            textScore: 1,
            text: allText.trim(),
          },
        ]);

        this.logger.log(`Extracted ${allText.length} characters from ${asset.originalFileName}`);
      }

      // Mark job complete
      await this.assetRepository.upsertJobStatus({
        assetId: id,
        documentTextExtractedAt: new Date(),
      });

      return JobStatus.Success;
    } catch (error) {
      this.logger.error(`Failed to process document ${id}: ${error}`);
      return JobStatus.Failed;
    }
  }

  // Constants for PDF processing
  private readonly SCANNED_PDF_THRESHOLD = 50; // chars per page threshold for scanned detection
  private readonly OCR_DPI = 150; // DPI for pdftoppm rendering
  private readonly OCR_TIMEOUT_PER_PAGE_MS = 3000; // 3 seconds per page
  private readonly OCR_MIN_TIMEOUT_MS = 60_000; // 1 minute minimum
  private readonly OCR_MAX_TIMEOUT_MS = 600_000; // 10 minutes maximum

  /**
   * Extract text from PDF with per-page data and text positions for highlighting.
   * Uses pdfjs-dist for detailed text content extraction.
   */
  private async extractTextFromPdfWithPages(
    filePath: string,
  ): Promise<{ fullText: string; pages: PageTextData[] }> {
    const pages: PageTextData[] = [];
    const allPageTexts: string[] = [];

    try {
      // Use pdfjs-dist for detailed text content with positions
      // eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

      const buffer = await fs.readFile(filePath);
      const uint8Array = new Uint8Array(buffer);
      const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
      const pdfDocument = await loadingTask.promise;

      const pageCount = pdfDocument.numPages;

      for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
        try {
          const page = await pdfDocument.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1 });
          const textContent = await page.getTextContent();

          const pageTexts: string[] = [];
          const textItems: TextItem[] = [];

          for (const item of textContent.items) {
            // TextItem type has 'str' property for the text content
            if ('str' in item && item.str && item.str.trim()) {
              const text = item.str;
              pageTexts.push(text);

              // Extract position from transform matrix: [scaleX, skewY, skewX, scaleY, translateX, translateY]
              const transform = item.transform;
              if (transform && transform.length >= 6) {
                const [scaleX, _skewY, _skewX, scaleY, translateX, translateY] = transform;

                // Normalize coordinates to 0-1 range
                const x = translateX / viewport.width;
                // PDF Y-axis is bottom-up, flip it for display (top-down)
                const y = 1 - translateY / viewport.height;
                const width = (item.width ?? Math.abs(scaleX) * text.length * 0.6) / viewport.width;
                const height = Math.abs(scaleY) / viewport.height;

                // Clamp values to 0-1 range
                textItems.push({
                  text,
                  x: Math.max(0, Math.min(1, x)),
                  y: Math.max(0, Math.min(1, y)),
                  width: Math.max(0, Math.min(1, width)),
                  height: Math.max(0, Math.min(1, height)),
                });
              }
            }
          }

          const pageText = pageTexts.join(' ');
          allPageTexts.push(pageText);

          pages.push({
            pageNumber: pageNum,
            text: pageText,
            textItems: textItems.length > 0 ? textItems : null,
          });
        } catch (pageError) {
          this.logger.warn(`Failed to extract text from page ${pageNum}: ${pageError}`);
          // Still add an empty page entry
          pages.push({
            pageNumber: pageNum,
            text: '',
            textItems: null,
          });
        }
      }

      // Check if this is a scanned PDF (low text density)
      const fullText = allPageTexts.join('\n\n');
      const charsPerPage = fullText.length / Math.max(pageCount, 1);

      // If scanned PDF, run OCR on all pages and append results
      if (charsPerPage < this.SCANNED_PDF_THRESHOLD && pageCount > 0) {
        this.logger.log(
          `Scanned PDF detected (${charsPerPage.toFixed(0)} chars/page), running OCR on ${pageCount} pages`,
        );
        const ocrText = await this.ocrAllPdfPages(filePath, pageCount);
        if (ocrText) {
          return {
            fullText: fullText + '\n\n[OCR from pages]\n' + ocrText,
            pages, // Keep the structural pages even if mostly empty
          };
        }
      }

      return { fullText, pages };
    } catch (error) {
      this.logger.error(`Failed to extract text from PDF ${filePath}: ${error}`);

      // Fall back to pdf-parse for basic text extraction
      try {
        const basicText = await this.extractTextFromPdf(filePath);
        return {
          fullText: basicText,
          pages: [{ pageNumber: 1, text: basicText, textItems: null }],
        };
      } catch {
        return { fullText: '', pages: [] };
      }
    }
  }

  private async extractTextFromPdf(filePath: string): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module
      const pdfParse = require('pdf-parse');
      const buffer = await fs.readFile(filePath);
      const pdfData = await pdfParse(buffer);

      // Validate PDF data to handle malformed PDFs
      if (!pdfData || !pdfData.text) {
        this.logger.warn('PDF parsing returned no text data');
        return '';
      }

      const pageCount = Math.max(pdfData.numpages || 1, 1); // Ensure at least 1 to prevent division by zero
      const charsPerPage = pdfData.text.length / pageCount;

      const results: string[] = [];

      // 1. Get structural text (if available)
      if (pdfData.text.trim().length > 0) {
        results.push(pdfData.text);
      }

      // 2. If scanned PDF (low text density), OCR all pages
      if (charsPerPage < this.SCANNED_PDF_THRESHOLD && pageCount > 0) {
        this.logger.log(
          `Scanned PDF detected (${charsPerPage.toFixed(0)} chars/page), running OCR on ${pageCount} pages`,
        );
        const ocrText = await this.ocrAllPdfPages(filePath, pageCount);
        if (ocrText) {
          results.push('\n[OCR from pages]\n' + ocrText);
        }
      }

      // TODO: Embedded image extraction disabled - pdf-lib stream decoding requires
      // handling multiple compression filters (FlateDecode, DCTDecode, etc.).
      // Current implementation always returns null. Re-enable when properly implemented.
      // See extractAndOcrPdfEmbeddedImages() and extractPdfImage() methods.

      return results.join('\n\n');
    } catch (error) {
      this.logger.error(`Failed to extract text from PDF ${filePath}: ${error}`);
      return '';
    }
  }

  private async ocrAllPdfPages(filePath: string, pageCount: number): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-pdf-ocr-'));
    const pageTexts: string[] = [];

    try {
      const outputBase = path.join(tempDir, 'page');

      // Calculate timeout with bounds: min 1 minute, max 10 minutes
      const calculatedTimeout = pageCount * this.OCR_TIMEOUT_PER_PAGE_MS;
      const timeout = Math.min(Math.max(this.OCR_MIN_TIMEOUT_MS, calculatedTimeout), this.OCR_MAX_TIMEOUT_MS);

      // Render ALL pages to PNG using pdftoppm (let shell resolve path)
      await execFileAsync('pdftoppm', ['-png', '-r', String(this.OCR_DPI), filePath, outputBase], { timeout });

      // OCR each page
      for (let page = 1; page <= pageCount; page++) {
        // pdftoppm naming: for 1-9 pages uses "page-1.png", for 10+ pages uses "page-01.png" etc.
        // Calculate required padding: log10(pageCount) rounded up gives number of digits needed
        const pageNumStr =
          pageCount >= 10 ? page.toString().padStart(Math.ceil(Math.log10(pageCount + 1)), '0') : page.toString();
        const imagePath = `${outputBase}-${pageNumStr}.png`;

        if (await this.fileExists(imagePath)) {
          try {
            const { machineLearning } = await this.getConfig({ withCache: true });
            const ocrResult = await this.machineLearningRepository.ocr(imagePath, machineLearning.ocr);

            if (ocrResult.text && ocrResult.text.length > 0) {
              pageTexts.push(`[Page ${page}]\n${ocrResult.text.join(' ')}`);
            }
          } catch (error) {
            this.logger.warn(`Failed to OCR page ${page}: ${error}`);
          }

          // Clean up page image immediately to save disk space
          await fs.unlink(imagePath).catch(() => {});
        }
      }

      return pageTexts.join('\n\n');
    } finally {
      // Force cleanup with retries for any locked files
      try {
        await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        this.logger.error(`Failed to clean up temp directory ${tempDir}: ${error}`);
      }
    }
  }

  /**
   * OCR only pages with sparse text (below threshold).
   * This catches slides/pages that are mostly images while skipping text-heavy pages.
   * Updates the pages array in-place with OCR'd text appended.
   */
  private async ocrSparsePdfPages(
    filePath: string,
    pages: PageTextData[],
  ): Promise<{ ocrText: string; ocrPageCount: number }> {
    // Find pages with sparse text that need OCR
    const sparsePages = pages.filter((p) => p.text.length < this.SCANNED_PDF_THRESHOLD);

    if (sparsePages.length === 0) {
      return { ocrText: '', ocrPageCount: 0 };
    }

    this.logger.debug(`Found ${sparsePages.length} sparse pages to OCR in converted PDF`);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-pdf-sparse-ocr-'));
    const ocrResults: string[] = [];

    try {
      const { machineLearning } = await this.getConfig({ withCache: true });

      for (const page of sparsePages) {
        const outputBase = path.join(tempDir, `page-${page.pageNumber}`);

        try {
          // Render just this page to PNG
          await execFileAsync(
            'pdftoppm',
            [
              '-png',
              '-r',
              String(this.OCR_DPI),
              '-f',
              String(page.pageNumber),
              '-l',
              String(page.pageNumber),
              filePath,
              outputBase,
            ],
            { timeout: this.OCR_TIMEOUT_PER_PAGE_MS * 2 },
          );

          // pdftoppm creates file with page number suffix
          const imagePath = `${outputBase}-${page.pageNumber}.png`;

          if (await this.fileExists(imagePath)) {
            const ocrResult = await this.machineLearningRepository.ocr(imagePath, machineLearning.ocr);

            if (ocrResult.text && ocrResult.text.length > 0) {
              const ocrText = ocrResult.text.join(' ');
              // Append OCR'd text to the page's text
              page.text = page.text ? `${page.text}\n\n[OCR]\n${ocrText}` : `[OCR]\n${ocrText}`;
              ocrResults.push(`[Page ${page.pageNumber}]\n${ocrText}`);
            }

            await fs.unlink(imagePath).catch(() => {});
          }
        } catch (error) {
          this.logger.warn(`Failed to OCR sparse page ${page.pageNumber}: ${error}`);
        }
      }

      return {
        ocrText: ocrResults.join('\n\n'),
        ocrPageCount: ocrResults.length,
      };
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        this.logger.error(`Failed to clean up temp directory ${tempDir}: ${error}`);
      }
    }
  }

  /**
   * NOTE: This method is currently disabled in extractTextFromPdf().
   * PDF embedded image extraction requires handling multiple compression filters
   * (FlateDecode, DCTDecode, JPXDecode, etc.) which is complex to implement.
   * The extractPdfImage() helper always returns null until properly implemented.
   *
   * To re-enable: uncomment the embedded image extraction section in extractTextFromPdf()
   */
  private async extractAndOcrPdfEmbeddedImages(filePath: string): Promise<string> {
    const texts: string[] = [];
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-pdf-img-'));

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module
      const { PDFDocument, PDFName, PDFDict } = require('pdf-lib');

      const buffer = await fs.readFile(filePath);
      const pdfDoc = await PDFDocument.load(buffer);
      const pages = pdfDoc.getPages();

      let imageIndex = 0;

      for (let pageNum = 0; pageNum < pages.length; pageNum++) {
        const page = pages[pageNum];

        // Get XObject resources (contains images)
        const resources = page.node.Resources();
        if (!resources) {
          continue;
        }

        const xObjects = resources.lookup(PDFName.of('XObject'));
        if (!xObjects || !(xObjects instanceof PDFDict)) {
          continue;
        }

        const entries = xObjects.entries();

        for (const [name] of entries) {
          try {
            const xObject = xObjects.lookup(name);
            if (!xObject) {
              continue;
            }

            // Check if it's an image
            const subtype = xObject.get(PDFName.of('Subtype'));
            if (!subtype || subtype.toString() !== '/Image') {
              continue;
            }

            // Extract image data (currently returns null - see TODO above)
            const imageData = this.extractPdfImage(xObject);
            if (!imageData) {
              continue;
            }

            // Save to temp file
            const imagePath = path.join(tempDir, `image-${imageIndex++}.png`);
            await fs.writeFile(imagePath, imageData);

            // OCR the image
            const { machineLearning } = await this.getConfig({ withCache: true });
            const ocrResult = await this.machineLearningRepository.ocr(imagePath, machineLearning.ocr);

            if (ocrResult.text && ocrResult.text.length > 0) {
              texts.push(`[Image ${imageIndex} on page ${pageNum + 1}]\n${ocrResult.text.join(' ')}`);
            }

            // Clean up immediately
            await fs.unlink(imagePath).catch(() => {});
          } catch (error) {
            this.logger.debug(`Failed to extract PDF image: ${error}`);
          }
        }
      }

      return texts.join('\n\n');
    } catch (error) {
      this.logger.warn(`Failed to extract embedded images from PDF: ${error}`);
      return '';
    } finally {
      // Force cleanup with retries for any locked files
      try {
        await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        this.logger.error(`Failed to clean up temp directory ${tempDir}: ${error}`);
      }
    }
  }

  /**
   * TODO: Implement proper PDF image extraction.
   * This requires decoding various PDF image filters:
   * - FlateDecode (zlib compression)
   * - DCTDecode (JPEG)
   * - JPXDecode (JPEG2000)
   * - CCITTFaxDecode (fax/TIFF)
   * - RunLengthDecode
   * - ASCIIHexDecode, ASCII85Decode
   *
   * Currently returns null for all images.
   */
  private extractPdfImage(_xObject: unknown): Buffer | null {
    // Complex image extraction not yet implemented
    // Would need to handle various PDF image filters and color spaces
    return null;
  }

  private async extractTextFromOfficeDocument(filePath: string, extension: string): Promise<string> {
    const results: string[] = [];

    // 1. Get structural text using existing parsers
    if (extension === '.docx') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        if (result.value) {
          results.push(result.value);
        }
      } catch (error) {
        this.logger.error(`Failed to extract DOCX text: ${error}`);
      }
    } else {
      try {
        // Use officeparser for other Office formats
        // eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module
        const officeParser = require('officeparser');
        const text = await new Promise<string>((resolve, reject) => {
          officeParser.parseOffice(filePath, (data: string, err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve(data || '');
            }
          });
        });
        if (text) {
          results.push(text);
        }
      } catch (error) {
        this.logger.error(`Failed to extract ${extension.toUpperCase()} text: ${error}`);
      }
    }

    // 2. Extract and OCR all embedded images
    const images = await this.extractImagesFromOfficeDoc(filePath);
    if (images.length > 0) {
      const imageText = await this.ocrImageBuffers(images);
      if (imageText) {
        results.push('\n[Embedded images]\n' + imageText);
      }
    }

    return results.join('\n\n');
  }

  private async extractImagesFromOfficeDoc(filePath: string): Promise<Buffer[]> {
    const images: Buffer[] = [];

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module
      const JSZip = require('jszip');

      const buffer = await fs.readFile(filePath);
      const zip = await JSZip.loadAsync(buffer);

      // Office documents store images in these paths
      const mediaPaths = ['word/media/', 'ppt/media/', 'xl/media/'];

      // Iterate over zip files with proper typing
      const zipFiles = zip.files as Record<string, { dir: boolean; async: (type: string) => Promise<Buffer> }>;

      for (const [relativePath, zipObject] of Object.entries(zipFiles)) {
        if (zipObject.dir) {
          continue;
        }

        const isMedia = mediaPaths.some((p) => relativePath.startsWith(p));

        // Extract standard image formats (skip EMF/WMF vector graphics for now)
        const isStandardImage = /\.(png|jpg|jpeg|gif|bmp|tiff|webp)$/i.test(relativePath);

        if (isMedia && isStandardImage) {
          try {
            const imageBuffer = await zipObject.async('nodebuffer');
            images.push(imageBuffer);
          } catch (error) {
            this.logger.debug(`Failed to extract image ${relativePath}: ${error}`);
          }
        }
      }

      this.logger.debug(`Extracted ${images.length} images from Office document`);
      return images;
    } catch (error) {
      this.logger.warn(`Failed to extract images from Office document: ${error}`);
      return [];
    }
  }

  private async ocrImageBuffers(images: Buffer[]): Promise<string> {
    if (images.length === 0) {
      return '';
    }

    const texts: string[] = [];
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-office-img-'));

    try {
      const { machineLearning } = await this.getConfig({ withCache: true });

      for (let i = 0; i < images.length; i++) {
        const imagePath = path.join(tempDir, `image-${i}.png`);

        try {
          await fs.writeFile(imagePath, images[i]);

          const ocrResult = await this.machineLearningRepository.ocr(imagePath, machineLearning.ocr);

          if (ocrResult.text && ocrResult.text.length > 0) {
            texts.push(`[Embedded image ${i + 1}]\n${ocrResult.text.join(' ')}`);
          }
        } catch (error) {
          this.logger.debug(`Failed to OCR embedded image ${i}: ${error}`);
        } finally {
          await fs.unlink(imagePath).catch(() => {});
        }
      }

      return texts.join('\n\n');
    } finally {
      // Force cleanup with retries for any locked files
      try {
        await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        this.logger.error(`Failed to clean up temp directory ${tempDir}: ${error}`);
      }
    }
  }

  private async extractTextFromEpub(filePath: string): Promise<string> {
    try {
      const epub2 = await import('epub2');
      const epub = await epub2.EPub.createAsync(filePath);

      const chapters: string[] = [];
      for (const chapter of epub.flow) {
        try {
          const chapterText = await new Promise<string>((resolve, reject) => {
            epub.getChapter(chapter.id, (err: Error | null, text: string) => {
              if (err) {
                reject(err);
              } else {
                resolve(text || '');
              }
            });
          });

          // Strip HTML tags from chapter content
          const plainText = chapterText.replaceAll(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' ').trim();
          if (plainText) {
            chapters.push(plainText);
          }
        } catch {
          // Skip chapters that fail to parse
        }
      }

      return chapters.join('\n\n');
    } catch (error) {
      this.logger.error(`Failed to extract text from EPUB ${filePath}: ${error}`);
      return '';
    }
  }

  private async extractTextFromRtf(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      // Basic RTF text extraction - strips RTF control codes
      const text = content
        .replaceAll(/\\par[d]?/g, '\n')
        .replaceAll(/\{[^{}]*\}/g, '')
        .replaceAll(/\\[a-z]+\d*\s?/gi, '')
        .replaceAll(/[{}\\]/g, '')
        .trim();
      return text;
    } catch (error) {
      this.logger.error(`Failed to extract text from RTF ${filePath}: ${error}`);
      return '';
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Office formats that can be converted to PDF via ONLYOFFICE
  private readonly CONVERTIBLE_FORMATS = ['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.odt', '.odp', '.ods'];

  /**
   * Convert an Office document to PDF using ONLYOFFICE Conversion API.
   * Returns the temp path to the converted PDF, or null if ONLYOFFICE is unavailable.
   *
   * NOTE: This code duplicates onlyoffice.service.ts conversion logic.
   * Due to BaseService architecture constraints (massive constructor with all repositories),
   * injecting OnlyOfficeService here is not straightforward. Both implementations are kept
   * in sync manually. Future refactoring should consider a shared utility module.
   */
  private async convertWithOnlyOffice(assetId: string, originalPath: string): Promise<string | null> {
    const config = this.configRepository.getEnv();

    if (!config.onlyoffice.enabled || !config.onlyoffice.jwtSecret) {
      this.logger.debug('ONLYOFFICE not enabled or missing JWT secret');
      return null;
    }

    const ext = path.extname(originalPath).toLowerCase();
    if (!this.CONVERTIBLE_FORMATS.includes(ext)) {
      this.logger.debug(`File type ${ext} not supported for ONLYOFFICE conversion`);
      return null;
    }

    // Check if ONLYOFFICE is available
    const available = await this.checkOnlyOfficeAvailable(config.onlyoffice.url);
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
      this.logger.debug(`Sending ONLYOFFICE conversion request for asset ${assetId}`);

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

      interface ConversionResponse {
        endConvert: boolean;
        fileType?: string;
        fileUrl?: string;
        percent: number;
        error?: number;
      }

      const result = (await response.json()) as ConversionResponse;
      this.logger.debug(`Initial conversion response: ${JSON.stringify(result)}`);

      if (result.error) {
        this.logger.warn(`ONLYOFFICE conversion error code: ${result.error}`);
        return null;
      }

      // Poll until complete
      const pdfUrl = await this.pollOnlyOfficeConversion(conversionUrl, signedToken, result);

      if (!pdfUrl) {
        this.logger.warn('ONLYOFFICE conversion did not return a PDF URL');
        return null;
      }

      // Download the converted PDF to a temp file
      const tempPath = await this.downloadConvertedPdf(pdfUrl, assetId);
      this.logger.log(`Successfully converted ${assetId} to PDF via ONLYOFFICE`);
      return tempPath;
    } catch (error) {
      this.logger.warn(`ONLYOFFICE conversion failed for asset ${assetId}: ${error}`);
      return null;
    }
  }

  /**
   * Check if ONLYOFFICE server is available
   */
  private async checkOnlyOfficeAvailable(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${url}/healthcheck`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Poll ONLYOFFICE conversion API until conversion completes or times out
   */
  private async pollOnlyOfficeConversion(
    conversionUrl: string,
    token: string,
    initialResult: { endConvert: boolean; fileUrl?: string; percent: number; error?: number },
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

      result = await response.json();
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
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-oo-convert-'));
      const tempPath = path.join(tempDir, `${assetId}.pdf`);

      // Get the response as an array buffer and write to file
      const buffer = await response.arrayBuffer();
      await fs.writeFile(tempPath, Buffer.from(buffer));

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

  /**
   * Store the converted PDF for web viewing.
   * The PDF is stored alongside the original file and the asset is updated with the PDF path.
   */
  private async storePdfForViewing(assetId: string, originalPath: string, tempPdfPath: string): Promise<void> {
    try {
      // Store PDF in the same directory as the original, with .pdf extension
      const pdfStoragePath = join(dirname(originalPath), `${assetId}-document.pdf`);

      await fs.copyFile(tempPdfPath, pdfStoragePath);
      this.logger.debug(`Stored converted PDF at ${pdfStoragePath}`);

      // Update asset with PDF path (reuse encodedVideoPath field for documents)
      await this.assetRepository.update({ id: assetId, encodedVideoPath: pdfStoragePath });
      this.logger.log(`Updated asset ${assetId} with PDF path`);
    } catch (error) {
      this.logger.warn(`Failed to store PDF for viewing: ${error}`);
      // Non-fatal - the original document is still accessible
    }
  }

  /**
   * Clean up a temporary file and its parent directory.
   */
  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      const tempDir = dirname(filePath);
      // Only clean up if it's actually a temp directory we created
      // Check both that it's in the system temp dir AND has our naming pattern
      if (tempDir.startsWith(os.tmpdir()) && tempDir.includes('immich-oo-convert-')) {
        await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        this.logger.debug(`Cleaned up temp directory: ${tempDir}`);
      } else {
        // Just remove the file if it's not in our temp directory
        await fs.unlink(filePath);
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup temp file ${filePath}: ${error}`);
    }
  }
}
