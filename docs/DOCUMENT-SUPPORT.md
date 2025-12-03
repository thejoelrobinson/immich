# Document Support Implementation

**Status**: Complete - Build and lint passing

This document describes the implementation of non-image file support (PDF, TXT, EPUB, etc.) in Immich.

## Overview

Document support extends Immich to handle files beyond images and videos. Documents are:
- Uploadable via the web interface, mobile app, and CLI
- Searchable via full-text search (extracted text is indexed)
- Displayed with placeholder thumbnails in the gallery

## Supported Formats

| Extension | MIME Type | Text Extraction | Thumbnail | Viewer | Notes |
|-----------|-----------|-----------------|-----------|--------|-------|
| .pdf | application/pdf | Yes | First page render | Native browser | Via pdf-parse, pdftoppm |
| .txt | text/plain | Yes | Placeholder | Iframe | Direct file reading |
| .md | text/markdown | Yes | Placeholder | Iframe | Direct file reading |
| .epub | application/epub+zip | Yes | Placeholder | Download | Via epub2 |
| .rtf | application/rtf | Yes | Placeholder | Iframe | Basic RTF stripping |
| .csv | text/csv | Yes | Placeholder | Iframe | Direct file reading |
| .json | application/json | Yes | Placeholder | Iframe | Direct file reading |
| .xml | application/xml | Yes | Placeholder | Iframe | Direct file reading |
| .html/.htm | text/html | Yes | Placeholder | Iframe | Direct file reading |
| .docx | application/vnd.openxmlformats... | Yes | First page render | HTML render | Via mammoth, LibreOffice |
| .doc | application/msword | Yes | First page render | Download | Via officeparser, LibreOffice |
| .pptx | application/vnd.openxmlformats... | Yes | First page render | Download | Via officeparser, LibreOffice |
| .ppt | application/vnd.ms-powerpoint | Yes | First page render | Download | Via officeparser, LibreOffice |
| .xlsx | application/vnd.openxmlformats... | Yes | First page render | Download | Via officeparser, LibreOffice |
| .xls | application/vnd.ms-excel | Yes | First page render | Download | Via officeparser, LibreOffice |
| .odt | application/vnd.oasis.opendoc... | Yes | First page render | Download | Via officeparser, LibreOffice |

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

New service handling document text extraction:
- `handleQueueDocumentTextExtraction()` - Queues all documents for extraction
- `handleDocumentTextExtraction()` - Extracts text from a single document
- `extractTextFromDocument()` - Routes to format-specific extractors
- Format-specific extractors for PDF, plain text, EPUB, RTF

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

## Configuration

Document extraction queue is configured in `server/src/config.ts`:
```typescript
[QueueName.DocumentExtraction]: { concurrency: 2 },
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
- `server/src/services/document.service.ts` - NEW: Document extraction service
- `server/src/services/index.ts` - Added DocumentService export
- `server/src/services/media.service.ts` - Added document thumbnail generation
- `server/src/services/job.service.ts` - Trigger document extraction after upload
- `server/src/services/library.service.ts` - Use mimeTypes.assetType() for detection
- `server/src/services/server.service.ts` - Return document types in API
- `server/src/repositories/asset-job.repository.ts` - Added document extraction queries
- `server/src/schema/tables/asset-job-status.table.ts` - Added documentTextExtractedAt
- `server/src/dtos/server.dto.ts` - Added document field to response DTO
- `server/src/config.ts` - Added DocumentExtraction queue config
- `server/src/types.ts` - Added job type definitions
- `server/package.json` - Added pdf-parse and epub2 dependencies

### Web Frontend
- `web/src/lib/utils/asset-utils.ts` - Added DOCUMENT case
- `web/src/lib/utils/timeline-util.ts` - Added isDocument mapping
- `web/src/lib/managers/timeline-manager/types.ts` - Added isDocument property

## Future Enhancements

1. **Document Metadata**: Extract document metadata (author, title, creation date)
2. **EPUB Viewer**: Add dedicated EPUB reader component
3. **PowerPoint/Excel Viewer**: Add in-app viewers for presentations and spreadsheets
