// Transcription search state manager for navigating between search matches
// Used by video player for search-to-timestamp deep linking

export interface TranscriptionSearchMatch {
  type: 'transcription';
  startTime: number;
  endTime: number;
  textSnippet: string;
  speaker: string | null;
  matchStart: number;
  matchEnd: number;
  wordStartTime: number | null;
}

class TranscriptionSearchManager {
  // State
  #searchTerm = $state('');
  #matches = $state<TranscriptionSearchMatch[]>([]);
  #currentMatchIndex = $state(0);
  #isLoading = $state(false);
  #assetId = $state('');

  // Getters
  get searchTerm() {
    return this.#searchTerm;
  }

  get matches() {
    return this.#matches;
  }

  get currentMatchIndex() {
    return this.#currentMatchIndex;
  }

  get currentMatch(): TranscriptionSearchMatch | null {
    return this.#matches[this.#currentMatchIndex] ?? null;
  }

  get totalMatches() {
    return this.#matches.length;
  }

  get isLoading() {
    return this.#isLoading;
  }

  get hasMatches() {
    return this.#matches.length > 0;
  }

  get assetId() {
    return this.#assetId;
  }

  // Actions
  async loadMatches(assetId: string, searchTerm: string) {
    if (!searchTerm.trim()) {
      this.clear();
      return;
    }

    this.#assetId = assetId;
    this.#searchTerm = searchTerm;
    this.#isLoading = true;
    this.#currentMatchIndex = 0;

    try {
      const response = await fetch(`/api/videos/${assetId}/transcription/search?q=${encodeURIComponent(searchTerm)}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data = await response.json();
      // Add type discriminator to matches from API
      this.#matches = (data.matches || []).map((match: Omit<TranscriptionSearchMatch, 'type'>) => ({
        ...match,
        type: 'transcription' as const,
      }));
    } catch (error) {
      console.error('Failed to load transcription search matches:', error);
      this.#matches = [];
    } finally {
      this.#isLoading = false;
    }
  }

  async checkTranscriptionAvailable(assetId: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/videos/${assetId}/transcription/available`, {
        credentials: 'include',
      });
      if (!response.ok) {
        return false;
      }
      const data = await response.json();
      return data.available === true;
    } catch {
      return false;
    }
  }

  nextMatch() {
    if (this.#matches.length === 0) return;
    this.#currentMatchIndex = (this.#currentMatchIndex + 1) % this.#matches.length;
  }

  prevMatch() {
    if (this.#matches.length === 0) return;
    this.#currentMatchIndex = (this.#currentMatchIndex - 1 + this.#matches.length) % this.#matches.length;
  }

  goToMatch(index: number) {
    if (index >= 0 && index < this.#matches.length) {
      this.#currentMatchIndex = index;
    }
  }

  setSearchTerm(term: string) {
    this.#searchTerm = term;
  }

  setMatches(matches: TranscriptionSearchMatch[]) {
    this.#matches = matches;
    this.#currentMatchIndex = 0;
    this.#isLoading = false;
  }

  clear() {
    this.#searchTerm = '';
    this.#matches = [];
    this.#currentMatchIndex = 0;
    this.#isLoading = false;
    this.#assetId = '';
  }
}

export const transcriptionSearchManager = new TranscriptionSearchManager();

// Re-export formatTimestamp from shared module for backwards compatibility
export { formatTimestamp } from '$lib/stores/content-search.svelte';
