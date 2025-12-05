<script lang="ts">
  import { documentSearchManager } from '$lib/stores/document-search.svelte';
  import { mdiChevronUp, mdiChevronDown, mdiClose } from '@mdi/js';
  import { Icon } from '@immich/ui';

  interface Props {
    onClose?: () => void;
  }

  let { onClose }: Props = $props();

  const searchTerm = $derived(documentSearchManager.searchTerm);
  const currentIndex = $derived(documentSearchManager.currentMatchIndex);
  const totalMatches = $derived(documentSearchManager.totalMatches);
  const isLoading = $derived(documentSearchManager.isLoading);
  const hasMatches = $derived(documentSearchManager.hasMatches);

  // Debug logging
  $effect(() => {
    console.log('[DocumentSearchNav] searchTerm:', searchTerm, 'hasMatches:', hasMatches, 'isLoading:', isLoading);
  });

  function handlePrev() {
    documentSearchManager.prevMatch();
  }

  function handleNext() {
    documentSearchManager.nextMatch();
  }

  function handleClose() {
    documentSearchManager.clear();
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
    class="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800/95 text-white shadow-lg backdrop-blur-sm"
  >
    <!-- Search term display -->
    <div class="flex items-center gap-2 pr-3 border-r border-gray-600">
      <span class="text-sm font-medium max-w-48 truncate" title={searchTerm}>
        "{searchTerm}"
      </span>
    </div>

    <!-- Match counter -->
    <div class="flex items-center gap-2 px-2">
      {#if isLoading}
        <span class="text-sm text-gray-400">Searching...</span>
      {:else if hasMatches}
        <span class="text-sm">
          {currentIndex + 1} of {totalMatches}
        </span>
      {:else}
        <span class="text-sm text-gray-400">No matches</span>
      {/if}
    </div>

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
{/if}
