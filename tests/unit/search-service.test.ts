/**
 * Unit Tests for DebouncedSearchService
 *
 * Tests search debouncing, caching, validation, and error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DebouncedSearchService } from '../../src/lib/services/mentions/search-service';
import type { Provider, SearchContext, MentionCandidate } from '../../src/lib/services/mentions/types';

describe('DebouncedSearchService', () => {
  let service: DebouncedSearchService;
  let mockProvider: Provider;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new DebouncedSearchService({
      debounceMs: 300,
      maxResults: 10,
      cacheMaxAge: 30000,
    });

    mockProvider = {
      id: 'test-provider',
      search: vi.fn().mockResolvedValue([
        {
          id: 'test-1',
          type: 'file',
          label: 'test1.ts',
          uri: 'file://test1.ts',
        },
        {
          id: 'test-2',
          type: 'file',
          label: 'test2.ts',
          uri: 'file://test2.ts',
        },
      ] as MentionCandidate[]),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('configuration', () => {
    it('should use default configuration', () => {
      const defaultService = new DebouncedSearchService();
      expect(defaultService).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const customService = new DebouncedSearchService({
        debounceMs: 500,
        maxResults: 20,
      });
      expect(customService).toBeDefined();
    });
  });

  describe('search', () => {
    const mockContext: SearchContext = {
      workspaceId: 'test-workspace',
    };

    it('should debounce search calls', async () => {
      const searchPromise = service.search('test', [mockProvider], mockContext);

      // Should not call provider immediately
      expect(mockProvider.search).not.toHaveBeenCalled();

      // Fast-forward time
      vi.advanceTimersByTime(300);

      await searchPromise;

      // Should call provider after debounce
      expect(mockProvider.search).toHaveBeenCalledTimes(1);
    });

    it('should debounce multiple rapid searches', async () => {
      // Start multiple searches rapidly
      const search1 = service.search('test1', [mockProvider], mockContext);
      const search2 = service.search('test2', [mockProvider], mockContext);
      const search3 = service.search('test3', [mockProvider], mockContext);

      // Advance time to trigger debounce
      vi.advanceTimersByTime(300);

      // Only the last search should execute
      const results = await search3;
      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return results from provider', async () => {
      const searchPromise = service.search('test', [mockProvider], mockContext);
      vi.advanceTimersByTime(300);

      const results = await searchPromise;

      expect(results).toHaveLength(2);
      expect(results[0].label).toBe('test1.ts');
    });

    it('should limit results to maxResults', async () => {
      const manyResults = Array.from({ length: 20 }, (_, i) => ({
        id: `test-${i}`,
        type: 'file' as const,
        label: `test${i}.ts`,
        uri: `file://test${i}.ts`,
      }));

      mockProvider.search = vi.fn().mockResolvedValue(manyResults);

      const searchPromise = service.search('test', [mockProvider], mockContext);
      vi.advanceTimersByTime(300);

      const results = await searchPromise;

      expect(results).toHaveLength(10); // maxResults is 10
    });

    it('should cache search results', async () => {
      const search1 = service.search('test', [mockProvider], mockContext);
      vi.advanceTimersByTime(300);
      await search1;

      // Second search with same query should use cache
      const search2 = service.search('test', [mockProvider], mockContext);
      vi.advanceTimersByTime(300);
      await search2;

      // Provider should only be called once (first time)
      expect(mockProvider.search).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache after cacheMaxAge', async () => {
      const search1 = service.search('test', [mockProvider], mockContext);
      vi.advanceTimersByTime(300);
      await search1;

      // Advance time past cache max age
      vi.advanceTimersByTime(31000);

      const search2 = service.search('test', [mockProvider], mockContext);
      vi.advanceTimersByTime(300);
      await search2;

      // Provider should be called twice (cache expired)
      expect(mockProvider.search).toHaveBeenCalledTimes(2);
    });

    it('should filter out invalid mention candidates', async () => {
      mockProvider.search = vi.fn().mockResolvedValue([
        {
          id: 'valid',
          type: 'file',
          label: 'valid.ts',
          uri: 'file://valid.ts',
        },
        {
          // Missing required fields
          id: 'invalid',
          type: 'file',
        },
        {
          id: 'also-valid',
          type: 'file',
          label: 'also-valid.ts',
          uri: 'file://also-valid.ts',
        },
      ]);

      const searchPromise = service.search('test', [mockProvider], mockContext);
      vi.advanceTimersByTime(300);

      const results = await searchPromise;

      // Should only include valid candidates
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.label && r.uri)).toBe(true);
    });

    it('should handle empty provider list', async () => {
      const searchPromise = service.search('test', [], mockContext);
      vi.advanceTimersByTime(300);

      const results = await searchPromise;

      expect(results).toEqual([]);
    });

    it('should handle provider errors gracefully', async () => {
      mockProvider.search = vi.fn().mockRejectedValue(new Error('Provider error'));

      const searchPromise = service.search('test', [mockProvider], mockContext);
      vi.advanceTimersByTime(300);

      const results = await searchPromise;

      // Should return empty array instead of throwing
      expect(results).toEqual([]);
    });

    it('should handle provider errors with AbortError name', async () => {
      // Create a provider that throws an AbortError
      const abortableProvider: Provider = {
        id: 'abortable',
        async search(query: string, context: SearchContext) {
          const error = new Error('Search aborted');
          error.name = 'AbortError';
          throw error;
        },
      };

      const searchPromise = service.search('test', [abortableProvider], mockContext);
      vi.advanceTimersByTime(300);

      // Should return empty array on AbortError (search service catches and returns [])
      const results = await searchPromise;
      expect(results).toEqual([]);
    });

    it('should deduplicate results from multiple providers', async () => {
      const provider1: Provider = {
        id: 'provider1',
        search: vi.fn().mockResolvedValue([
          {
            id: 'duplicate',
            type: 'file',
            label: 'test.ts',
            uri: 'file://test.ts',
          },
        ] as MentionCandidate[]),
      };

      const provider2: Provider = {
        id: 'provider2',
        search: vi.fn().mockResolvedValue([
          {
            id: 'duplicate',
            type: 'file',
            label: 'test.ts',
            uri: 'file://test.ts',
          },
        ] as MentionCandidate[]),
      };

      const searchPromise = service.search('test', [provider1, provider2], mockContext);
      vi.advanceTimersByTime(300);

      const results = await searchPromise;

      // Should deduplicate by id
      expect(results).toHaveLength(1);
    });

    it('should sort results by score', async () => {
      mockProvider.search = vi.fn().mockResolvedValue([
        {
          id: 'low',
          type: 'file',
          label: 'low.ts',
          uri: 'file://low.ts',
          score: 0.3,
        },
        {
          id: 'high',
          type: 'file',
          label: 'high.ts',
          uri: 'file://high.ts',
          score: 0.9,
        },
        {
          id: 'medium',
          type: 'file',
          label: 'medium.ts',
          uri: 'file://medium.ts',
          score: 0.6,
        },
      ] as MentionCandidate[]);

      const searchPromise = service.search('test', [mockProvider], mockContext);
      vi.advanceTimersByTime(300);

      const results = await searchPromise;

      // Should be sorted by score descending
      expect(results[0].id).toBe('high');
      expect(results[1].id).toBe('medium');
      expect(results[2].id).toBe('low');
    });
  });

  describe('isLoading', () => {
    it('should return false initially', () => {
      expect(service.isLoading()).toBe(false);
    });

    it('should return true during search', () => {
      const mockContext: SearchContext = { workspaceId: 'test' };
      service.search('test', [mockProvider], mockContext);

      vi.advanceTimersByTime(300);

      expect(service.isLoading()).toBe(true);
    });

    it('should return false after search completes', async () => {
      const mockContext: SearchContext = { workspaceId: 'test' };
      const searchPromise = service.search('test', [mockProvider], mockContext);

      vi.advanceTimersByTime(300);
      await searchPromise;

      expect(service.isLoading()).toBe(false);
    });
  });
});
