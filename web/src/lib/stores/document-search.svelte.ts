// Document search state manager for navigating between search matches
// Used by PDF viewer and ONLYOFFICE viewer for search highlighting

export interface TextPosition {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DocumentSearchMatch {
  pageNumber: number;
  textSnippet: string;
  matchStart: number;
  matchEnd: number;
}

export interface PageTextPositions {
  pageNumber: number;
  text: string;
  textItems: TextPosition[] | null;
}

class DocumentSearchManager {
  // State
  #searchTerm = $state('');
  #matches = $state<DocumentSearchMatch[]>([]);
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

  get currentMatch(): DocumentSearchMatch | null {
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
      const response = await fetch(`/api/documents/${assetId}/search-matches?q=${encodeURIComponent(searchTerm)}`);
      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data = await response.json();
      this.#matches = data.matches || [];
    } catch (error) {
      console.error('Failed to load document search matches:', error);
      this.#matches = [];
    } finally {
      this.#isLoading = false;
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

  setMatches(matches: DocumentSearchMatch[]) {
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

export const documentSearchManager = new DocumentSearchManager();
