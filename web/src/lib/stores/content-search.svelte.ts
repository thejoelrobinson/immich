// Unified content search interfaces for documents and video transcriptions
// Used by content-search-nav.svelte for both asset types

// Base interface for all content search matches
export interface ContentSearchMatch {
  textSnippet: string;
  matchStart: number;
  matchEnd: number;
}

// Document-specific match (PDF, Office docs)
export interface DocumentMatch extends ContentSearchMatch {
  type: 'document';
  pageNumber: number;
}

// Transcription-specific match (video transcripts)
export interface TranscriptionMatch extends ContentSearchMatch {
  type: 'transcription';
  startTime: number;
  endTime: number;
  speaker: string | null;
  wordStartTime: number | null;
}

export type AnyContentMatch = DocumentMatch | TranscriptionMatch;

// Common search manager interface that both stores implement
export interface ContentSearchState<T extends ContentSearchMatch = AnyContentMatch> {
  searchTerm: string;
  matches: T[];
  currentMatchIndex: number;
  currentMatch: T | null;
  totalMatches: number;
  isLoading: boolean;
  hasMatches: boolean;
  nextMatch: () => void;
  prevMatch: () => void;
  clear: () => void;
}

// Type guards for runtime type checking
export function isDocumentMatch(match: AnyContentMatch): match is DocumentMatch {
  return match.type === 'document';
}

export function isTranscriptionMatch(match: AnyContentMatch): match is TranscriptionMatch {
  return match.type === 'transcription';
}

// Helper to format timestamp (moved from transcription-search for reuse)
export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
