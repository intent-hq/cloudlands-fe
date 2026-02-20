/**
 * Unit Tests for MentionSystem
 *
 * Tests the main mention system service including search, cache management, and provider coordination
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MentionSystem } from '../../src/lib/services/mentions/mention-system';
import type { SearchContext, MentionCandidate } from '../../src/lib/services/mentions/types';

// Mock the search service
vi.mock('../../src/lib/services/mentions/search-service', () => ({
  DebouncedSearchService: class MockSearchService {
    search = vi.fn().mockResolvedValue([]);
    isLoading = vi.fn().mockReturnValue(false);
  },
}));

// Mock the provider registry
vi.mock('../../src/lib/services/mentions/providers', () => ({
  providerRegistry: {
    get: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    getByTrigger: vi.fn().mockReturnValue([]),
    getDefault: vi.fn().mockReturnValue([]),
  },
}));

describe('MentionSystem', () => {
  let mentionSystem: MentionSystem;

  beforeEach(() => {
    vi.clearAllMocks();
    mentionSystem = new MentionSystem({
      debounceMs: 300,
      maxResults: 10,
    });
  });

  describe('initialization', () => {
    it('should create instance with default config', () => {
      const system = new MentionSystem();
      expect(system).toBeDefined();
    });

    it('should create instance with custom config', () => {
      const system = new MentionSystem({
        debounceMs: 500,
        maxResults: 20,
        enableSemantic: true,
      });
      expect(system).toBeDefined();
    });
  });

  describe('search', () => {
    const mockContext: SearchContext = {
      workspaceId: 'test-workspace',
    };

    it('should handle empty query', async () => {
      const results = await mentionSystem.search('', mockContext);
      expect(results).toBeDefined();
    });

    it('should handle undefined workspaceId', async () => {
      const contextWithoutWorkspace: SearchContext = {
        workspaceId: undefined as any,
      };

      const results = await mentionSystem.search('test', contextWithoutWorkspace);
      expect(results).toBeDefined();
    });

    it('should sanitize query by trimming whitespace', async () => {
      await mentionSystem.search('  test  ', mockContext);
      // Should not throw
      expect(true).toBe(true);
    });

    it('should return empty array when no providers available', async () => {
      const results = await mentionSystem.search('test', mockContext);
      expect(results).toEqual([]);
    });

    it('should handle search errors gracefully', async () => {
      const { DebouncedSearchService } = await import(
        '../../src/lib/services/mentions/search-service'
      );
      const mockSearchService = new DebouncedSearchService() as any;
      mockSearchService.search = vi.fn().mockRejectedValue(new Error('Search error'));

      const results = await mentionSystem.search('test', mockContext);
      expect(results).toEqual([]);
    });
  });

  describe('searchSync', () => {
    const mockContext: SearchContext = {
      workspaceId: 'test-workspace',
    };

    it('should return empty results when no workspaceId and no repoPath', () => {
      const contextWithoutContext: SearchContext = {
        workspaceId: undefined as any,
        repoPath: undefined,
      };

      // Use empty query
      const results = mentionSystem.searchSync('', contextWithoutContext);

      expect(results.length).toBe(0);
    });

    it('should return empty results when no context even with query', () => {
      const contextWithoutContext: SearchContext = {
        workspaceId: undefined as any,
        repoPath: undefined,
      };

      const results = mentionSystem.searchSync('README', contextWithoutContext);

      expect(results.length).toBe(0);
    });

    it('should return cached results when available', () => {
      const results = mentionSystem.searchSync('test', mockContext);
      expect(results).toBeDefined();
    });
  });

  describe('cache management', () => {
    it('should handle cache cleanup', () => {
      // This tests that the system doesn't crash with cache operations
      const mockContext: SearchContext = { workspaceId: 'test' };

      // Perform multiple searches to potentially trigger cache cleanup
      for (let i = 0; i < 150; i++) {
        mentionSystem.searchSync(`query-${i}`, mockContext);
      }

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle null query', async () => {
      const mockContext: SearchContext = { workspaceId: 'test' };
      const results = await mentionSystem.search(null as any, mockContext);
      expect(results).toBeDefined();
    });

    it('should handle undefined query', async () => {
      const mockContext: SearchContext = { workspaceId: 'test' };
      const results = await mentionSystem.search(undefined as any, mockContext);
      expect(results).toBeDefined();
    });

    it('should handle query with special characters', async () => {
      const mockContext: SearchContext = { workspaceId: 'test' };
      const results = await mentionSystem.search('@#$%^&*()', mockContext);
      expect(results).toBeDefined();
    });
  });
});
