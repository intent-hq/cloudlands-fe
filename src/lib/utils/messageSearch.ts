/**
 * Message search utilities
 */

export interface SearchResult {
  messageId: string;
  messageIndex: number;
  matches: SearchMatch[];
}

interface SearchMatch {
  start: number;
  end: number;
  text: string;
}
