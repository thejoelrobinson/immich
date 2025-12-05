<script lang="ts">
  import { getAssetOriginalUrl, getDocumentPdfUrl } from '$lib/utils';
  import { documentSearchManager, type PageTextPositions, type TextPosition } from '$lib/stores/document-search.svelte';
  import type { AssetResponseDto } from '@immich/sdk';
  import { LoadingSpinner } from '@immich/ui';
  import { onMount, onDestroy, untrack } from 'svelte';
  import * as pdfjsLib from 'pdfjs-dist';

  interface Props {
    asset: AssetResponseDto;
    searchTerm?: string;
    onPreviousAsset?: (() => void) | null;
    onNextAsset?: (() => void) | null;
  }

  let { asset, searchTerm = '', onPreviousAsset = null, onNextAsset = null }: Props = $props();

  // PDF.js state
  let pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;
  let currentRenderTask: pdfjsLib.RenderTask | null = null;
  let currentPage = $state(1);
  let totalPages = $state(0);
  let scale = $state(1.5);
  let isLoading = $state(true);
  let loadError = $state<string | null>(null);

  // Canvas and container refs
  let containerElement = $state<HTMLDivElement>();
  let canvasElement = $state<HTMLCanvasElement>();
  let highlightLayerElement = $state<HTMLDivElement>();

  // Page text positions cache
  let pageTextPositions = $state<Map<number, PageTextPositions>>(new Map());

  // Get the filename to detect Office documents
  const filename = $derived((asset.originalPath || asset.originalFileName || '').toLowerCase());
  const isOfficeDoc = $derived(
    ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.odt', '.ods', '.odp'].some((ext) => filename.endsWith(ext)),
  );

  // Use PDF conversion URL for Office docs, original URL for native PDFs
  const documentUrl = $derived(
    isOfficeDoc
      ? getDocumentPdfUrl({ id: asset.id, cacheKey: asset.thumbhash })
      : getAssetOriginalUrl({ id: asset.id, cacheKey: asset.thumbhash }),
  );
  const currentMatch = $derived(documentSearchManager.currentMatch);

  // Set up PDF.js worker
  onMount(async () => {
    // Configure worker path for pdf.js using CDN (version must match package.json)
    const pdfjsVersion = '4.10.38';
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.min.mjs`;

    await loadPdf();
  });

  onDestroy(() => {
    // Cancel any ongoing render operation
    if (currentRenderTask) {
      currentRenderTask.cancel();
      currentRenderTask = null;
    }
    if (pdfDocument) {
      pdfDocument.destroy();
      pdfDocument = null;
    }
    // Clear cached text positions to prevent memory leak
    pageTextPositions.clear();
  });

  async function loadPdf() {
    isLoading = true;
    loadError = null;

    console.log('[PdfViewer] Loading PDF from:', documentUrl, 'isOfficeDoc:', isOfficeDoc);

    try {
      // Use withCredentials to pass authentication cookies
      const loadingTask = pdfjsLib.getDocument({
        url: documentUrl,
        withCredentials: true,
      });
      pdfDocument = await loadingTask.promise;
      totalPages = pdfDocument.numPages;
      console.log('[PdfViewer] PDF loaded successfully, pages:', totalPages);

      // Load search matches if search term provided
      if (searchTerm) {
        await documentSearchManager.loadMatches(asset.id, searchTerm);
        // Navigate to first match's page if there are matches
        if (documentSearchManager.hasMatches && documentSearchManager.currentMatch) {
          currentPage = documentSearchManager.currentMatch.pageNumber;
        }
      }

      await renderPage(currentPage);
    } catch (error) {
      console.error('Failed to load PDF:', error);
      loadError = error instanceof Error ? error.message : 'Failed to load PDF';
    } finally {
      isLoading = false;
    }
  }

  async function renderPage(pageNum: number) {
    if (!pdfDocument || !canvasElement) return;

    // Cancel any ongoing render operation before starting a new one
    // Store reference before nullifying to avoid race condition
    const taskToCancel = currentRenderTask;
    currentRenderTask = null;
    if (taskToCancel) {
      taskToCancel.cancel();
    }

    try {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = canvasElement;
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      // Store the render task so we can cancel it if needed
      currentRenderTask = page.render(renderContext);
      await currentRenderTask.promise;
      currentRenderTask = null;

      // Fetch text positions for this page and render highlights
      await fetchAndRenderHighlights(pageNum, viewport);
    } catch (error) {
      // Ignore cancellation errors - they're expected when navigating quickly
      if (error instanceof Error && error.message.includes('Rendering cancelled')) {
        return;
      }
      console.error(`Failed to render page ${pageNum}:`, error);
    }
  }

  async function fetchAndRenderHighlights(pageNum: number, viewport: pdfjsLib.PageViewport) {
    if (!searchTerm || !highlightLayerElement) return;

    // Check if we have cached positions for this page
    let positions = pageTextPositions.get(pageNum);

    if (!positions) {
      try {
        const response = await fetch(`/api/documents/${asset.id}/pages/${pageNum}/text-positions`);
        if (response.ok) {
          positions = await response.json() as PageTextPositions;
          pageTextPositions.set(pageNum, positions);
        }
      } catch (error) {
        console.error(`Failed to fetch text positions for page ${pageNum}:`, error);
      }
    }

    if (positions) {
      renderHighlights(pageNum, positions, viewport);
    }
  }

  function renderHighlights(
    pageNum: number,
    positions: PageTextPositions | undefined,
    viewport: { width: number; height: number },
  ) {
    console.log('[renderHighlights] pageNum:', pageNum, 'positions:', positions, 'searchTerm:', searchTerm);

    if (!highlightLayerElement) {
      console.log('[renderHighlights] No highlightLayerElement');
      return;
    }

    // Clear existing highlights
    highlightLayerElement.innerHTML = '';
    highlightLayerElement.style.width = `${viewport.width}px`;
    highlightLayerElement.style.height = `${viewport.height}px`;

    if (!positions?.textItems || !searchTerm) {
      console.log('[renderHighlights] No textItems or searchTerm:', { hasTextItems: !!positions?.textItems, searchTerm });
      return;
    }

    // Find all matches of the search term in the page text
    const searchLower = searchTerm.toLowerCase();
    const pageText = positions.text.toLowerCase();
    const matchIndices: { start: number; end: number }[] = [];

    let searchIndex = 0;
    while ((searchIndex = pageText.indexOf(searchLower, searchIndex)) !== -1) {
      matchIndices.push({ start: searchIndex, end: searchIndex + searchTerm.length });
      searchIndex += 1; // Move forward to find overlapping matches
    }

    if (matchIndices.length === 0) return;

    // Map text positions to page coordinates
    // The textItems contain normalized 0-1 coordinates
    const highlights = calculateHighlightRects(positions.textItems, matchIndices, viewport);

    // Render highlight divs
    for (const highlight of highlights) {
      const isCurrentMatch = isHighlightCurrentMatch(pageNum, highlight.matchIndex);
      const div = document.createElement('div');
      div.className = `highlight-rect ${isCurrentMatch ? 'current-match' : ''}`;
      div.style.cssText = `
        position: absolute;
        left: ${highlight.x}px;
        top: ${highlight.y}px;
        width: ${highlight.width}px;
        height: ${highlight.height}px;
        background-color: ${isCurrentMatch ? 'rgba(255, 165, 0, 0.5)' : 'rgba(255, 255, 0, 0.4)'};
        pointer-events: none;
        border-radius: 2px;
      `;
      highlightLayerElement.appendChild(div);
    }
  }

  function isHighlightCurrentMatch(pageNum: number, matchIndexOnPage: number): boolean {
    if (!currentMatch) return false;
    if (currentMatch.pageNumber !== pageNum) return false;

    // Check if this is the current match based on the global match index
    const matchesOnPreviousPages = documentSearchManager.matches.filter(
      (m) => m.pageNumber < pageNum,
    ).length;

    return documentSearchManager.currentMatchIndex === matchesOnPreviousPages + matchIndexOnPage;
  }

  interface HighlightRect {
    x: number;
    y: number;
    width: number;
    height: number;
    matchIndex: number;
  }

  function calculateHighlightRects(
    textItems: TextPosition[],
    matchIndices: { start: number; end: number }[],
    viewport: { width: number; height: number },
  ): HighlightRect[] {
    const highlights: HighlightRect[] = [];

    // Build a character position map from text items
    let charOffset = 0;
    const charPositions: { item: TextPosition; localOffset: number }[] = [];

    for (const item of textItems) {
      for (let i = 0; i < item.text.length; i++) {
        charPositions.push({ item, localOffset: i });
      }
      charOffset += item.text.length;
      // Account for implicit space between items
      charPositions.push({ item, localOffset: item.text.length - 1 });
    }

    // For each match, find the bounding boxes of the characters
    for (let matchIdx = 0; matchIdx < matchIndices.length; matchIdx++) {
      const match = matchIndices[matchIdx];
      const itemsInMatch = new Set<TextPosition>();

      for (let i = match.start; i < match.end && i < charPositions.length; i++) {
        itemsInMatch.add(charPositions[i].item);
      }

      // Create highlight rect for each text item that's part of the match
      for (const item of itemsInMatch) {
        // Convert normalized 0-1 coordinates to viewport pixels
        // Server stores Y as baseline position (after flipping from PDF coords)
        // Subtract height to get the top of the text box
        const x = item.x * viewport.width;
        const width = item.width * viewport.width;
        const height = item.height * viewport.height;
        // Subtract height to position at top of text (Y is baseline position)
        const y = (item.y - item.height) * viewport.height;

        console.log('[Highlight] item:', item.text, 'normalized:', { x: item.x, y: item.y, w: item.width, h: item.height },
          'pixels:', { x, y, width, height }, 'viewport:', viewport);

        highlights.push({
          x,
          y,
          width: Math.max(width, 10), // Minimum width
          height: Math.max(height, 14), // Minimum height
          matchIndex: matchIdx,
        });
      }
    }

    return highlights;
  }

  // Navigation functions
  function goToPage(pageNum: number) {
    if (pageNum >= 1 && pageNum <= totalPages && pageNum !== currentPage) {
      currentPage = pageNum;
      renderPage(currentPage);
    }
  }

  function prevPage() {
    goToPage(currentPage - 1);
  }

  function nextPage() {
    goToPage(currentPage + 1);
  }

  function zoomIn() {
    scale = Math.min(scale + 0.25, 4);
    renderPage(currentPage);
  }

  function zoomOut() {
    scale = Math.max(scale - 0.25, 0.5);
    renderPage(currentPage);
  }

  // Handle keyboard navigation
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') {
      if (event.shiftKey && onPreviousAsset) {
        onPreviousAsset();
      } else {
        prevPage();
      }
    } else if (event.key === 'ArrowRight') {
      if (event.shiftKey && onNextAsset) {
        onNextAsset();
      } else {
        nextPage();
      }
    } else if (event.key === 'ArrowUp') {
      zoomIn();
    } else if (event.key === 'ArrowDown') {
      zoomOut();
    }
  }

  // React to search match navigation and re-render highlights
  $effect(() => {
    const match = documentSearchManager.currentMatch;

    // Navigate to page if match is on a different page
    if (match && match.pageNumber !== currentPage) {
      untrack(() => goToPage(match.pageNumber));
    }

    // Re-render highlights for current page when match changes
    if (pdfDocument && canvasElement) {
      untrack(async () => {
        const page = await pdfDocument!.getPage(currentPage);
        const viewport = page.getViewport({ scale });
        renderHighlights(currentPage, pageTextPositions.get(currentPage), viewport);
      });
    }
  });

  // Re-render when asset changes
  $effect(() => {
    const _ = asset.id;
    untrack(() => {
      pageTextPositions = new Map();
      currentPage = 1;
      loadPdf();
    });
  });
</script>

<svelte:document onkeydown={handleKeydown} />

<div class="h-full w-full flex flex-col bg-gray-900">
  <!-- Spacer for navbar -->
  <div class="h-16 shrink-0"></div>

  <!-- PDF Controls -->
  <div class="shrink-0 flex items-center justify-center gap-4 py-2 bg-gray-800 text-white">
    <!-- Page navigation -->
    <div class="flex items-center gap-2">
      <button
        onclick={prevPage}
        disabled={currentPage <= 1}
        class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        &lt;
      </button>
      <span class="text-sm">
        Page {currentPage} of {totalPages}
      </span>
      <button
        onclick={nextPage}
        disabled={currentPage >= totalPages}
        class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        &gt;
      </button>
    </div>

    <!-- Zoom controls -->
    <div class="flex items-center gap-2 border-l border-gray-600 pl-4">
      <button onclick={zoomOut} class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600"> - </button>
      <span class="text-sm w-16 text-center">{Math.round(scale * 100)}%</span>
      <button onclick={zoomIn} class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600"> + </button>
    </div>
  </div>

  <!-- Content area -->
  <div class="flex-1 relative min-h-0 overflow-auto" bind:this={containerElement}>
    {#if isLoading}
      <div class="absolute inset-0 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    {:else if loadError}
      <div class="absolute inset-0 flex items-center justify-center text-red-500">
        <div class="text-center">
          <p class="text-xl mb-2">Failed to load PDF</p>
          <p class="text-sm opacity-75">{loadError}</p>
        </div>
      </div>
    {:else}
      <div class="flex justify-center p-4">
        <div class="relative shadow-lg">
          <canvas bind:this={canvasElement} class="bg-white"></canvas>
          <!-- Highlight overlay layer -->
          <div
            bind:this={highlightLayerElement}
            class="absolute top-0 left-0 pointer-events-none"
          ></div>
        </div>
      </div>
    {/if}
  </div>
</div>
