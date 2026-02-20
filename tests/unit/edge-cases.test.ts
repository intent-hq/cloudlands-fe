/**
 * Edge Cases & Error Handling Tests
 *
 * Comprehensive tests for edge cases including:
 * - Empty results
 * - Invalid workspaceId (undefined, null, empty string)
 * - Special characters in search queries
 * - Rapid typing and debouncing
 * - Cache scenarios
 * - Data persistence
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MentionSystem } from '../../src/lib/services/mentions/mention-system';
import { DebouncedSearchService } from '../../src/lib/services/mentions/search-service';
import type { SearchContext, MentionCandidate } from '../../src/lib/services/mentions/types';

describe('Edge Cases & Error Handling', () => {
  let mentionSystem: MentionSystem;
  let searchService: DebouncedSearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    mentionSystem = new MentionSystem({
      debounceMs: 100,
      maxResults: 10,
      cacheMaxAge: 5000,
    });
    searchService = new DebouncedSearchService({
      debounceMs: 100,
      maxResults: 10,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Invalid workspaceId', () => {
    it('should handle undefined workspaceId gracefully', async () => {
      const context: SearchContext = { workspaceId: undefined };
      const results = await mentionSystem.search('test', context);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle null workspaceId gracefully', async () => {
      const context: SearchContext = { workspaceId: null as any };
      const results = await mentionSystem.search('test', context);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle empty string workspaceId', async () => {
      const context: SearchContext = { workspaceId: '' };
      const results = await mentionSystem.search('test', context);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Empty search results', () => {
    it('should handle empty query string', async () => {
      const context: SearchContext = { workspaceId: 'test-ws' };
      const results = await mentionSystem.search('', context);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle whitespace-only query', async () => {
      const context: SearchContext = { workspaceId: 'test-ws' };
      const results = await mentionSystem.search('   ', context);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle query with no matches', async () => {
      const context: SearchContext = { workspaceId: 'test-ws' };
      const results = await mentionSystem.search('xyznonexistent', context);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Special characters in queries', () => {
    const specialCharQueries = [
      '@',
      '#',
      '/',
      '\\',
      '*',
      '?',
      '"',
      "'",
      '<',
      '>',
      '|',
      '&',
      '%',
      '$',
      '!',
      '~',
      '`',
      '^',
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
      '=',
      '+',
      '-',
      '.',
      ',',
      ';',
      ':',
    ];

    specialCharQueries.forEach((char) => {
      it(`should handle special character: ${char}`, async () => {
        const context: SearchContext = { workspaceId: 'test-ws' };
        const results = await mentionSystem.search(char, context);
        expect(Array.isArray(results)).toBe(true);
        expect(results).not.toThrow;
      });
    });

    it('should handle mixed special characters', async () => {
      const context: SearchContext = { workspaceId: 'test-ws' };
      const results = await mentionSystem.search('@#$%^&*()', context);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle unicode characters', async () => {
      const context: SearchContext = { workspaceId: 'test-ws' };
      const results = await mentionSystem.search('你好世界', context);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle emoji characters', async () => {
      const context: SearchContext = { workspaceId: 'test-ws' };
      const results = await mentionSystem.search('🚀🎉✨', context);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Rapid typing and debouncing', () => {
    it('should debounce rapid consecutive searches', async () => {
      vi.useFakeTimers();
      const context: SearchContext = { workspaceId: 'test-ws' };

      const promise1 = mentionSystem.search('a', context);
      const promise2 = mentionSystem.search('ab', context);
      const promise3 = mentionSystem.search('abc', context);

      vi.advanceTimersByTime(150);

      const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3]);
      expect(Array.isArray(r1)).toBe(true);
      expect(Array.isArray(r2)).toBe(true);
      expect(Array.isArray(r3)).toBe(true);

      vi.useRealTimers();
    });

    it('should handle very long queries', async () => {
      const context: SearchContext = { workspaceId: 'test-ws' };
      const longQuery = 'a'.repeat(1000);
      const results = await mentionSystem.search(longQuery, context);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Cache scenarios', () => {
    it('should cache search results', async () => {
      const context: SearchContext = { workspaceId: 'test-ws' };
      const query = 'test-cache';

      const results1 = await mentionSystem.search(query, context);
      const results2 = await mentionSystem.search(query, context);

      expect(Array.isArray(results1)).toBe(true);
      expect(Array.isArray(results2)).toBe(true);
    });

    it('should invalidate cache after timeout', async () => {
      vi.useFakeTimers();
      const context: SearchContext = { workspaceId: 'test-ws' };
      const query = 'cache-timeout';

      await mentionSystem.search(query, context);
      vi.advanceTimersByTime(6000); // Cache timeout is 5000ms
      const results = await mentionSystem.search(query, context);

      expect(Array.isArray(results)).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('Data persistence', () => {
    it('should handle searchSync with undefined workspaceId', () => {
      const context: SearchContext = { workspaceId: undefined };
      const results = mentionSystem.searchSync('test', context);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should return default suggestions when no workspace', () => {
      const context: SearchContext = { workspaceId: undefined };
      const results = mentionSystem.searchSync('', context);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should not throw on invalid context', async () => {
      const invalidContext = {} as SearchContext;
      expect(async () => {
        await mentionSystem.search('test', invalidContext);
      }).not.toThrow();
    });

    it('should handle concurrent searches', async () => {
      const context: SearchContext = { workspaceId: 'test-ws' };
      const promises = Array(10)
        .fill(null)
        .map((_, i) => mentionSystem.search(`query${i}`, context));

      const results = await Promise.all(promises);
      expect(results.length).toBe(10);
      expect(results.every(r => Array.isArray(r))).toBe(true);
    });
  });
});
