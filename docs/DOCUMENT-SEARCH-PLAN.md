# Comprehensive Document Search Implementation Plan

**Status: IMPLEMENTED** (December 2024)

See `DOCUMENT-SUPPORT.md` for full documentation of the implementation.

---

## Executive Summary

This plan makes **ALL content** from **ALL pages** of every document fully searchable in Immich. This includes:
- Text extracted from document structure
- Text from OCR on every page (for scanned documents)
- Text from embedded images within documents (screenshots, diagrams, etc.)
- CLIP embeddings for semantic/visual search

**Key Design Decisions:**
- **No page limits** - Process every page of every document
- **Prioritize smaller documents** - Faster results for quick documents
- **Extract ALL embedded images** - From PDFs, DOCX, PPTX, XLSX
- **OCR everything** - Pages AND embedded images

---

## Architecture Overview

```
Document Upload
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Document Processing Job                    │
│  (Prioritized by file size - smaller documents processed first)│
└──────────────────────────────────────────────────────────────┘
       │
       ├─────────────────────────────────────────┐
       │                                         │
       ▼                                         ▼
┌─────────────────────┐                ┌─────────────────────┐
│   Text Extraction   │                │   Image Extraction  │
│  (Structural Text)  │                │   (All Pages/Images)│
└─────────────────────┘                └─────────────────────┘
       │                                         │
       │  PDF: pdf-parse                         │  PDF: pdftoppm (all pages)
       │  DOCX: mammoth                          │  PDF: pdf-lib (embedded images)
       │  Office: officeparser                   │  Office: JSZip (word/ppt/xl/media/)
       │  EPUB: epub2                            │
       │                                         │
       ▼                                         ▼
┌─────────────────────┐                ┌─────────────────────┐
│   Structural Text   │                │   ML OCR Service    │
│                     │                │  (PaddleOCR)        │
└─────────────────────┘                └─────────────────────┘
       │                                         │
       │                                         │
       └──────────────┬──────────────────────────┘
                      │
                      ▼
              ┌───────────────┐
              │  ocr_search   │  (Combined searchable text)
              │    table      │
              └───────────────┘
                      │
                      ▼
              ┌───────────────┐
              │  smart_search │  (CLIP embeddings for semantic search)
              │    table      │
              └───────────────┘
```

---

## Phase 1: Job Queue Priority System

**Goal**: Process smaller documents first for faster user feedback.

### 1.1 Modify Streaming Query to Order by File Size

**File**: `server/src/repositories/asset-job.repository.ts`

**Current Code** (lines 377-389):
```typescript
streamForDocumentTextExtractionJob(force?: boolean) {
  return this.db
    .selectFrom('asset')
    .select(['asset.id'])
    // ... filters
    .stream();
}
```

**New Code**:
```typescript
@GenerateSql({ params: [], stream: true })
streamForDocumentTextExtractionJob(force?: boolean) {
  return this.db
    .selectFrom('asset')
    .leftJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
    .select(['asset.id', 'asset_exif.fileSizeInByte'])
    .$if(!force, (qb) =>
      qb
        .innerJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
        .where('asset_job_status.documentTextExtractedAt', 'is', null),
    )
    .where('asset.deletedAt', 'is', null)
    .where('asset.type', '=', AssetType.Document)
    .where('asset.visibility', '!=', AssetVisibility.Hidden)
    .orderBy(sql`COALESCE(asset_exif."fileSizeInByte", 9999999999)`, 'asc')  // Smallest first, nulls last
    .stream();
}
```

### 1.2 Add BullMQ Priority Based on File Size

**File**: `server/src/services/document.service.ts`

**New Queue Handler**:
```typescript
@OnJob({ name: JobName.DocumentTextExtractionQueueAll, queue: QueueName.DocumentExtraction })
async handleQueueDocumentTextExtraction({ force }: JobOf<JobName.DocumentTextExtractionQueueAll>): Promise<JobStatus> {
  let jobs: JobItem[] = [];
  const assets = this.assetJobRepository.streamForDocumentTextExtractionJob(force);

  for await (const asset of assets) {
    // Calculate priority: smaller files = lower number = higher priority
    const fileSizeMB = asset.fileSizeInByte
      ? Number(asset.fileSizeInByte) / (1024 * 1024)
      : 999;

    // Priority mapping: 0-1MB=1, 1-10MB=10, 10-50MB=50, 50-100MB=100, 100MB+=200
    let priority = 200;
    if (fileSizeMB < 1) priority = 1;
    else if (fileSizeMB < 10) priority = 10;
    else if (fileSizeMB < 50) priority = 50;
    else if (fileSizeMB < 100) priority = 100;

    jobs.push({
      name: JobName.DocumentTextExtraction,
      data: { id: asset.id, priority }
    });

    if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
      await this.jobRepository.queueAll(jobs);
      jobs = [];
    }
  }

  await this.jobRepository.queueAll(jobs);
  return JobStatus.Success;
}
```

### 1.3 Register Priority in Job Repository

**File**: `server/src/repositories/job.repository.ts`

**Add to `getJobOptions()`**:
```typescript
private getJobOptions(item: JobItem): JobsOptions | null {
  switch (item.name) {
    case JobName.DocumentTextExtraction: {
      return { priority: item.data?.priority || 100 };
    }
    // ... existing cases
  }
}
```

---

## Phase 2: Comprehensive PDF Processing

**Goal**: Extract ALL text from ALL pages, including scanned PDFs and embedded images.

### 2.1 PDF Processing Flow

```
PDF Document
     │
     ├── Text-based PDF ──────────► pdf-parse (fast)
     │   (chars/page > 50)
     │
     ├── Scanned PDF ─────────────► pdftoppm (all pages) ──► OCR each page
     │   (chars/page < 50)
     │
     └── Embedded Images ─────────► pdf-lib extract ──► OCR each image
```

### 2.2 Detect PDF Type and Extract Text

**File**: `server/src/services/document.service.ts`

```typescript
private async extractTextFromPdf(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const pdfData = await pdfParse(buffer);

  const pageCount = pdfData.numpages || 1;
  const charsPerPage = pdfData.text.length / pageCount;

  const results: string[] = [];

  // 1. Get structural text (if available)
  if (pdfData.text && pdfData.text.trim().length > 0) {
    results.push(pdfData.text);
  }

  // 2. If scanned PDF (low text density), OCR all pages
  if (charsPerPage < 50) {
    this.logger.log(`Scanned PDF detected (${charsPerPage.toFixed(0)} chars/page), running OCR on ${pageCount} pages`);
    const ocrText = await this.ocrAllPdfPages(filePath, pageCount);
    if (ocrText) {
      results.push('\n[OCR from pages]\n' + ocrText);
    }
  }

  // 3. Extract and OCR embedded images from PDF
  const embeddedImageText = await this.extractAndOcrPdfEmbeddedImages(filePath);
  if (embeddedImageText) {
    results.push('\n[Embedded images]\n' + embeddedImageText);
  }

  return results.join('\n\n');
}
```

### 2.3 OCR All PDF Pages (No Limit)

**File**: `server/src/services/document.service.ts`

```typescript
private async ocrAllPdfPages(filePath: string, pageCount: number): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-pdf-ocr-'));
  const pageTexts: string[] = [];

  try {
    const outputBase = path.join(tempDir, 'page');

    // Render ALL pages to PNG using pdftoppm
    await execFileAsync('/usr/bin/pdftoppm', [
      '-png',
      '-r', '150',  // 150 DPI for good OCR quality
      filePath,
      outputBase
    ], {
      timeout: Math.max(60000, pageCount * 3000)  // 3 seconds per page minimum
    });

    // OCR each page
    for (let page = 1; page <= pageCount; page++) {
      // pdftoppm uses different naming based on page count
      const pageNumStr = pageCount > 9
        ? page.toString().padStart(Math.ceil(Math.log10(pageCount + 1)), '0')
        : page.toString();
      const imagePath = `${outputBase}-${pageNumStr}.png`;

      if (await this.fileExists(imagePath)) {
        try {
          const { machineLearning } = await this.configRepository.getConfig({ withCache: true });
          const ocrResult = await this.machineLearningRepository.ocr(
            imagePath,
            machineLearning.ocr
          );

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
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

### 2.4 Extract Embedded Images from PDF

**File**: `server/src/services/document.service.ts`

**Add dependency**: `pnpm add pdf-lib`

```typescript
import { PDFDocument } from 'pdf-lib';

private async extractAndOcrPdfEmbeddedImages(filePath: string): Promise<string> {
  const texts: string[] = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-pdf-img-'));

  try {
    const buffer = await fs.readFile(filePath);
    const pdfDoc = await PDFDocument.load(buffer);
    const pages = pdfDoc.getPages();

    let imageIndex = 0;

    for (let pageNum = 0; pageNum < pages.length; pageNum++) {
      const page = pages[pageNum];

      // Get XObject resources (contains images)
      const resources = page.node.Resources();
      if (!resources) continue;

      const xObjects = resources.lookup(PDFName.of('XObject'));
      if (!xObjects || !(xObjects instanceof PDFDict)) continue;

      const entries = xObjects.entries();

      for (const [name, ref] of entries) {
        try {
          const xObject = xObjects.lookup(name);
          if (!xObject) continue;

          // Check if it's an image
          const subtype = xObject.get(PDFName.of('Subtype'));
          if (!subtype || subtype.toString() !== '/Image') continue;

          // Extract image data
          const imageData = await this.extractPdfImage(xObject);
          if (!imageData) continue;

          // Save to temp file
          const imagePath = path.join(tempDir, `image-${imageIndex++}.png`);
          await fs.writeFile(imagePath, imageData);

          // OCR the image
          const { machineLearning } = await this.configRepository.getConfig({ withCache: true });
          const ocrResult = await this.machineLearningRepository.ocr(
            imagePath,
            machineLearning.ocr
          );

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
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

---

## Phase 3: Office Document Image Extraction

**Goal**: Extract ALL embedded images from DOCX, PPTX, XLSX and OCR them.

### 3.1 Add JSZip Dependency

```bash
cd server && pnpm add jszip
```

### 3.2 Extract Images from Office Documents

**File**: `server/src/services/document.service.ts`

```typescript
import JSZip from 'jszip';

private async extractImagesFromOfficeDoc(filePath: string): Promise<Buffer[]> {
  const images: Buffer[] = [];

  try {
    const buffer = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);

    // Office documents store images in these paths
    const mediaPaths = [
      'word/media/',      // DOCX
      'ppt/media/',       // PPTX
      'xl/media/',        // XLSX
    ];

    for (const [relativePath, file] of Object.entries(zip.files)) {
      if (file.dir) continue;

      const isMedia = mediaPaths.some(p => relativePath.startsWith(p));

      // Extract standard image formats (skip EMF/WMF vector graphics for now)
      const isStandardImage = /\.(png|jpg|jpeg|gif|bmp|tiff|webp)$/i.test(relativePath);

      if (isMedia && isStandardImage) {
        try {
          const imageBuffer = await file.async('nodebuffer');
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
```

### 3.3 OCR Extracted Images

**File**: `server/src/services/document.service.ts`

```typescript
private async ocrImageBuffers(images: Buffer[]): Promise<string> {
  if (images.length === 0) return '';

  const texts: string[] = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-office-img-'));

  try {
    const { machineLearning } = await this.configRepository.getConfig({ withCache: true });

    for (let i = 0; i < images.length; i++) {
      const imagePath = path.join(tempDir, `image-${i}.png`);

      try {
        await fs.writeFile(imagePath, images[i]);

        const ocrResult = await this.machineLearningRepository.ocr(
          imagePath,
          machineLearning.ocr
        );

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
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

### 3.4 Integrate into Office Document Processing

**File**: `server/src/services/document.service.ts`

```typescript
private async extractTextFromOfficeDocument(
  filePath: string,
  extension: string
): Promise<string> {
  const results: string[] = [];

  // 1. Get structural text using existing parsers
  if (extension === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    if (result.value) {
      results.push(result.value);
    }
  } else {
    // Use officeparser for other Office formats
    const officeParser = require('officeparser');
    const text = await new Promise<string>((resolve, reject) => {
      officeParser.parseOffice(filePath, (data: string, err: Error | null) => {
        if (err) reject(err);
        else resolve(data || '');
      });
    });
    if (text) {
      results.push(text);
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
```

---

## Phase 4: CLIP Embeddings for Documents

**Goal**: Enable semantic/visual search for documents.

### 4.1 Verify Documents Get CLIP Encoded

The existing `SmartInfoService.handleEncodeClip()` should already process documents with preview files. Verification needed:

**File**: `server/src/services/smart-info.service.ts`

**Add logging** (temporary for verification):
```typescript
@OnJob({ name: JobName.EncodeClip, queue: QueueName.SmartSearch })
async handleEncodeClip({ id }: JobOf<JobName.EncodeClip>): Promise<JobStatus> {
  const asset = await this.assetJobRepository.getForEncodeClip(id);

  this.logger.debug(`CLIP encoding asset: type=${asset.type}, id=${id}, hasPreview=${!!asset.previewFile}`);

  // ... rest of method
}
```

### 4.2 Ensure Document Thumbnails Trigger CLIP

**File**: `server/src/services/media.service.ts`

After thumbnail generation, ensure `previewAt` is set in `asset_job_status` table (this should already happen).

---

## Phase 5: Main Job Handler Integration

**Goal**: Unified document processing that extracts all text sources.

### 5.1 Complete Document Text Extraction Handler

**File**: `server/src/services/document.service.ts`

```typescript
@OnJob({ name: JobName.DocumentTextExtraction, queue: QueueName.DocumentExtraction })
async handleDocumentTextExtraction({ id }: JobOf<JobName.DocumentTextExtraction>): Promise<JobStatus> {
  const asset = await this.assetJobRepository.getForDocumentTextExtraction(id);
  if (!asset) {
    return JobStatus.Failed;
  }

  const extension = path.extname(asset.originalFileName).toLowerCase();
  let allText = '';

  try {
    this.logger.log(`Processing document: ${asset.originalFileName} (${extension})`);

    // Route to appropriate extractor based on file type
    switch (extension) {
      case '.pdf':
        allText = await this.extractTextFromPdf(asset.originalPath);
        break;

      case '.docx':
      case '.doc':
      case '.pptx':
      case '.ppt':
      case '.xlsx':
      case '.xls':
      case '.odt':
      case '.odp':
      case '.ods':
        allText = await this.extractTextFromOfficeDocument(asset.originalPath, extension);
        break;

      case '.epub':
        allText = await this.extractTextFromEpub(asset.originalPath);
        break;

      case '.txt':
      case '.md':
      case '.csv':
      case '.json':
      case '.xml':
      case '.html':
      case '.htm':
        allText = await fs.readFile(asset.originalPath, 'utf-8');
        break;

      case '.rtf':
        allText = await this.extractTextFromRtf(asset.originalPath);
        break;

      default:
        this.logger.warn(`Unsupported document type: ${extension}`);
    }

    // Store extracted text for search
    if (allText && allText.trim().length > 0) {
      await this.ocrRepository.upsert(id, [{
        assetId: id,
        x1: 0, y1: 0, x2: 1, y2: 1,
        x3: 1, y3: 1, x4: 0, y4: 1,
        boxScore: 1,
        textScore: 1,
        text: allText.trim(),
      }]);

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
```

---

## Phase 6: Dependencies and Configuration

### 6.1 New Dependencies

**File**: `server/package.json`

```bash
cd server
pnpm add jszip pdf-lib
```

### 6.2 Service Dependencies Injection

**File**: `server/src/services/document.service.ts`

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  IAssetRepository,
  IAssetJobRepository,
  IConfigRepository,
  IJobRepository,
  IMachineLearningRepository,
  IOcrRepository,
} from '@app/domain';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @Inject(IAssetRepository)
    private assetRepository: IAssetRepository,

    @Inject(IAssetJobRepository)
    private assetJobRepository: IAssetJobRepository,

    @Inject(IConfigRepository)
    private configRepository: IConfigRepository,

    @Inject(IJobRepository)
    private jobRepository: IJobRepository,

    @Inject(IMachineLearningRepository)
    private machineLearningRepository: IMachineLearningRepository,

    @Inject(IOcrRepository)
    private ocrRepository: IOcrRepository,
  ) {}

  // ... methods
}
```

### 6.3 Update Service Index

**File**: `server/src/services/index.ts`

Ensure `DocumentService` has access to all required repositories.

---

## Files to Modify Summary

| File | Changes |
|------|---------|
| `server/src/services/document.service.ts` | Complete rewrite with PDF OCR, Office image extraction |
| `server/src/repositories/asset-job.repository.ts` | Add file size ordering to streaming query |
| `server/src/repositories/job.repository.ts` | Add priority support for DocumentTextExtraction |
| `server/src/services/index.ts` | Update DocumentService dependencies |
| `server/package.json` | Add jszip, pdf-lib dependencies |

## New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `jszip` | ^3.10.1 | Extract images from DOCX/PPTX/XLSX |
| `pdf-lib` | ^1.17.1 | Extract embedded images from PDF |

## No Database Changes Required

All data stored in existing tables:
- `ocr_search` - Combined searchable text (GIN trigram index)
- `smart_search` - CLIP embeddings (HNSW vector index)
- `asset_job_status` - Job tracking

---

## Processing Summary by Document Type

| Type | Structural Text | Page OCR | Embedded Image OCR | CLIP |
|------|-----------------|----------|-------------------|------|
| **PDF (text)** | pdf-parse | Skip (fast path) | pdf-lib extract + OCR | Yes |
| **PDF (scanned)** | pdf-parse (minimal) | pdftoppm ALL pages + OCR | pdf-lib extract + OCR | Yes |
| **DOCX** | mammoth | N/A | JSZip word/media/ + OCR | Yes |
| **PPTX** | officeparser | N/A | JSZip ppt/media/ + OCR | Yes |
| **XLSX** | officeparser | N/A | JSZip xl/media/ + OCR | Yes |
| **EPUB** | epub2 | N/A | Future enhancement | Yes |
| **TXT/MD/CSV** | Direct read | N/A | N/A | Yes |

---

## Performance Characteristics

### Job Priority (BullMQ)

| File Size | Priority | Processing Order |
|-----------|----------|------------------|
| < 1 MB | 1 (highest) | First |
| 1-10 MB | 10 | Second |
| 10-50 MB | 50 | Third |
| 50-100 MB | 100 | Fourth |
| > 100 MB | 200 (lowest) | Last |

### Processing Time Estimates

| Document Type | Pages/Images | Estimated Time |
|--------------|--------------|----------------|
| 10-page text PDF | 10 | ~2 seconds |
| 10-page scanned PDF | 10 | ~30-60 seconds |
| 100-page scanned PDF | 100 | ~5-10 minutes |
| DOCX with 5 images | 5 | ~10-15 seconds |
| PPTX with 20 slides + images | 20 | ~1-2 minutes |

### Resource Management

- Temp files cleaned up immediately after each page/image
- Streaming query prevents memory overflow on large libraries
- Job queue throttling via existing BullMQ concurrency settings
- No page/image limits - processes everything

---

## Testing Plan

### Test Documents to Prepare

1. `text-based.pdf` - Normal PDF with selectable text (10+ pages)
2. `scanned.pdf` - Image-based PDF (scan of printed document)
3. `mixed.pdf` - Some text pages, some scanned pages
4. `pdf-with-images.pdf` - PDF with embedded screenshots/diagrams
5. `docx-with-images.docx` - Word doc with embedded images
6. `pptx-presentation.pptx` - PowerPoint with slide images
7. `xlsx-with-charts.xlsx` - Excel with embedded chart images
8. `large-document.pdf` - 500+ page document (stress test)

### Verification Steps

1. Upload each document
2. Wait for processing to complete
3. Search for text that appears in:
   - Document structure (headings, paragraphs)
   - Scanned page content
   - Embedded image text
4. Verify semantic search finds documents by concept

---

## Approval Checklist

Before implementation:

- [ ] Confirm no page limits (process ALL pages)
- [ ] Confirm file size priority (smaller first)
- [ ] Confirm embedded image extraction for PDF, DOCX, PPTX, XLSX
- [ ] Approve new dependencies (jszip, pdf-lib)
- [ ] Review processing time estimates
- [ ] Approve test document requirements

**Ready for implementation?**
