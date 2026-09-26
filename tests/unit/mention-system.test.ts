/**
 * Unit Tests for MentionSystem
 *
 * Tests the main mention system service including search, cache management, and provider coordination
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MentionSystem } from '../../src/lib/services/mentions/mention-system';
import { providerRegistry } from '../../src/lib/services/mentions/providers';
import type {
  MentionCandidate,
  Provider,
  SearchContext,
} from '../../src/lib/services/mentions/types';

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));

// Mock the search service
vi.mock('../../src/lib/services/mentions/search-service', () => ({
  DebouncedSearchService: class MockSearchService {
    search = searchMock;
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
    searchMock.mockReset().mockResolvedValue([]);
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
      const provider: Provider = {
        id: 'test-provider',
        triggers: [],
        search: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(providerRegistry.getDefault).mockReturnValueOnce([provider]);
      await mentionSystem.search('  test  ', mockContext);
      expect(searchMock).toHaveBeenCalledExactlyOnceWith('test', [provider], mockContext);
      expect(searchMock.mock.calls[0][2]).toBe(mockContext);
    });

    it('should return empty array when no providers available', async () => {
      const results = await mentionSystem.search('test', mockContext);
      expect(results).toEqual([]);
    });

    it('should handle search errors gracefully', async () => {
      const provider: Provider = {
        id: 'test-provider',
        triggers: [],
        search: vi.fn(),
      };
      vi.mocked(providerRegistry.getDefault).mockReturnValueOnce([provider]);
      searchMock.mockRejectedValueOnce(new Error('Search error'));

      const results = await mentionSystem.search('test', mockContext);
      expect(searchMock).toHaveBeenCalledExactlyOnceWith('test', [provider], mockContext);
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
    it('evicts least recently used results while retaining recent cache hits', async () => {
      const mockContext: SearchContext = { workspaceId: 'test' };
      const provider: Provider = { id: 'test-provider', triggers: [], search: vi.fn() };
      const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
      vi.mocked(providerRegistry.getDefault).mockReturnValue([provider]);
      searchMock.mockImplementation(async (query: string): Promise<MentionCandidate[]> => [
        { id: query, label: query, type: 'file', uri: `file:${query}` },
      ]);
      try {
        for (let i = 0; i < 100; i++) {
          mentionSystem.searchSync(`query-${i}`, mockContext);
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(searchMock).toHaveBeenCalledTimes(100);
        searchMock.mockClear();

        expect(mentionSystem.searchSync('query-0', mockContext)).toEqual([
          { id: 'query-0', label: 'query-0', type: 'file', uri: 'file:query-0' },
        ]);
        expect(searchMock).not.toHaveBeenCalled();

        mentionSystem.searchSync('query-100', mockContext);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(searchMock).toHaveBeenCalledExactlyOnceWith('query-100', [provider], mockContext);
        searchMock.mockClear();

        expect(mentionSystem.searchSync('query-0', mockContext).map(({ id }) => id)).toEqual([
          'query-0',
        ]);
        expect(mentionSystem.searchSync('query-100', mockContext).map(({ id }) => id)).toEqual([
          'query-100',
        ]);
        expect(searchMock).not.toHaveBeenCalled();
        expect(mentionSystem.searchSync('query-1', mockContext)).toEqual([]);
        expect(searchMock).toHaveBeenCalledExactlyOnceWith('query-1', [provider], mockContext);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(mentionSystem.searchSync('query-1', mockContext).map(({ id }) => id)).toEqual([
          'query-1',
        ]);
        expect(searchMock).toHaveBeenCalledTimes(1);
      } finally {
        clock.mockRestore();
        vi.mocked(providerRegistry.getDefault).mockReturnValue([]);
      }
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
