# Document Support Implementation

**Status**: Complete - Build and lint passing

This document describes the implementation of non-image file support (PDF, TXT, EPUB, etc.) in Immich.

## Recent Updates (December 2024)

### Admin Jobs Page - Document Extraction
- **Manual Job Trigger**: Document Extraction job now visible in Admin > Jobs page
- **Translation Keys**: Added `admin.document_extraction_job` and `admin.document_extraction_job_description`
- **Job Controls**: Supports "ALL" (force reprocess), "MISSING" (only unprocessed), pause/resume/clear

### ONLYOFFICE Conversion with Per-Page OCR
- **PDF Conversion**: Office documents (DOCX, PPTX, XLSX, etc.) converted to PDF via ONLYOFFICE
- **Text Layer Extraction**: Text extracted from PDF with per-page positions for search highlighting
- **Per-Page Sparse OCR**: Pages with < 50 chars are rendered and OCR'd individually
- **Page Association**: OCR'd text is associated with specific pages/slides for accurate search results
- **Stored PDF**: Converted PDF stored for web viewing with accurate search highlighting

### Comprehensive Document Search
- **Scanned PDF OCR**: Automatically detects scanned PDFs (< 50 chars/page) and runs OCR on all pages using pdftoppm
- **Per-Page OCR for Office Docs**: Sparse pages in converted PDFs are OCR'd individually (replaces whole-document image extraction)
- **Priority Queue**: Smaller documents are processed first using BullMQ priority (1=smallest, 200=largest)
- **No Page Limits**: All pages of all documents are processed, no artificial limits
- **Smart Timeout Calculation**: OCR timeout scales with page count (3s/page, min 60s, max 600s)

### How Scanned PDF Detection Works
The system determines if a PDF is scanned (image-based) vs. text-based:
1. Extract text using pdf-parse
2. Calculate average characters per page
3. If < 50 chars/page, treat as scanned PDF
4. Render each page to PNG using pdftoppm at 150 DPI
5. Send each page image to the ML OCR service (PaddleOCR)
6. Combine all extracted text for search indexing

### Office Document Processing (ONLYOFFICE Path)
When ONLYOFFICE is available, Office documents are processed as follows:
1. Convert document to PDF via ONLYOFFICE Conversion API
2. Extract text with positions from PDF using pdf.js (per page)
3. Detect sparse pages (< 50 chars) that likely contain images
4. Render sparse pages to PNG using pdftoppm
5. OCR each sparse page via ML OCR service (PaddleOCR)
6. Append OCR'd text to the page's text data with `[OCR]` prefix
7. Store all page text + positions in `document_text_positions` table
8. Store converted PDF for web viewing

### Office Document Processing (Fallback Path)
When ONLYOFFICE is unavailable:
1. Parse the ZIP structure using JSZip
2. Extract structural text using mammoth (DOCX) or officeparser (others)
3. Find images in format-specific paths:
   - DOCX: `word/media/`
   - PPTX: `ppt/media/`
   - XLSX: `xl/media/`
4. Extract PNG/JPEG images
5. Send each image to ML OCR service
6. Combine image text with document text for indexing
7. Note: No page association or position data in fallback path

## Overview

Document support extends Immich to handle files beyond images and videos. Documents are:
- Uploadable via the web interface, mobile app, and CLI
- Searchable via full-text search (extracted text is indexed)
- Displayed with placeholder thumbnails in the gallery

## Supported Formats

| Extension | MIME Type | Text Extraction | Embedded Images | Thumbnail | Viewer | Notes |
|-----------|-----------|-----------------|-----------------|-----------|--------|-------|
| .pdf | application/pdf | Yes + OCR | Planned | First page render | Native browser | pdf-parse + pdftoppm OCR |
| .txt | text/plain | Yes | N/A | Placeholder | Iframe | Direct file reading |
| .md | text/markdown | Yes | N/A | Placeholder | Iframe | Direct file reading |
| .epub | application/epub+zip | Yes | Planned | Placeholder | Download | Via epub2 |
| .rtf | application/rtf | Yes | N/A | Placeholder | Iframe | Basic RTF stripping |
| .csv | text/csv | Yes | N/A | Placeholder | Iframe | Direct file reading |
| .json | application/json | Yes | N/A | Placeholder | Iframe | Direct file reading |
| .xml | application/xml | Yes | N/A | Placeholder | Iframe | Direct file reading |
| .html/.htm | text/html | Yes | N/A | Placeholder | Iframe | Direct file reading |
| .docx | application/vnd.openxmlformats... | Yes | **Yes (OCR'd)** | First page render | ONLYOFFICE | mammoth + JSZip images |
| .doc | application/msword | Yes | No | First page render | ONLYOFFICE | Via officeparser |
| .pptx | application/vnd.openxmlformats... | Yes | **Yes (OCR'd)** | First page render | ONLYOFFICE | officeparser + JSZip images |
| .ppt | application/vnd.ms-powerpoint | Yes | No | First page render | ONLYOFFICE | Via officeparser |
| .xlsx | application/vnd.openxmlformats... | Yes | **Yes (OCR'd)** | First page render | ONLYOFFICE | officeparser + JSZip images |
| .xls | application/vnd.ms-excel | Yes | No | First page render | ONLYOFFICE | Via officeparser |
| .odt | application/vnd.oasis.opendoc... | Yes | No | First page render | ONLYOFFICE | Via officeparser |

## Architecture

### Server Components

#### 1. MIME Type Registry (`server/src/utils/mime-types.ts`)

Added `document` category with supported file extensions and MIME types:
- `isDocument(filename)` - Check if file is a document
- `isPdf(filename)` - Check if file is a PDF
- `assetType(filename)` - Returns `AssetType.Document` for document files

#### 2. Asset Type Enum (`server/src/enum.ts`)

```typescript
export enum AssetType {
  Image = 'IMAGE',
  Video = 'VIDEO',
  Audio = 'AUDIO',
  Document = 'DOCUMENT',  // NEW
  Other = 'OTHER',
}
```

#### 3. Document Service (`server/src/services/document.service.ts`)

Comprehensive service handling document text extraction with OCR support:

**Core Methods:**
- `handleQueueDocumentTextExtraction()` - Queues all documents with priority based on file size
- `handleDocumentTextExtraction()` - Extracts text from a single document
- `extractTextFromDocument()` - Routes to format-specific extractors

**PDF Processing:**
- `extractTextFromPdfWithPages()` - Full PDF processing with per-page text positions using pdf.js
- `extractTextFromPdf()` - Basic PDF text extraction with scanned document detection
- `ocrAllPdfPages()` - Renders all PDF pages via pdftoppm and OCRs each page
- `ocrSparsePdfPages()` - OCRs only pages with < 50 chars (for converted Office docs)

**Office Document Processing (ONLYOFFICE):**
- `convertWithOnlyOffice()` - Convert Office doc to PDF via ONLYOFFICE Conversion API
- `storePdfForViewing()` - Store converted PDF for web viewing
- `extractTextFromPdfWithPages()` - Extract text with positions from converted PDF
- `ocrSparsePdfPages()` - OCR sparse pages and associate text with specific pages

**Office Document Processing (Fallback):**
- `extractTextFromOfficeDocument()` - Office extraction with embedded image OCR
- `extractImagesFromOfficeDoc()` - Generic OOXML image extraction via JSZip
- `ocrImageBuffers()` - OCR extracted image buffers

**Text Formats:**
- `extractPlainText()` - Direct text file reading
- `extractEpubText()` - EPUB e-book text extraction
- `extractRtfText()` - RTF text extraction with markup stripping

**Constants:**
```typescript
SCANNED_PDF_THRESHOLD = 50;    // chars/page for scanned detection
OCR_DPI = 150;                 // PDF page render resolution
OCR_TIMEOUT_PER_PAGE_MS = 3000;
OCR_MIN_TIMEOUT_MS = 60_000;   // 1 minute minimum
OCR_MAX_TIMEOUT_MS = 600_000;  // 10 minutes maximum
```

#### 4. Media Service Updates (`server/src/services/media.service.ts`)

Added document thumbnail generation:
- `generateDocumentThumbnails()` - Creates placeholder thumbnails
- `generateDocumentPlaceholder()` - Creates SVG placeholder with document icon

#### 5. Job System

New queue and jobs:
- `QueueName.DocumentExtraction` - Queue for document processing
- `JobName.DocumentTextExtractionQueueAll` - Queue all documents
- `JobName.DocumentTextExtraction` - Extract text from one document

Document text extraction is triggered after thumbnail generation for document assets.

#### 6. Database Schema

Added to `asset_job_status` table:
- `documentTextExtractedAt` - Timestamp tracking extraction status

### Text Search Integration

Document text is stored in the existing `ocr_search` table, which has:
- GIN trigram index for fast text search
- Integration with the existing search infrastructure

This means documents are searchable using the same search interface as OCR text from images.

### Frontend Components

#### 1. Timeline Asset Type (`web/src/lib/managers/timeline-manager/types.ts`)

Added `isDocument` boolean property to `TimelineAsset` type.

#### 2. Asset Utils (`web/src/lib/utils/asset-utils.ts`)

Updated `getAssetType()` to return 'Document' for document assets.

#### 3. Timeline Util (`web/src/lib/utils/timeline-util.ts`)

Updated `toTimelineAsset()` to set `isDocument` property.

## Dependencies

Added to `server/package.json`:
- `pdf-parse`: ^1.1.1 - PDF text extraction
- `epub2`: ^3.0.2 - EPUB e-book parsing
- `mammoth`: ^1.8.0 - DOCX (Word) text extraction
- `officeparser`: ^4.0.5 - Legacy Office formats (.doc, .ppt, .pptx, .xls, .xlsx, .odt)
- `jszip`: ^3.10.1 - Extract embedded images from OOXML files (DOCX, PPTX, XLSX)
- `pdf-lib`: ^1.17.1 - PDF manipulation (reserved for future embedded image extraction)

**System Dependencies (installed in Docker):**
- `poppler-utils` - Provides pdftoppm for PDF page rendering to PNG
- `libreoffice` - Office document thumbnail generation and PDF conversion

## Configuration

Document extraction queue is configured in `server/src/config.ts`:
```typescript
[QueueName.DocumentExtraction]: { concurrency: 2 },
```

## Priority Queue System

Documents are processed in order of file size (smallest first) for faster user feedback.

### How Priority Works

1. **Database Query Ordering**: `asset-job.repository.ts` orders documents by file size (ascending)
2. **BullMQ Priority**: Jobs are queued with priority based on file size tiers

**Priority Tiers:**
| File Size | Priority | Processing Order |
|-----------|----------|------------------|
| < 1 MB | 1 | First (fastest) |
| 1-10 MB | 10 | Second |
| 10-50 MB | 50 | Third |
| 50-100 MB | 100 | Fourth |
| > 100 MB | 200 | Last |

**Implementation in `document.service.ts`:**
```typescript
const fileSizeMB = asset.fileSizeInByte ? Number(asset.fileSizeInByte) / (1024 * 1024) : 999;
let priority = 200; // Default for unknown size
if (fileSizeMB < 1) priority = 1;
else if (fileSizeMB < 10) priority = 10;
else if (fileSizeMB < 50) priority = 50;
else if (fileSizeMB < 100) priority = 100;

await this.jobRepository.queue({ name: JobName.DocumentTextExtraction, data: { id: asset.id, priority } });
```

**Implementation in `job.repository.ts`:**
```typescript
case JobName.DocumentTextExtraction: {
  return { priority: item.data?.priority || 100 };
}
```

## API Changes

### GET /api/server/media-types

Response now includes `document` array:
```json
{
  "video": [".mp4", ".mov", ...],
  "image": [".jpg", ".png", ...],
  "sidecar": [".xmp"],
  "document": [".pdf", ".txt", ".epub", ...]
}
```

## Files Modified

### Server
- `server/src/utils/mime-types.ts` - Added document types
- `server/src/enum.ts` - Added Document asset type and job names
- `server/src/services/document.service.ts` - Comprehensive document extraction with OCR, ONLYOFFICE conversion, per-page sparse OCR
- `server/src/services/onlyoffice.service.ts` - ONLYOFFICE Conversion API integration with JWT auth
- `server/src/services/queue.service.ts` - Added DocumentExtraction queue case for admin jobs page
- `server/src/services/index.ts` - Added DocumentService export
- `server/src/services/media.service.ts` - Added document thumbnail generation
- `server/src/services/job.service.ts` - Trigger document extraction after upload
- `server/src/services/library.service.ts` - Use mimeTypes.assetType() for detection
- `server/src/services/server.service.ts` - Return document types in API
- `server/src/repositories/asset-job.repository.ts` - Added document extraction queries with file size ordering
- `server/src/repositories/job.repository.ts` - Added priority support for DocumentTextExtraction jobs
- `server/src/schema/tables/asset-job-status.table.ts` - Added documentTextExtractedAt column
- `server/src/schema/migrations/1762500000000-AddDocumentTextExtractedAt.ts` - Migration for documentTextExtractedAt
- `server/src/dtos/server.dto.ts` - Added document field to response DTO
- `server/src/config.ts` - Added DocumentExtraction queue config
- `server/src/types.ts` - Added IEntityJobWithPriority interface
- `server/package.json` - Added pdf-parse, epub2, jszip, pdf-lib, pdfjs-dist dependencies
- `server/test/repositories/config.repository.mock.ts` - Added onlyoffice mock config

### Web Frontend
- `web/src/lib/utils/asset-utils.ts` - Added DOCUMENT case
- `web/src/lib/utils/timeline-util.ts` - Added isDocument mapping
- `web/src/lib/utils.ts` - Added DocumentExtraction to getQueueName mapping
- `web/src/lib/managers/timeline-manager/types.ts` - Added isDocument property
- `web/src/lib/components/jobs/JobsPanel.svelte` - Added Document Extraction job tile to admin UI

### Internationalization
- `i18n/en.json` - Added `admin.document_extraction_job` and `admin.document_extraction_job_description` translation keys

## Future Enhancements

1. **PDF Embedded Image Extraction**: Extract and OCR images embedded within PDFs (requires complex filter decoding)
2. **Document Metadata**: Extract document metadata (author, title, creation date)
3. **EPUB Viewer**: Add dedicated EPUB reader component
4. **CLIP Embeddings for Documents**: Generate semantic embeddings for document thumbnails for visual search
