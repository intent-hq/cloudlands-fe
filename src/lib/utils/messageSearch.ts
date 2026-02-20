/**
 * Message search utilities
 */

export interface SearchResult {
  messageId: string;
  messageIndex: number;
  matches: SearchMatch[];
}

export interface SearchMatch {
  start: number;
  end: number;
  text: string;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  role?: 'all' | 'user' | 'assistant';
}

/**
 * Search messages for a query
 */
export function searchMessages<T extends { id: string; contentBlocks?: any[]; role: string }>(
  messages: T[],
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  if (!query) return [];

  const results: SearchResult[] = [];
  const { caseSensitive = false, regex = false, role = 'all' } = options;

  // Filter messages by role
  const filteredMessages = messages.filter((msg) => {
    if (role === 'all') return true;
    return msg.role === role;
  });

  // Create search pattern
  let searchPattern: RegExp;
  try {
    if (regex) {
      searchPattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } else {
      // Escape special regex characters for literal search
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      searchPattern = new RegExp(escapedQuery, caseSensitive ? 'g' : 'gi');
    }
  } catch (error) {
    // Invalid regex, return empty results
    return [];
  }

  // Search each message
  filteredMessages.forEach((message, index) => {
    const matches: SearchMatch[] = [];
    let match: RegExpExecArray | null;

    // Extract text content from contentBlocks
    let textContent = '';
    if (message.contentBlocks && Array.isArray(message.contentBlocks)) {
      textContent = message.contentBlocks
        .filter((block: any) => block.type === 'text' && block.text)
        .map((block: any) => block.text)
        .join(' ');
    }

    // Reset regex lastIndex
    searchPattern.lastIndex = 0;

    while ((match = searchPattern.exec(textContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
    }

    if (matches.length > 0) {
      results.push({
        messageId: message.id,
        messageIndex: messages.indexOf(message),
        matches,
      });
    }
  });

  return results;
}

/**
 * Highlight search matches in text
 */
export function highlightMatches(
  text: string,
  matches: SearchMatch[],
  highlightClass = 'bg-yellow-200 dark:bg-yellow-900',
): string {
  if (matches.length === 0) return escapeHtml(text);

  // Sort matches by start position
  const sortedMatches = [...matches].sort((a, b) => a.start - b.start);

  let result = '';
  let lastEnd = 0;

  sortedMatches.forEach((match) => {
    // Add text before match
    if (match.start > lastEnd) {
      result += escapeHtml(text.substring(lastEnd, match.start));
    }

    // Add highlighted match
    result += `<mark class="${highlightClass}">${escapeHtml(text.substring(match.start, match.end))}</mark>`;
    lastEnd = match.end;
  });

  // Add remaining text
  if (lastEnd < text.length) {
    result += escapeHtml(text.substring(lastEnd));
  }

  return result;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}

/**
 * Get context around a match
 */
export function getMatchContext(text: string, match: SearchMatch, contextLength = 50): string {
  const start = Math.max(0, match.start - contextLength);
  const end = Math.min(text.length, match.end + contextLength);

  let context = text.substring(start, end);

  // Add ellipsis if truncated
  if (start > 0) context = `...${context}`;
  if (end < text.length) context = `${context}...`;

  return context;
}

/**
 * Navigate search results
 */
export class SearchNavigator {
  private results: SearchResult[] = [];
  private currentIndex = -1;

  setResults(results: SearchResult[]): void {
    this.results = results;
    this.currentIndex = results.length > 0 ? 0 : -1;
  }

  next(): SearchResult | null {
    if (this.results.length === 0) return null;

    this.currentIndex = (this.currentIndex + 1) % this.results.length;
    return this.results[this.currentIndex];
  }

  previous(): SearchResult | null {
    if (this.results.length === 0) return null;

    this.currentIndex = this.currentIndex - 1;
    if (this.currentIndex < 0) {
      this.currentIndex = this.results.length - 1;
    }

    return this.results[this.currentIndex];
  }

  getCurrent(): SearchResult | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.results.length) {
      return null;
    }
    return this.results[this.currentIndex];
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getResultCount(): number {
    return this.results.length;
  }

  reset(): void {
    this.results = [];
    this.currentIndex = -1;
  }
}
