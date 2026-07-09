/**
 * Unit Tests for FileProvider
 *
 * Tests daemon-backed file search (search.fileNames, PROTOCOL §5.15) and the
 * no-fabricated-fallback guarantee on failure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileProvider } from '../../src/lib/services/mentions/providers/file-provider';
import type { SearchContext } from '../../src/lib/services/mentions/types';

// Mock the daemon transport
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

describe('FileProvider', () => {
  let provider: FileProvider;
  let mockBackendRequest: any;

  beforeEach(async () => {
    provider = new FileProvider();
    const transport = await import('$lib/client/live/backend-transport');
    mockBackendRequest = transport.backendRequest as any;
    vi.clearAllMocks();
  });

  describe('basic properties', () => {
    it('should have correct id', () => {
      expect(provider.id).toBe('file');
    });

    it('should have correct triggers', () => {
      expect(provider.triggers).toEqual(['@file', '@f']);
    });

    it('should be a default provider', () => {
      expect(provider.default).toBe(true);
    });

    it('should support ranges', () => {
      expect(provider.supportsRanges).toBe(true);
    });

    it('should support live preview', () => {
      expect(provider.supportsLivePreview).toBe(true);
    });
  });

  describe('search', () => {
    const mockContext: SearchContext = {
      workspaceId: 'test-workspace',
    };

    it('should request search.fileNames and map returned paths', async () => {
      mockBackendRequest.mockResolvedValueOnce({
        requestId: 'srch-1',
        files: ['src/test.ts', 'src/index.ts'],
        truncated: false,
      });

      const results = await provider.search('test', mockContext);

      expect(mockBackendRequest).toHaveBeenCalledWith('search.fileNames', {
        workspaceId: 'test-workspace',
        pattern: 'test',
        limit: 10,
      });

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        type: 'file',
        label: 'test.ts',
        description: 'src/test.ts',
        meta: {
          path: 'src/test.ts',
          relativePath: 'src/test.ts',
          extension: 'ts',
          language: 'typescript',
        },
      });
    });

    it('should send an empty pattern for an empty query', async () => {
      mockBackendRequest.mockResolvedValueOnce({ requestId: 'srch-1', files: [], truncated: false });

      const results = await provider.search('', mockContext);

      expect(mockBackendRequest).toHaveBeenCalledWith('search.fileNames', {
        workspaceId: 'test-workspace',
        pattern: '',
        limit: 10,
      });
      expect(results).toEqual([]);
    });

    it('should return empty results without a workspaceId (no wire call)', async () => {
      const results = await provider.search('test', {} as SearchContext);

      expect(mockBackendRequest).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('should return empty results when the daemon request fails — never fabricated data', async () => {
      mockBackendRequest.mockRejectedValue(new Error('daemon error'));

      const results = await provider.search('README', mockContext);

      expect(results).toEqual([]);
    });

    it('should return empty results when the result is invalid', async () => {
      mockBackendRequest.mockResolvedValue(null);

      const results = await provider.search('README', mockContext);

      expect(results).toEqual([]);
    });

    it('should return empty results when the files array is missing', async () => {
      mockBackendRequest.mockResolvedValue({ requestId: 'srch-1' });

      const results = await provider.search('package', mockContext);

      expect(results).toEqual([]);
    });

    it('should show distinguishing paths for duplicate filenames', async () => {
      mockBackendRequest.mockResolvedValueOnce({
        requestId: 'srch-1',
        files: [
          'src/routes/home/+page.svelte',
          'src/routes/settings/+page.svelte',
          'src/routes/profile/+page.svelte',
        ],
        truncated: false,
      });

      const results = await provider.search('page', mockContext);

      // All three should be returned
      expect(results).toHaveLength(3);

      // All should have the same label (filename)
      expect(results.every((r) => r.label === '+page.svelte')).toBe(true);

      // Each should have a different subtitle showing the distinguishing path
      const subtitles = results.map((r) => r.subtitle);
      expect(new Set(subtitles).size).toBe(3); // All unique
    });

    it('should keep unique filenames without extra path info', async () => {
      mockBackendRequest.mockResolvedValueOnce({
        requestId: 'srch-1',
        files: ['src/unique.ts', 'src/other.ts'],
        truncated: false,
      });

      const results = await provider.search('', mockContext);

      // Both should be returned
      expect(results).toHaveLength(2);

      // Unique files should keep their original subtitles
      const uniqueResult = results.find((r) => r.label === 'unique.ts');
      expect(uniqueResult?.subtitle).toBe('src/unique.ts');
    });
  });
});
