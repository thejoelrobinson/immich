<script lang="ts">
  import { formatTimestamp } from '$lib/stores/transcription-search.svelte';
  import { mdiAccountVoice, mdiClose } from '@mdi/js';
  import { Icon, LoadingSpinner } from '@immich/ui';

  interface WordTimestamp {
    word: string;
    start: number;
    end: number;
    confidence: number;
  }

  interface TranscriptionSegment {
    speaker: string | null;
    startTime: number;
    endTime: number;
    text: string;
    words: WordTimestamp[] | null;
  }

  interface Props {
    assetId: string;
    currentTime?: number;
    onSeek?: (time: number) => void;
    onClose?: () => void;
  }

  let { assetId, currentTime = 0, onSeek, onClose }: Props = $props();

  let segments = $state<TranscriptionSegment[]>([]);
  let isLoading = $state(true);
  let error = $state<string | null>(null);
  let panelElement: HTMLDivElement | undefined = $state();

  // Speaker color mapping for consistent colors
  const speakerColors = [
    'bg-blue-600/30 text-blue-300',
    'bg-green-600/30 text-green-300',
    'bg-purple-600/30 text-purple-300',
    'bg-orange-600/30 text-orange-300',
    'bg-pink-600/30 text-pink-300',
    'bg-cyan-600/30 text-cyan-300',
  ];

  const speakerColorMap = new Map<string, string>();

  function getSpeakerColor(speaker: string | null): string {
    if (!speaker) return 'bg-gray-600/30 text-gray-300';

    if (!speakerColorMap.has(speaker)) {
      const colorIndex = speakerColorMap.size % speakerColors.length;
      speakerColorMap.set(speaker, speakerColors[colorIndex]);
    }
    return speakerColorMap.get(speaker)!;
  }

  // Binary search to find the active word index based on current time
  function findActiveWordIndex(words: WordTimestamp[], time: number): number {
    if (!words || words.length === 0) return -1;

    let low = 0;
    let high = words.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const word = words[mid];

      if (time >= word.start && time < word.end) {
        return mid;
      } else if (time < word.start) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return -1;
  }

  // Find the current active segment based on video time
  const activeSegmentIndex = $derived(
    segments.findIndex((seg) => currentTime >= seg.startTime && currentTime < seg.endTime)
  );

  // Find the active word within the active segment for karaoke highlighting
  const activeWordIndex = $derived.by(() => {
    if (activeSegmentIndex < 0) return -1;
    const segment = segments[activeSegmentIndex];
    if (!segment?.words) return -1;
    return findActiveWordIndex(segment.words, currentTime);
  });

  // Auto-scroll to active segment
  $effect(() => {
    if (activeSegmentIndex >= 0 && panelElement) {
      const segmentElement = panelElement.querySelector(`[data-segment-index="${activeSegmentIndex}"]`);
      segmentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  // Load transcription data
  $effect(() => {
    loadTranscription(assetId);
  });

  async function loadTranscription(id: string) {
    isLoading = true;
    error = null;
    speakerColorMap.clear();

    try {
      const response = await fetch(`/api/videos/${id}/transcription`, {
        credentials: 'include',
      });
      if (!response.ok) {
        if (response.status === 404) {
          error = 'No transcription available for this video.';
          segments = [];
          return;
        }
        throw new Error(`Failed to load transcription: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[Karaoke Debug] API response:', {
        segmentCount: data.segments?.length,
        firstSegmentHasWords: !!data.segments?.[0]?.words,
        firstSegmentWordsType: typeof data.segments?.[0]?.words,
        firstSegmentWordsLength: data.segments?.[0]?.words?.length,
        firstTwoWords: data.segments?.[0]?.words?.slice(0, 2)
      });
      segments = data.segments || [];
    } catch (err) {
      console.error('Failed to load transcription:', err);
      error = err instanceof Error ? err.message : 'Failed to load transcription';
      segments = [];
    } finally {
      isLoading = false;
    }
  }

  function handleSegmentClick(segment: TranscriptionSegment) {
    onSeek?.(segment.startTime);
  }
</script>

<div class="fixed right-4 top-20 bottom-20 w-80 z-40 flex flex-col bg-gray-900/95 rounded-lg shadow-xl backdrop-blur-sm overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-gray-700">
    <div class="flex items-center gap-2">
      <Icon icon={mdiAccountVoice} size="20" class="text-gray-400" />
      <h3 class="text-white font-medium">Transcript</h3>
    </div>
    <button
      onclick={() => onClose?.()}
      class="p-1 rounded hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
      title="Close transcript"
    >
      <Icon icon={mdiClose} size="20" />
    </button>
  </div>

  <!-- Content -->
  <div bind:this={panelElement} class="flex-1 overflow-y-auto p-3 space-y-2">
    {#if isLoading}
      <div class="flex items-center justify-center h-32">
        <LoadingSpinner />
      </div>
    {:else if error}
      <div class="text-center py-8 text-gray-400">
        <p>{error}</p>
      </div>
    {:else if segments.length === 0}
      <div class="text-center py-8 text-gray-400">
        <p>No transcript segments found.</p>
      </div>
    {:else}
      {#each segments as segment, index (segment.startTime)}
        <button
          data-segment-index={index}
          onclick={() => handleSegmentClick(segment)}
          class="w-full text-left p-3 rounded-lg transition-all cursor-pointer
                 {index === activeSegmentIndex
                   ? 'bg-blue-600/30 border border-blue-500/50'
                   : 'bg-gray-800/50 hover:bg-gray-700/50 border border-transparent'}"
        >
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-mono text-blue-400">
              {formatTimestamp(segment.startTime)}
            </span>
            {#if segment.speaker}
              <span class="px-1.5 py-0.5 rounded text-xs {getSpeakerColor(segment.speaker)}">
                {segment.speaker}
              </span>
            {/if}
          </div>
          <p class="text-sm text-gray-200 leading-relaxed">
            {#if segment.words && segment.words.length > 0}
              {#each segment.words as word, wordIdx}
                <span
                  class="transition-colors duration-75 cursor-pointer hover:underline
                         {index === activeSegmentIndex && wordIdx === activeWordIndex
                           ? 'text-yellow-400 font-medium' : ''}"
                  onclick={(e) => { e.stopPropagation(); onSeek?.(word.start); }}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onSeek?.(word.start); } }}
                >{word.word}{' '}</span>
              {/each}
            {:else}
              {segment.text}
            {/if}
          </p>
        </button>
      {/each}
    {/if}
  </div>

  <!-- Footer with segment count -->
  {#if !isLoading && segments.length > 0}
    <div class="px-4 py-2 border-t border-gray-700 text-xs text-gray-500">
      {segments.length} segment{segments.length !== 1 ? 's' : ''}
    </div>
  {/if}
</div>
