# Document Search Implementation Plan

## Executive Summary

This plan addresses making all document content fully searchable in Immich. The existing infrastructure provides excellent foundations - documents already have thumbnails, CLIP encoding should work for documents with previews, and the OCR/search systems are mature.

**Main Gaps to Address:**
1. Scanned PDFs don't get OCR'd (pdf-parse only extracts embedded text)
2. Need to verify documents are included in CLIP encoding pipeline
3. Images embedded in documents (DOCX/PPTX) aren't extracted

---

## Current Architecture Analysis

### What Already Works

| Feature | Status | Implementation |
|---------|--------|----------------|
| Document Classification | Working | `AssetType.Document` in `mime-types.ts` |
| Document Text Extraction | Working | `DocumentService` with pdf-parse, mammoth, officeparser |
| Document Thumbnails | Working | `MediaService.generateDocumentThumbnails()` |
| OCR for Images | Working | ML service + PaddleOCR + `ocr_search` table |
| Text Search | Working | `searchAssetBuilder()` queries `ocr_search` via `%>>` trigram |
| CLIP/Smart Search | Working | `smart_search` table with HNSW vector index |

### Identified Gaps

| Gap | Description | Impact |
|-----|-------------|--------|
| **Scanned PDFs** | pdf-parse returns empty string for image-based PDFs | Scanned documents unsearchable |
| **CLIP for Documents** | Need to verify documents get CLIP encoded | May miss semantic search |
| **Embedded Images** | Images in DOCX/PPTX not extracted | Content in embedded images unsearchable |

---

## Phase 1: OCR for Scanned PDFs

**Goal**: Detect when pdf-parse returns little/no text and fall back to page-by-page OCR.

### 1.1 Modify DocumentService to Detect Scanned PDFs

**File**: `server/src/services/document.service.ts`

**Changes**:
```typescript
private async extractTextFromPdf(filePath: string): Promise<string> {
  const buffer = await fs.promises.readFile(filePath);
  const data = await pdfParse(buffer);

  const charsPerPage = data.text.length / Math.max(data.numpages, 1);

  // If less than 50 chars per page, assume scanned PDF
  if (charsPerPage < 50 && data.numpages > 0) {
    this.logger.log(`Scanned PDF detected (${charsPerPage.toFixed(0)} chars/page), running OCR`);
    return this.extractTextFromScannedPdf(filePath, data.numpages);
  }

  return data.text;
}
```

### 1.2 Add Scanned PDF OCR Method

**File**: `server/src/services/document.service.ts`

**New Method**:
```typescript
private async extractTextFromScannedPdf(filePath: string, pageCount: number): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-pdf-ocr-'));
  const pageTexts: string[] = [];

  try {
    // Limit pages to prevent excessive processing
    const maxPages = Math.min(pageCount, 100);

    for (let page = 1; page <= maxPages; page++) {
      // Convert page to PNG using pdftoppm (already installed)
      const outputBase = path.join(tempDir, `page-${page}`);
      await this.convertPdfPageToImage(filePath, outputBase, page);

      const imagePath = `${outputBase}.png`;
      if (await this.fileExists(imagePath)) {
        // Call ML OCR service
        const ocrResult = await this.machineLearningRepository.ocr(imagePath, this.ocrConfig);
        pageTexts.push(ocrResult.text.join(' '));

        // Clean up page image
        await fs.unlink(imagePath);
      }
    }

    return pageTexts.join('\n\n--- Page Break ---\n\n');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

private async convertPdfPageToImage(
  pdfPath: string,
  outputBase: string,
  page: number
): Promise<void> {
  const args = [
    '-f', String(page),  // First page
    '-l', String(page),  // Last page (same = single page)
    '-png',
    '-r', '150',         // 150 DPI (balance quality/size)
    '-singlefile',
    pdfPath,
    outputBase
  ];

  await execFile('pdftoppm', args);
}
```

### 1.3 Add Dependencies Injection

**File**: `server/src/services/document.service.ts`

**Add to constructor**:
```typescript
constructor(
  // ... existing
  @Inject(IMachineLearningRepository)
  private machineLearningRepository: IMachineLearningRepository,
  @Inject(IConfigRepository)
  private configRepository: IConfigRepository,
) {}
```

### 1.4 Files to Modify

| File | Changes |
|------|---------|
| `server/src/services/document.service.ts` | Add scanned PDF detection and OCR |
| `server/src/services/index.ts` | Add ML repository to DocumentService deps |

---

## Phase 2: Verify CLIP Embeddings for Documents

**Goal**: Confirm documents with thumbnails get CLIP encoded for semantic search.

### 2.1 Investigation: Current Behavior

**File**: `server/src/repositories/asset-job.repository.ts`

The `streamForEncodeClip()` method uses `assetsWithPreviews()` which:
- Joins on `asset_job_status.previewAt IS NOT NULL`
- Does NOT filter by asset type
- **Documents should already be included if they have previews**

### 2.2 Verification Steps

1. Add temporary logging to `SmartInfoService.handleEncodeClip()`:
```typescript
async handleEncodeClip({ id }: JobOf<JobName.EncodeClip>): Promise<JobStatus> {
  const asset = await this.assetJobRepository.getForEncodeClip(id);
  this.logger.debug(`CLIP encoding asset type=${asset.type}, id=${id}`);
  // ... rest of method
}
```

2. Upload a document, check logs for CLIP encoding
3. Query `smart_search` table for document IDs

### 2.3 Fix if Needed

If documents are NOT getting CLIP encoded, check:
1. Document thumbnail job sets `previewAt`
2. Document preview files exist in `asset_file` table
3. No type filtering in CLIP job query

---

## Phase 3: Enable OCR for Document Preview Images

**Goal**: Run OCR on document thumbnail images to catch visible text.

### 3.1 Verify Current Behavior

**File**: `server/src/repositories/asset-job.repository.ts`

`streamForOcrJob()` at line 361-374:
- Filters by `deletedAt`, `ocrAt`, `visibility`
- Does NOT filter by asset type
- **Documents should already be OCR'd**

### 3.2 Merge Document Text + OCR Results

**Challenge**: A document may have:
1. Extracted structural text (from pdf-parse/mammoth)
2. OCR text (from preview thumbnail)

**Solution**: Combine both in `ocr_search` table.

**File**: `server/src/services/document.service.ts`

**Modify `handleDocumentTextExtraction()`**:
```typescript
async handleDocumentTextExtraction({ id }: JobOf<JobName.DocumentTextExtraction>) {
  const asset = await this.assetJobRepository.getForDocumentTextExtraction(id);

  // Get structural text
  const extractedText = await this.extractTextFromDocument(
    asset.originalPath,
    asset.originalFileName
  );

  // Check if OCR already ran (from preview thumbnail)
  const existingOcr = await this.ocrRepository.getByAssetId(id);

  // Combine texts (deduplicate if needed)
  let finalText = extractedText || '';
  if (existingOcr?.text && existingOcr.text !== extractedText) {
    finalText = `${finalText}\n\n[OCR from preview]\n${existingOcr.text}`;
  }

  // Store combined text
  await this.ocrRepository.upsert(id, [{
    assetId: id,
    x1: 0, y1: 0, x2: 1, y2: 1,
    x3: 1, y3: 1, x4: 0, y4: 1,
    boxScore: 1, textScore: 1,
    text: finalText,
  }]);

  await this.assetRepository.upsertJobStatus({
    assetId: id,
    documentTextExtractedAt: new Date()
  });
}
```

---

## Phase 4: Extract Images from Documents (Optional Enhancement)

**Goal**: Extract embedded images from DOCX/PPTX and OCR them.

### 4.1 Add jszip Dependency

```bash
cd server && pnpm add jszip
```

### 4.2 Implement Image Extraction

**File**: `server/src/services/document.service.ts`

```typescript
import JSZip from 'jszip';

private async extractImagesFromOfficeDoc(filePath: string): Promise<Buffer[]> {
  const images: Buffer[] = [];
  const buffer = await fs.promises.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);

  // Office docs store images in word/media/ or ppt/media/
  const mediaPaths = ['word/media/', 'ppt/media/', 'xl/media/'];

  for (const [relativePath, file] of Object.entries(zip.files)) {
    if (file.dir) continue;

    const isMedia = mediaPaths.some(p => relativePath.startsWith(p));
    const isImage = /\.(png|jpg|jpeg|gif|bmp|tiff)$/i.test(relativePath);

    if (isMedia && isImage) {
      const imageBuffer = await file.async('nodebuffer');
      images.push(imageBuffer);
    }
  }

  return images;
}

private async ocrEmbeddedImages(images: Buffer[]): Promise<string> {
  const texts: string[] = [];

  for (const imageBuffer of images) {
    // Write to temp file for ML service
    const tempPath = path.join(os.tmpdir(), `embed-${Date.now()}.png`);
    await fs.promises.writeFile(tempPath, imageBuffer);

    try {
      const result = await this.machineLearningRepository.ocr(tempPath, this.ocrConfig);
      if (result.text.length > 0) {
        texts.push(result.text.join(' '));
      }
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  }

  return texts.join('\n\n');
}
```

### 4.3 Integrate into Text Extraction

```typescript
private async extractTextFromOfficeDocument(
  filePath: string,
  extension: string
): Promise<string> {
  // Get structural text
  const structuralText = await this.parseOfficeText(filePath, extension);

  // Extract and OCR embedded images (if enabled)
  if (this.config.documentSearch.extractEmbeddedImages) {
    const images = await this.extractImagesFromOfficeDoc(filePath);
    if (images.length > 0) {
      const imageText = await this.ocrEmbeddedImages(images);
      return `${structuralText}\n\n[Embedded Images]\n${imageText}`;
    }
  }

  return structuralText;
}
```

---

## Phase 5: Configuration

**File**: `server/src/config.ts` or system config

```typescript
documentSearch: {
  ocrScannedPdfs: true,          // Enable OCR for scanned PDFs
  ocrThresholdCharsPerPage: 50,  // Chars/page threshold for "scanned" detection
  maxPdfPagesForOcr: 100,        // Limit pages to OCR for performance
  extractEmbeddedImages: false,  // OCR images in DOCX/PPTX (performance impact)
}
```

---

## Implementation Priority

| Phase | Priority | Effort | Impact |
|-------|----------|--------|--------|
| Phase 1: Scanned PDF OCR | **High** | Medium | High - Makes scanned docs searchable |
| Phase 2: CLIP Verification | **High** | Low | High - Enables semantic search |
| Phase 3: OCR Merge | Medium | Low | Medium - Combines text sources |
| Phase 4: Embedded Images | Low | Medium | Low - Edge case improvement |
| Phase 5: Config | Medium | Low | Medium - User control |

---

## Files Summary

### Must Modify

| File | Purpose |
|------|---------|
| `server/src/services/document.service.ts` | Core scanned PDF OCR logic |
| `server/src/services/index.ts` | Add ML repository dependency |

### May Need to Modify

| File | Purpose |
|------|---------|
| `server/src/services/smart-info.service.ts` | Verify/fix CLIP for documents |
| `server/src/repositories/ocr.repository.ts` | Add `getByAssetId` if missing |

### New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| jszip | ^3.10.1 | Office document image extraction (Phase 4 only) |

---

## Database Changes

**None required** - Existing schema supports all features:
- `ocr_search` - Text storage with GIN trigram index
- `smart_search` - CLIP embeddings with HNSW vector index
- `asset_job_status` - Job tracking with `documentTextExtractedAt`

---

## Testing Plan

### Unit Tests

```typescript
// document.service.spec.ts
describe('extractTextFromPdf', () => {
  it('should use pdf-parse for text-based PDFs', async () => {
    // Mock pdf-parse returning substantial text
  });

  it('should fall back to OCR for scanned PDFs', async () => {
    // Mock pdf-parse returning minimal text
    // Verify pdftoppm and ML OCR called
  });
});
```

### Integration Tests

1. Upload scanned PDF -> verify text extracted via OCR
2. Upload text-based PDF -> verify pdf-parse used (faster)
3. Search scanned PDF content -> verify results returned
4. Semantic search "invoice" -> verify documents appear in results

### Manual Test Documents

Prepare test files:
- `text-based.pdf` - Normal PDF with selectable text
- `scanned.pdf` - Image-based PDF (scan of document)
- `mixed.pdf` - Some text pages, some scanned pages
- `document-with-images.docx` - DOCX with embedded screenshots

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Performance impact from PDF OCR | Add page limit (100), async job processing |
| ML service overload | Use existing job queue throttling |
| Storage for temp files | Clean up immediately after processing |
| False positive scanned detection | Tune 50 chars/page threshold, add override |
| Large DOCX with many images | Limit embedded image extraction (disabled by default) |

---

## Approval Checklist

Before implementation:

- [ ] Confirm Phase 1 (Scanned PDF OCR) is highest priority
- [ ] Decide on Phase 4 (Embedded Images) - include or defer?
- [ ] Review configuration options
- [ ] Approve test document requirements
