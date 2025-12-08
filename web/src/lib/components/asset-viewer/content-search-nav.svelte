<script lang="ts">
  import {
    type AnyContentMatch,
    type ContentSearchState,
    isDocumentMatch,
    isTranscriptionMatch,
    formatTimestamp,
  } from '$lib/stores/content-search.svelte';
  import { mdiChevronUp, mdiChevronDown, mdiClose, mdiPlay, mdiFileDocumentOutline } from '@mdi/js';
  import { Icon } from '@immich/ui';

  interface Props {
    searchState: ContentSearchState<AnyContentMatch>;
    onNavigate?: (match: AnyContentMatch) => void;
    onClose?: () => void;
  }

  let { searchState, onNavigate, onClose }: Props = $props();

  const searchTerm = $derived(searchState.searchTerm);
  const currentIndex = $derived(searchState.currentMatchIndex);
  const totalMatches = $derived(searchState.totalMatches);
  const currentMatch = $derived(searchState.currentMatch);
  const isLoading = $derived(searchState.isLoading);
  const hasMatches = $derived(searchState.hasMatches);

  function handlePrev() {
    searchState.prevMatch();
    navigateToCurrentMatch();
  }

  function handleNext() {
    searchState.nextMatch();
    navigateToCurrentMatch();
  }

  function navigateToCurrentMatch() {
    const match = searchState.currentMatch;
    if (match) {
      onNavigate?.(match);
    }
  }

  function handleClose() {
    searchState.clear();
    onClose?.();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'F3' || (event.ctrlKey && event.key === 'g')) {
      event.preventDefault();
      if (event.shiftKey) {
        handlePrev();
      } else {
        handleNext();
      }
    } else if (event.key === 'Escape') {
      handleClose();
    }
  }
</script>

<svelte:document onkeydown={handleKeydown} />

{#if searchTerm}
  <div
    class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800/95 text-white shadow-lg backdrop-blur-sm"
  >
    <!-- Search term display -->
    <div class="flex items-center gap-2 pr-3 border-r border-gray-600">
      <span class="text-sm font-medium max-w-48 truncate" title={searchTerm}>
        "{searchTerm}"
      </span>
    </div>

    <!-- Match counter with position info -->
    <div class="flex items-center gap-2 px-2">
      {#if isLoading}
        <span class="text-sm text-gray-400">Searching...</span>
      {:else if hasMatches && currentMatch}
        <div class="flex flex-col items-start">
          <span class="text-sm">
            {currentIndex + 1} of {totalMatches}
          </span>
          <div class="flex items-center gap-2 text-xs text-gray-400">
            {#if isDocumentMatch(currentMatch)}
              <span class="font-mono">Page {currentMatch.pageNumber}</span>
            {:else if isTranscriptionMatch(currentMatch)}
              <span class="font-mono">{formatTimestamp(currentMatch.startTime)}</span>
              {#if currentMatch.speaker}
                <span class="px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-300 text-xs">
                  {currentMatch.speaker}
                </span>
              {/if}
            {/if}
          </div>
        </div>
      {:else}
        <span class="text-sm text-gray-400">No matches</span>
      {/if}
    </div>

    <!-- Navigate/Play button -->
    {#if hasMatches && currentMatch && !isLoading}
      <button
        onclick={navigateToCurrentMatch}
        class="p-1.5 rounded hover:bg-blue-600 bg-blue-600/50 transition-colors"
        title={isDocumentMatch(currentMatch) ? 'Go to page' : 'Jump to timestamp'}
      >
        <Icon icon={isDocumentMatch(currentMatch) ? mdiFileDocumentOutline : mdiPlay} size="18" />
      </button>
    {/if}

    <!-- Navigation buttons -->
    {#if hasMatches && !isLoading}
      <div class="flex items-center gap-1 pl-2 border-l border-gray-600">
        <button
          onclick={handlePrev}
          class="p-1 rounded hover:bg-gray-700 transition-colors"
          title="Previous match (Shift+F3)"
        >
          <Icon icon={mdiChevronUp} size="20" />
        </button>
        <button
          onclick={handleNext}
          class="p-1 rounded hover:bg-gray-700 transition-colors"
          title="Next match (F3)"
        >
          <Icon icon={mdiChevronDown} size="20" />
        </button>
      </div>
    {/if}

    <!-- Close button -->
    <button
      onclick={handleClose}
      class="p-1 rounded hover:bg-gray-700 transition-colors ml-1"
      title="Close search (Esc)"
    >
      <Icon icon={mdiClose} size="18" />
    </button>
  </div>

  <!-- Text snippet preview (above the nav bar) -->
  {#if hasMatches && currentMatch && !isLoading}
    <div
      class="fixed bottom-40 left-1/2 -translate-x-1/2 z-50 max-w-md px-4 py-2 rounded-lg bg-gray-900/90 text-white shadow-lg backdrop-blur-sm"
    >
      <p class="text-sm text-gray-300 line-clamp-2">
        {currentMatch.textSnippet}
      </p>
    </div>
  {/if}
{/if}
