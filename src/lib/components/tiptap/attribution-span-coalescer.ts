import type { LineAuthor } from './line-to-block-mapper';

/**
 * Positioned indicator entry (as built in LineAttributionGutter.svelte#updateIndicators)
 */
export interface IndicatorEntry {
  position: number;
  top: number;
  height: number;
  timestamp: number;
  author?: LineAuthor;
}

/**
 * Coalesced span grouping adjacent indicators with the same author
 */
export interface CoalescedSpan {
  /** Top position of the span (from first entry) */
  top: number;
  /** Height of the span (from first entry top to last entry bottom, bridging gaps) */
  height: number;
  /** Newest timestamp in the span */
  timestamp: number;
  /** Author of the span */
  author?: LineAuthor;
  /** Number of entries in this span */
  entryCount: number;
  /** Original positions included in this span */
  positions: number[];
  /** Whether this span's newest timestamp equals the global newest */
  isFromLatestVersion: boolean;
}

/**
 * Default coalescing window: 1 minute (in milliseconds)
 */
export const DEFAULT_COALESCING_WINDOW_MS = 60 * 1000;

/**
 * Check if two authors match (same id + type; both-undefined authors match each other)
 */
function authorsMatch(a?: LineAuthor, b?: LineAuthor): boolean {
  // Both undefined → match
  if (a === undefined && b === undefined) {
    return true;
  }
  // One undefined → no match
  if (a === undefined || b === undefined) {
    return false;
  }
  // Both defined → compare id and type
  return a.id === b.id && a.type === b.type;
}

/**
 * Coalesce adjacent indicator entries into spans.
 *
 * Groups adjacent entries (sorted by top, no differently-attributed entry in between)
 * when they have the same author identity and timestamps within the proximity window.
 *
 * @param entries - Ordered list of positioned indicator entries (should be sorted by top)
 * @param newestTimestamp - Global newest timestamp (for isFromLatestVersion flag)
 * @param coalescingWindowMs - Timestamp proximity window in milliseconds (default: 1 minute)
 * @returns Array of coalesced spans
 */
export function coalesceAttributionSpans(
  entries: IndicatorEntry[],
  newestTimestamp: number,
  coalescingWindowMs: number = DEFAULT_COALESCING_WINDOW_MS,
): CoalescedSpan[] {
  if (entries.length === 0) {
    return [];
  }

  // Sort entries by top position to ensure adjacency
  const sortedEntries = [...entries].sort((a, b) => a.top - b.top);

  const spans: CoalescedSpan[] = [];
  let currentSpan: {
    entries: IndicatorEntry[];
    author?: LineAuthor;
    newestTimestamp: number;
  } | null = null;

  for (const entry of sortedEntries) {
    if (currentSpan === null) {
      // Start first span
      currentSpan = {
        entries: [entry],
        author: entry.author,
        newestTimestamp: entry.timestamp,
      };
    } else {
      // Check if this entry can be merged with current span
      const sameAuthor = authorsMatch(currentSpan.author, entry.author);
      const timestampDiff = Math.abs(entry.timestamp - currentSpan.newestTimestamp);
      const withinWindow = timestampDiff <= coalescingWindowMs;

      if (sameAuthor && withinWindow) {
        // Merge into current span
        currentSpan.entries.push(entry);
        currentSpan.newestTimestamp = Math.max(currentSpan.newestTimestamp, entry.timestamp);
      } else {
        // Finalize current span and start new one
        spans.push(finalizeSpan(currentSpan, newestTimestamp));
        currentSpan = {
          entries: [entry],
          author: entry.author,
          newestTimestamp: entry.timestamp,
        };
      }
    }
  }

  // Finalize last span
  if (currentSpan !== null) {
    spans.push(finalizeSpan(currentSpan, newestTimestamp));
  }

  return spans;
}

/**
 * Convert accumulated span entries into a CoalescedSpan
 */
function finalizeSpan(
  span: {
    entries: IndicatorEntry[];
    author?: LineAuthor;
    newestTimestamp: number;
  },
  globalNewestTimestamp: number,
): CoalescedSpan {
  const firstEntry = span.entries[0];
  const lastEntry = span.entries[span.entries.length - 1];

  // Calculate span height: from first entry top to last entry bottom
  const top = firstEntry.top;
  const bottom = lastEntry.top + lastEntry.height;
  const height = bottom - top;

  return {
    top,
    height,
    timestamp: span.newestTimestamp,
    author: span.author,
    entryCount: span.entries.length,
    positions: span.entries.map((e) => e.position),
    isFromLatestVersion: span.newestTimestamp >= globalNewestTimestamp,
  };
}
