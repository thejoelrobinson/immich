<script lang="ts">
  import BrokenAsset from '$lib/components/assets/broken-asset.svelte';
  import { getAssetOriginalUrl, getDocumentPdfUrl } from '$lib/utils';
  import type { AssetResponseDto } from '@immich/sdk';
  import { LoadingSpinner } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import mammoth from 'mammoth';
  import * as XLSX from 'xlsx';

  interface Props {
    asset: AssetResponseDto;
    onPreviousAsset?: (() => void) | null;
    onNextAsset?: (() => void) | null;
  }

  let { asset, onPreviousAsset = null, onNextAsset = null }: Props = $props();

  let documentLoaded = $state(false);
  let documentError = $state(false);
  let iframeElement = $state<HTMLIFrameElement>();
  let docxHtml = $state<string>('');
  let xlsxHtml = $state<string>('');
  let pptxContainer = $state<HTMLDivElement>();
  let currentSlide = $state(0);
  let totalSlides = $state(0);

  const documentUrl = $derived(getAssetOriginalUrl({ id: asset.id, cacheKey: asset.thumbhash }));
  const pdfUrl = $derived(getDocumentPdfUrl({ id: asset.id, cacheKey: asset.thumbhash }));

  // Get the filename for extension checking (prefer originalPath, fallback to originalFileName)
  const filename = $derived((asset.originalPath || asset.originalFileName || '').toLowerCase());

  const isPdf = $derived(filename.endsWith('.pdf'));
  const isDocx = $derived(filename.endsWith('.docx'));
  const isPptx = $derived(filename.endsWith('.pptx') || filename.endsWith('.ppt'));
  const isXlsx = $derived(filename.endsWith('.xlsx') || filename.endsWith('.xls'));
  const isOldOfficeDoc = $derived(filename.endsWith('.doc') || filename.endsWith('.odt'));
  const isText = $derived(
    ['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.rtf'].some((ext) => filename.endsWith(ext)),
  );

  const onLoad = () => {
    documentLoaded = true;
  };

  const onError = () => {
    documentError = true;
    documentLoaded = true;
  };

  // Load DOCX file and convert to HTML using mammoth
  const loadDocx = async () => {
    try {
      const response = await fetch(documentUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch document');
      }
      const arrayBuffer = await response.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      docxHtml = result.value;
      documentLoaded = true;
    } catch (error) {
      console.error('Failed to load DOCX:', error);
      documentError = true;
      documentLoaded = true;
    }
  };

  // Load XLSX file and convert to HTML using SheetJS
  const loadXlsx = async () => {
    try {
      const response = await fetch(documentUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch document');
      }
      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      // Convert all sheets to HTML
      let html = '';
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        html += `<div class="sheet-container mb-8">`;
        html += `<h2 class="text-lg font-semibold mb-4 text-gray-700">${sheetName}</h2>`;
        html += XLSX.utils.sheet_to_html(sheet, { editable: false });
        html += `</div>`;
      }
      xlsxHtml = html;
      documentLoaded = true;
    } catch (error) {
      console.error('Failed to load XLSX:', error);
      documentError = true;
      documentLoaded = true;
    }
  };

  // Load PPTX file using pptx-preview
  let pptxPreviewer: {
    slideCount: number;
    preview: (file: ArrayBuffer) => Promise<unknown>;
    renderNextSlide: () => void;
    renderPreSlide: () => void;
    destroy: () => void;
  } | null = null;

  const loadPptx = async () => {
    try {
      const response = await fetch(documentUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch document');
      }
      const arrayBuffer = await response.arrayBuffer();

      // Dynamic import of pptx-preview (browser-only)
      const pptxPreview = await import('pptx-preview');

      if (pptxContainer) {
        // Clear previous content
        pptxContainer.innerHTML = '';

        // Initialize the previewer with 'list' mode to show all slides
        pptxPreviewer = pptxPreview.init(pptxContainer, {
          mode: 'list',
          width: 960,
        });

        // Load and preview the PPTX
        await pptxPreviewer.preview(arrayBuffer);

        // Get slide count
        totalSlides = pptxPreviewer.slideCount || 1;
        currentSlide = 1;
      }

      documentLoaded = true;
    } catch (error) {
      console.error('Failed to load PPTX:', error);
      documentError = true;
      documentLoaded = true;
    }
  };

  const nextSlide = () => {
    if (currentSlide < totalSlides) {
      currentSlide++;
      scrollToSlide(currentSlide);
    }
  };

  const prevSlide = () => {
    if (currentSlide > 1) {
      currentSlide--;
      scrollToSlide(currentSlide);
    }
  };

  const scrollToSlide = (slideNum: number) => {
    if (pptxContainer) {
      const slides = pptxContainer.querySelectorAll('.slide-container, .pptx-slide, [class*="slide"]');
      const targetSlide = slides[slideNum - 1];
      if (targetSlide) {
        targetSlide.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  onMount(() => {
    if (isDocx) {
      loadDocx();
    } else if (isXlsx) {
      loadXlsx();
    } else if (isPptx) {
      loadPptx();
    } else if (iframeElement) {
      iframeElement.addEventListener('load', onLoad, { passive: true });
      iframeElement.addEventListener('error', onError, { passive: true });
    }
    return () => {
      if (iframeElement) {
        iframeElement.removeEventListener('load', onLoad);
        iframeElement.removeEventListener('error', onError);
      }
    };
  });

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      if (isPptx && currentSlide > 1) {
        prevSlide();
      } else if (onPreviousAsset) {
        onPreviousAsset();
      }
    } else if (event.key === 'ArrowRight') {
      if (isPptx && currentSlide < totalSlides) {
        nextSlide();
      } else if (onNextAsset) {
        onNextAsset();
      }
    }
  };
</script>

<svelte:document onkeydown={handleKeydown} />

{#if documentError}
  <div class="h-full w-full flex flex-col">
    <!-- Spacer for navbar -->
    <div class="h-16 shrink-0"></div>
    <div class="flex-1 flex items-center justify-center">
      <BrokenAsset class="text-xl h-full w-full" />
    </div>
  </div>
{:else}
  <div class="h-full w-full flex flex-col bg-gray-900">
    <!-- Spacer for navbar -->
    <div class="h-16 shrink-0"></div>

    <!-- Content area -->
    <div class="flex-1 relative min-h-0">
      {#if !documentLoaded}
        <div id="spinner" class="absolute inset-0 flex items-center justify-center">
          <LoadingSpinner />
        </div>
      {/if}

      {#if isPdf}
        <!-- PDF viewer using native browser rendering -->
        <iframe
          bind:this={iframeElement}
          src={documentUrl}
          title={asset.originalFileName || $t('document')}
          class="absolute inset-0 w-full h-full border-0"
          class:opacity-0={!documentLoaded}
          class:opacity-100={documentLoaded}
        ></iframe>
      {:else if isDocx}
        <!-- Word document viewer using mammoth.js -->
        <div
          class="absolute inset-0 overflow-auto bg-white p-8"
          class:opacity-0={!documentLoaded}
          class:opacity-100={documentLoaded}
        >
          <div class="max-w-4xl mx-auto prose prose-sm sm:prose lg:prose-lg">
            {@html docxHtml}
          </div>
        </div>
      {:else if isXlsx}
        <!-- Excel viewer using SheetJS -->
        <div
          class="absolute inset-0 overflow-auto bg-white p-8"
          class:opacity-0={!documentLoaded}
          class:opacity-100={documentLoaded}
        >
          <div class="xlsx-viewer">
            {@html xlsxHtml}
          </div>
        </div>
      {:else if isPptx}
        <!-- PowerPoint viewer using pptx-preview -->
        <div
          class="absolute inset-0 overflow-auto bg-gray-800"
          class:opacity-0={!documentLoaded}
          class:opacity-100={documentLoaded}
        >
          <!-- Slide navigation -->
          {#if totalSlides > 1}
            <div class="sticky top-0 z-10 bg-gray-900/90 backdrop-blur-sm p-2 flex items-center justify-center gap-4">
              <button
                onclick={prevSlide}
                disabled={currentSlide <= 1}
                class="px-4 py-2 bg-immich-primary hover:bg-immich-primary/80 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-white transition-colors"
              >
                ← {$t('previous')}
              </button>
              <span class="text-white">
                Slide {currentSlide} / {totalSlides}
              </span>
              <button
                onclick={nextSlide}
                disabled={currentSlide >= totalSlides}
                class="px-4 py-2 bg-immich-primary hover:bg-immich-primary/80 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-white transition-colors"
              >
                {$t('next')} →
              </button>
            </div>
          {/if}
          <div bind:this={pptxContainer} class="pptx-container p-4 flex flex-col items-center gap-8"></div>
        </div>
      {:else if isOldOfficeDoc}
        <!-- Old Office formats (DOC, ODT) - use LibreOffice PDF conversion -->
        <iframe
          bind:this={iframeElement}
          src={pdfUrl}
          title={asset.originalFileName || $t('document')}
          class="absolute inset-0 w-full h-full border-0"
          class:opacity-0={!documentLoaded}
          class:opacity-100={documentLoaded}
        ></iframe>
      {:else if isText}
        <!-- Text file viewer using iframe -->
        <iframe
          bind:this={iframeElement}
          src={documentUrl}
          title={asset.originalFileName || $t('document')}
          class="absolute inset-0 w-full h-full border-0 bg-white"
          class:opacity-0={!documentLoaded}
          class:opacity-100={documentLoaded}
        ></iframe>
      {:else}
        <!-- Other document types - show download prompt -->
        <div class="h-full flex flex-col items-center justify-center gap-4 text-white p-8">
          <div class="text-6xl">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-24 w-24"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h2 class="text-xl font-semibold">{asset.originalFileName}</h2>
          <p class="text-gray-400">{$t('document_preview_not_available')}</p>
          <a
            href={documentUrl}
            download={asset.originalFileName}
            class="mt-4 px-6 py-2 bg-immich-primary hover:bg-immich-primary/80 rounded-lg text-white transition-colors"
          >
            {$t('download')}
          </a>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  @keyframes delayedVisibility {
    to {
      visibility: visible;
    }
  }
  #spinner {
    visibility: hidden;
    animation: 0s linear 0.4s forwards delayedVisibility;
  }

  /* Excel table styling */
  .xlsx-viewer :global(table) {
    border-collapse: collapse;
    width: 100%;
    font-size: 14px;
  }

  .xlsx-viewer :global(th),
  .xlsx-viewer :global(td) {
    border: 1px solid #e5e7eb;
    padding: 8px 12px;
    text-align: left;
  }

  .xlsx-viewer :global(th) {
    background-color: #f3f4f6;
    font-weight: 600;
  }

  .xlsx-viewer :global(tr:nth-child(even)) {
    background-color: #f9fafb;
  }

  .xlsx-viewer :global(tr:hover) {
    background-color: #f3f4f6;
  }

  /* PowerPoint slide styling */
  .pptx-container :global(.slide-container),
  .pptx-container :global(.pptx-slide),
  .pptx-container :global([class*='slide']) {
    background: white;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    max-width: 960px;
    width: 100%;
    margin: 0 auto;
  }
</style>
