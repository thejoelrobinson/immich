<script lang="ts">
  import { getAssetOriginalUrl, getDocumentPdfUrl } from '$lib/utils';
  import { documentSearchManager, type PageTextPositions, type TextPosition } from '$lib/stores/document-search.svelte';
  import type { AssetResponseDto } from '@immich/sdk';
  import { LoadingSpinner } from '@immich/ui';
  import { onMount, onDestroy, untrack, tick } from 'svelte';
  import * as pdfjsLib from 'pdfjs-dist';

  interface Props {
    asset: AssetResponseDto;
    searchTerm?: string;
    onPreviousAsset?: (() => void) | null;
    onNextAsset?: (() => void) | null;
  }

  let { asset, searchTerm = '', onPreviousAsset = null, onNextAsset = null }: Props = $props();

  // Constants
  // Debounce delay for rapid document navigation - allows container layout to complete
  const PDF_LOAD_DEBOUNCE_MS = 100;
  // Container padding (24px per side) used in scale calculations
  const CONTAINER_PADDING_PX = 24;
  const TOTAL_PADDING = CONTAINER_PADDING_PX * 2;
  // Minimum container dimensions to consider it "ready" for scale calculation
  const MIN_CONTAINER_WIDTH = 100;
  const MIN_CONTAINER_HEIGHT = 100;
  // Maximum time to wait for container to be ready (ms)
  const CONTAINER_READY_TIMEOUT_MS = 2000;
  // Scale bounds: min 0.5 keeps text readable, max prevents excessive memory usage
  const SCALE_MIN = 0.5;
  const SCALE_MAX_FIT = 3.0; // For fit-to-screen calculation
  const SCALE_MAX_ZOOM = 4.0; // For manual zoom
  // Zoom increment for +/- buttons
  const ZOOM_INCREMENT = 0.25;
  // Minimum highlight dimensions to ensure visibility
  const HIGHLIGHT_MIN_WIDTH_PX = 10;
  const HIGHLIGHT_MIN_HEIGHT_PX = 14;

  // PDF.js state
  let pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;
  let currentRenderTask: pdfjsLib.RenderTask | null = null;
  let currentLoadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
  let loadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let renderSequence = 0; // Tracks which render should complete
  let isMounted = true; // Guards against operations after unmount
  let currentPage = $state(1);
  let totalPages = $state(0);
  let scale = $state(1.0); // Will be calculated to fit screen on mount
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

  // Set up PDF.js worker on mount - $effect handles the actual loading
  onMount(() => {
    // Configure worker path for pdf.js using CDN (version must match package.json)
    const pdfjsVersion = '4.10.38';
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.min.mjs`;
    // Note: loadPdf() is triggered by the $effect that tracks asset.id
  });

  // Centralized cleanup to prevent code duplication (DRY principle)
  function cleanup() {
    if (loadDebounceTimer) {
      clearTimeout(loadDebounceTimer);
      loadDebounceTimer = null;
    }
    if (currentLoadingTask) {
      currentLoadingTask.destroy();
      currentLoadingTask = null;
    }
    if (currentRenderTask) {
      currentRenderTask.cancel();
      currentRenderTask = null;
    }
    if (pdfDocument) {
      pdfDocument.destroy();
      pdfDocument = null;
    }
  }

  onDestroy(() => {
    isMounted = false; // Mark as unmounted first to prevent async callbacks
    cleanup();
    pageTextPositions.clear();
  });

  // Wait for container to have valid dimensions using ResizeObserver
  function waitForContainerReady(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!containerElement) {
        resolve(false);
        return;
      }

      // Check if already ready
      if (containerElement.clientWidth >= MIN_CONTAINER_WIDTH &&
          containerElement.clientHeight >= MIN_CONTAINER_HEIGHT) {
        resolve(true);
        return;
      }

      // Set up timeout
      const timeoutId = setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, CONTAINER_READY_TIMEOUT_MS);

      // Use ResizeObserver to wait for container to be properly sized
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width >= MIN_CONTAINER_WIDTH && height >= MIN_CONTAINER_HEIGHT) {
            clearTimeout(timeoutId);
            observer.disconnect();
            resolve(true);
            return;
          }
        }
      });

      observer.observe(containerElement);
    });
  }

  // Calculate scale to fit page within container with padding
  async function calculateFitScale(page: pdfjsLib.PDFPageProxy): Promise<number> {
    if (!containerElement) return 1.0;

    // Get the PDF page dimensions at scale 1.0
    const viewport = page.getViewport({ scale: 1.0 });
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;

    // Get container dimensions (with padding/margin considerations)
    const containerWidth = containerElement.clientWidth - TOTAL_PADDING;
    const containerHeight = containerElement.clientHeight - TOTAL_PADDING;

    // Calculate scale to fit width and height
    const scaleToFitWidth = containerWidth / pageWidth;
    const scaleToFitHeight = containerHeight / pageHeight;

    // Use the smaller scale to ensure page fits entirely
    const fitScale = Math.min(scaleToFitWidth, scaleToFitHeight);

    // Clamp to reasonable bounds
    return Math.max(SCALE_MIN, Math.min(SCALE_MAX_FIT, fitScale));
  }

  async function loadPdf() {
    if (!isMounted) return;

    isLoading = true;
    loadError = null;

    // Note: cleanup() is called by $effect before loadPdf, not here
    // This prevents clearing the debounce timer

    try {
      // Add cache-busting parameter to prevent browser caching partial responses
      // This helps avoid "Bad end offset" errors from stale/incomplete cached data
      const urlWithCacheBust = `${documentUrl}${documentUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;

      // Use withCredentials to pass authentication cookies
      // Disable streaming and range requests to prevent "Bad end offset" errors
      // These errors occur when PDF.js tries to read past incomplete cached data
      const loadingTask = pdfjsLib.getDocument({
        url: urlWithCacheBust,
        withCredentials: true,
        disableAutoFetch: true,  // Don't fetch the entire file automatically
        disableStream: true,     // Don't use streaming - wait for full download
        disableRange: true,      // Don't use range requests - prevents partial caching issues
      });
      currentLoadingTask = loadingTask;
      const newPdfDocument = await loadingTask.promise;

      // Check if this task is still current (wasn't cancelled during load)
      if (currentLoadingTask !== loadingTask || !isMounted) {
        newPdfDocument.destroy();
        return;
      }

      currentLoadingTask = null;
      pdfDocument = newPdfDocument;

      // Guard against null document after successful load
      if (!pdfDocument) {
        throw new Error('PDF document is null after successful load');
      }

      totalPages = pdfDocument.numPages;

      // Load search matches if search term provided
      if (searchTerm && isMounted) {
        await documentSearchManager.loadMatches(asset.id, searchTerm);
        // Navigate to first match's page if there are matches
        if (documentSearchManager.hasMatches && documentSearchManager.currentMatch) {
          currentPage = documentSearchManager.currentMatch.pageNumber;
        }
      }

      // Wait for container to be properly sized using ResizeObserver
      // This is more reliable than RAF for cases like opening from search
      const containerReady = await waitForContainerReady();

      // Re-check if we're still current after waiting
      if (!pdfDocument || pdfDocument !== newPdfDocument || !isMounted) {
        return;
      }

      // Calculate initial scale to fit screen after PDF is loaded
      if (containerReady && containerElement) {
        const firstPage = await pdfDocument.getPage(currentPage);
        scale = await calculateFitScale(firstPage);
      } else {
        // Container not ready after timeout, use default scale
        // User can click "Fit" button to fix
        scale = 1.0;
      }

      // IMPORTANT: Set isLoading = false BEFORE renderPage so the canvas element
      // is rendered in the DOM. Otherwise canvasElement is undefined and render fails.
      isLoading = false;
      await tick(); // Wait for Svelte to update DOM and bind canvasElement

      await renderPage(currentPage);
    } catch (error: unknown) {
      // Ignore cancellation errors - PDF.js throws these when loading is cancelled
      if (error instanceof Error) {
        if (error.name === 'AbortException' || error.message.includes('destroyed')) {
          return; // Expected cancellation, not an error
        }
        // Also ignore "Bad end offset" errors during navigation - user can retry
        if (error.message.includes('Bad end offset')) {
          return;
        }
      }
      const errorMessage = error instanceof Error ? error.message : 'Failed to load PDF';
      loadError = errorMessage;
    } finally {
      isLoading = false;
    }
  }

  async function renderPage(pageNum: number) {
    if (!pdfDocument || !canvasElement || !isMounted) return;

    // Generate sequence number to track which render should complete
    const currentSequence = ++renderSequence;

    // Cancel any ongoing render operation before starting a new one
    const taskToCancel = currentRenderTask;
    currentRenderTask = null;
    if (taskToCancel) {
      taskToCancel.cancel();
    }

    try {
      const page = await pdfDocument.getPage(pageNum);

      // Check if we're still current after async operation
      if (currentSequence !== renderSequence || !isMounted) return;

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

      // Only clear if this sequence is still current
      if (currentSequence === renderSequence) {
        currentRenderTask = null;
      }

      // Fetch text positions for this page and render highlights
      if (isMounted) {
        await fetchAndRenderHighlights(pageNum, viewport);
      }
    } catch (error: unknown) {
      // Ignore cancellation errors - they're expected when navigating quickly
      if (error instanceof Error && error.message.includes('Rendering cancelled')) {
        return;
      }
      // Non-critical: page render failed, user can try navigating again
      // No action needed - the page simply won't display
    }
  }

  async function fetchAndRenderHighlights(pageNum: number, viewport: pdfjsLib.PageViewport) {
    if (!searchTerm || !highlightLayerElement || !isMounted) return;

    // Check if we have cached positions for this page
    let positions = pageTextPositions.get(pageNum);

    if (!positions) {
      try {
        const response = await fetch(`/api/documents/${asset.id}/pages/${pageNum}/text-positions`);

        // Check if still mounted after async fetch
        if (!isMounted) return;

        if (response.ok) {
          positions = await response.json() as PageTextPositions;

          // Check again after second async operation
          if (!isMounted) return;

          pageTextPositions.set(pageNum, positions);
        }
      } catch (error: unknown) {
        // Expected: fetch can fail when navigating away or due to network issues
        // This is non-critical - highlights simply won't render for this page
        // The document remains viewable without search highlighting
        void error; // Acknowledge the error is intentionally ignored
      }
    }

    if (positions && isMounted) {
      renderHighlights(pageNum, positions, viewport);
    }
  }

  function renderHighlights(
    pageNum: number,
    positions: PageTextPositions | undefined,
    viewport: { width: number; height: number },
  ) {
    if (!highlightLayerElement) return;

    // Clear existing highlights
    highlightLayerElement.innerHTML = '';
    highlightLayerElement.style.width = `${viewport.width}px`;
    highlightLayerElement.style.height = `${viewport.height}px`;

    if (!positions?.textItems || !searchTerm) return;

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

        highlights.push({
          x,
          y,
          width: Math.max(width, HIGHLIGHT_MIN_WIDTH_PX),
          height: Math.max(height, HIGHLIGHT_MIN_HEIGHT_PX),
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
    scale = Math.min(scale + ZOOM_INCREMENT, SCALE_MAX_ZOOM);
    renderPage(currentPage);
  }

  function zoomOut() {
    scale = Math.max(scale - ZOOM_INCREMENT, SCALE_MIN);
    renderPage(currentPage);
  }

  async function fitToScreen() {
    if (!pdfDocument || !containerElement) return;
    const page = await pdfDocument.getPage(currentPage);
    scale = await calculateFitScale(page);
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

  // Re-render when asset changes (with debounce for rapid navigation)
  $effect(() => {
    asset.id; // Track dependency
    untrack(() => {
      // Show loading immediately for user feedback
      isLoading = true;
      loadError = null;

      // Clear any pending load
      if (loadDebounceTimer) {
        clearTimeout(loadDebounceTimer);
      }

      // Cleanup previous state immediately to prevent stale renders
      cleanup();
      pageTextPositions = new Map();
      currentPage = 1;

      // Debounce the actual load to prevent rapid-fire requests
      // This gives the UI time to settle and ensures container is sized
      loadDebounceTimer = setTimeout(() => {
        loadDebounceTimer = null;
        if (isMounted) {
          loadPdf();
        }
      }, PDF_LOAD_DEBOUNCE_MS);
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
      <button onclick={fitToScreen} class="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs" title="Fit to screen">
        Fit
      </button>
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
