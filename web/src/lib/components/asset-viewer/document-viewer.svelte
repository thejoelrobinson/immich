<script lang="ts">
  import BrokenAsset from '$lib/components/assets/broken-asset.svelte';
  import PdfViewer from '$lib/components/asset-viewer/pdf-viewer.svelte';
  import ContentSearchNav from '$lib/components/asset-viewer/content-search-nav.svelte';
  import { documentSearchManager } from '$lib/stores/document-search.svelte';
  import { getAssetOriginalUrl } from '$lib/utils';
  import type { AssetResponseDto } from '@immich/sdk';
  import { LoadingSpinner } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    asset: AssetResponseDto;
    searchTerm?: string;
    onPreviousAsset?: (() => void) | null;
    onNextAsset?: (() => void) | null;
  }

  let { asset, searchTerm = '', onPreviousAsset = null, onNextAsset = null }: Props = $props();

  let documentLoaded = $state(false);
  let documentError = $state(false);
  let iframeElement = $state<HTMLIFrameElement>();

  const documentUrl = $derived(getAssetOriginalUrl({ id: asset.id, cacheKey: asset.thumbhash }));

  // Get the filename for extension checking (prefer originalPath, fallback to originalFileName)
  const filename = $derived((asset.originalPath || asset.originalFileName || '').toLowerCase());

  // Native PDF - render directly
  const isPdf = $derived(filename.endsWith('.pdf'));

  // Office documents - always converted to PDF via ONLYOFFICE upon upload
  const isOfficeDoc = $derived(
    ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.odt', '.ods', '.odp'].some((ext) => filename.endsWith(ext)),
  );

  // Use PDF viewer for native PDFs and ALL Office documents
  // Office docs are pre-converted to PDF via ONLYOFFICE during text extraction
  // This enables consistent search highlighting across all document types
  const usePdfViewer = $derived(isPdf || isOfficeDoc);

  // Text-based files - render directly in iframe
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

  // Handle iframe event listeners
  $effect(() => {
    const iframe = iframeElement;
    if (iframe) {
      iframe.addEventListener('load', onLoad, { passive: true });
      iframe.addEventListener('error', onError, { passive: true });
      return () => {
        iframe.removeEventListener('load', onLoad);
        iframe.removeEventListener('error', onError);
      };
    }
  });

  // Reset state when asset changes
  $effect(() => {
    const _id = asset.id;
    documentLoaded = false;
    documentError = false;
  });

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' && onPreviousAsset) {
      onPreviousAsset();
    } else if (event.key === 'ArrowRight' && onNextAsset) {
      onNextAsset();
    }
  };
</script>

<svelte:document onkeydown={handleKeydown} />

<!-- Document search navigation bar -->
<ContentSearchNav
  searchState={documentSearchManager}
  onClose={() => documentSearchManager.clear()}
/>

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
      {#if !documentLoaded && !usePdfViewer}
        <div id="spinner" class="absolute inset-0 flex items-center justify-center">
          <LoadingSpinner />
        </div>
      {/if}

      {#if usePdfViewer}
        <!-- PDF viewer using pdf.js for PDFs and Office docs (pre-converted to PDF) -->
        <PdfViewer {asset} {searchTerm} {onPreviousAsset} {onNextAsset} />
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
</style>
