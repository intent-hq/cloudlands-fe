import { describe, it, expect } from 'vitest';
import {
  coalesceAttributionSpans,
  DEFAULT_COALESCING_WINDOW_MS,
  type IndicatorEntry,
} from '../attribution-span-coalescer';
import type { LineAuthor } from '../line-to-block-mapper';

describe('Attribution Span Coalescer', () => {
  const MINUTE = 60 * 1000;

  const createEntry = (
    position: number,
    top: number,
    height: number,
    timestamp: number,
    author?: LineAuthor,
  ): IndicatorEntry => ({
    position,
    top,
    height,
    timestamp,
    author,
  });

  const createAuthor = (id: string, name: string, type: 'user' | 'agent' = 'user'): LineAuthor => ({
    id,
    name,
    type,
  });

  describe('Single entry', () => {
    it('should handle a single entry', () => {
      const now = Date.now();
      const author = createAuthor('user1', 'Alice');
      const entries = [createEntry(1, 10, 20, now, author)];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(1);
      expect(spans[0]).toEqual({
        top: 10,
        height: 20,
        timestamp: now,
        author,
        entryCount: 1,
        positions: [1],
        isFromLatestVersion: true,
      });
    });

    it('should handle a single entry without author', () => {
      const now = Date.now();
      const entries = [createEntry(1, 10, 20, now)];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(1);
      expect(spans[0].author).toBeUndefined();
      expect(spans[0].entryCount).toBe(1);
    });
  });

  describe('Same-author adjacent merge', () => {
    it('should merge adjacent entries with same author within time window', () => {
      const now = Date.now();
      const author = createAuthor('user1', 'Alice');
      const entries = [
        createEntry(1, 10, 20, now - 30 * 1000, author), // 30s ago
        createEntry(2, 30, 20, now, author), // now
      ];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(1);
      expect(spans[0]).toEqual({
        top: 10,
        height: 40, // from top 10 to bottom 50 (30 + 20)
        timestamp: now,
        author,
        entryCount: 2,
        positions: [1, 2],
        isFromLatestVersion: true,
      });
    });

    it('should merge multiple adjacent entries with same author', () => {
      const now = Date.now();
      const author = createAuthor('agent1', 'Bot', 'agent');
      const entries = [
        createEntry(1, 10, 15, now - 50 * 1000, author),
        createEntry(2, 25, 15, now - 30 * 1000, author),
        createEntry(3, 40, 15, now - 10 * 1000, author),
      ];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(1);
      expect(spans[0].entryCount).toBe(3);
      expect(spans[0].height).toBe(45); // 10 to 55
      expect(spans[0].timestamp).toBe(now - 10 * 1000);
    });

    it('should merge entries with both-undefined authors', () => {
      const now = Date.now();
      const entries = [
        createEntry(1, 10, 20, now - 30 * 1000),
        createEntry(2, 30, 20, now),
      ];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(1);
      expect(spans[0].entryCount).toBe(2);
    });
  });

  describe('Different-author split', () => {
    it('should split when authors differ', () => {
      const now = Date.now();
      const alice = createAuthor('user1', 'Alice');
      const bob = createAuthor('user2', 'Bob');
      const entries = [
        createEntry(1, 10, 20, now - 30 * 1000, alice),
        createEntry(2, 30, 20, now, bob),
      ];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(2);
      expect(spans[0].author).toBe(alice);
      expect(spans[1].author).toBe(bob);
    });

    it('should split when one author is undefined and one is defined', () => {
      const now = Date.now();
      const author = createAuthor('user1', 'Alice');
      const entries = [
        createEntry(1, 10, 20, now - 30 * 1000),
        createEntry(2, 30, 20, now, author),
      ];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(2);
      expect(spans[0].author).toBeUndefined();
      expect(spans[1].author).toBe(author);
    });
  });

  describe('Timestamp-window split', () => {
    it('should split when timestamps exceed the window', () => {
      const now = Date.now();
      const author = createAuthor('user1', 'Alice');
      const entries = [
        createEntry(1, 10, 20, now - 2 * MINUTE, author), // 2 minutes ago
        createEntry(2, 30, 20, now, author), // now
      ];

      const spans = coalesceAttributionSpans(entries, now, DEFAULT_COALESCING_WINDOW_MS);

      expect(spans).toHaveLength(2);
      expect(spans[0].timestamp).toBe(now - 2 * MINUTE);
      expect(spans[1].timestamp).toBe(now);
    });

    it('should respect custom coalescing window', () => {
      const now = Date.now();
      const author = createAuthor('user1', 'Alice');
      const entries = [
        createEntry(1, 10, 20, now - 90 * 1000, author), // 90s ago
        createEntry(2, 30, 20, now, author), // now
      ];

      // With 2-minute window, should merge
      const spans2min = coalesceAttributionSpans(entries, now, 2 * MINUTE);
      expect(spans2min).toHaveLength(1);

      // With 1-minute window, should split
      const spans1min = coalesceAttributionSpans(entries, now, 1 * MINUTE);
      expect(spans1min).toHaveLength(2);
    });
  });

  describe('Gap bridging', () => {
    it('should bridge vertical gaps between adjacent blocks', () => {
      const now = Date.now();
      const author = createAuthor('user1', 'Alice');
      const entries = [
        createEntry(1, 10, 20, now - 30 * 1000, author), // top: 10, bottom: 30
        createEntry(2, 40, 15, now, author), // top: 40 (gap of 10), bottom: 55
      ];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(1);
      expect(spans[0].top).toBe(10);
      expect(spans[0].height).toBe(45); // 10 to 55, bridging the gap
    });

    it('should bridge multiple gaps in a span', () => {
      const now = Date.now();
      const author = createAuthor('user1', 'Alice');
      const entries = [
        createEntry(1, 10, 10, now - 50 * 1000, author), // 10-20
        createEntry(2, 25, 10, now - 30 * 1000, author), // 25-35 (gap: 5)
        createEntry(3, 40, 10, now - 10 * 1000, author), // 40-50 (gap: 5)
      ];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(1);
      expect(spans[0].height).toBe(40); // 10 to 50, bridging all gaps
    });
  });

  describe('Latest-version flag', () => {
    it('should set isFromLatestVersion when span timestamp equals global newest', () => {
      const now = Date.now();
      const author = createAuthor('user1', 'Alice');
      const entries = [
        createEntry(1, 10, 20, now - 2 * MINUTE, author),
        createEntry(2, 30, 20, now, author),
      ];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(2);
      expect(spans[0].isFromLatestVersion).toBe(false);
      expect(spans[1].isFromLatestVersion).toBe(true);
    });

    it('should set isFromLatestVersion for merged span when any entry is newest', () => {
      const now = Date.now();
      const author = createAuthor('user1', 'Alice');
      const entries = [
        createEntry(1, 10, 20, now - 30 * 1000, author),
        createEntry(2, 30, 20, now, author), // newest
      ];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(1);
      expect(spans[0].isFromLatestVersion).toBe(true);
      expect(spans[0].timestamp).toBe(now); // span takes newest timestamp
    });

    it('should handle multiple spans with different latest-version status', () => {
      const now = Date.now();
      const alice = createAuthor('user1', 'Alice');
      const bob = createAuthor('user2', 'Bob');
      const entries = [
        createEntry(1, 10, 20, now - 5 * MINUTE, alice),
        createEntry(2, 30, 20, now - 2 * MINUTE, bob),
        createEntry(3, 50, 20, now, alice),
      ];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(3);
      expect(spans[0].isFromLatestVersion).toBe(false);
      expect(spans[1].isFromLatestVersion).toBe(false);
      expect(spans[2].isFromLatestVersion).toBe(true);
    });
  });

  describe('Empty input', () => {
    it('should return empty array for empty input', () => {
      const spans = coalesceAttributionSpans([], Date.now());
      expect(spans).toEqual([]);
    });
  });

  describe('Entry sorting', () => {
    it('should handle unsorted entries by sorting them first', () => {
      const now = Date.now();
      const author = createAuthor('user1', 'Alice');
      // Entries not in top-order
      const entries = [
        createEntry(2, 30, 20, now, author),
        createEntry(1, 10, 20, now - 30 * 1000, author),
      ];

      const spans = coalesceAttributionSpans(entries, now);

      expect(spans).toHaveLength(1);
      expect(spans[0].top).toBe(10); // Should start from the top-most entry
      expect(spans[0].positions).toEqual([1, 2]); // Positions in sorted order
    });
  });
});
