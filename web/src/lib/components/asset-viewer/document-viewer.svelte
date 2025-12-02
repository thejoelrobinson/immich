<script lang="ts">
  import BrokenAsset from '$lib/components/assets/broken-asset.svelte';
  import { getAssetOriginalUrl } from '$lib/utils';
  import type { AssetResponseDto } from '@immich/sdk';
  import { LoadingSpinner } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    asset: AssetResponseDto;
    onPreviousAsset?: (() => void) | null;
    onNextAsset?: (() => void) | null;
  }

  let { asset, onPreviousAsset = null, onNextAsset = null }: Props = $props();

  let documentLoaded = $state(false);
  let documentError = $state(false);
  let iframeElement = $state<HTMLIFrameElement>();

  const documentUrl = $derived(getAssetOriginalUrl({ id: asset.id, cacheKey: asset.thumbhash }));

  const isPdf = $derived(asset.originalPath?.toLowerCase().endsWith('.pdf') ?? false);
  const isText = $derived(
    ['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm'].some((ext) =>
      asset.originalPath?.toLowerCase().endsWith(ext),
    ),
  );

  const onLoad = () => {
    documentLoaded = true;
  };

  const onError = () => {
    documentError = true;
    documentLoaded = true;
  };

  onMount(() => {
    if (iframeElement) {
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
    if (event.key === 'ArrowLeft' && onPreviousAsset) {
      onPreviousAsset();
    } else if (event.key === 'ArrowRight' && onNextAsset) {
      onNextAsset();
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
            <svg xmlns="http://www.w3.org/2000/svg" class="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
