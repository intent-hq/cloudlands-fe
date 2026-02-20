/**
 * Unit Tests for FileProvider
 *
 * Tests file search functionality and fallback behavior
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileProvider, clearWorkspaceRootCache } from '../../src/lib/services/mentions/providers/file-provider';
import type { SearchContext } from '../../src/lib/services/mentions/types';

// Mock electron-bridge
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(),
}));

describe('FileProvider', () => {
  let provider: FileProvider;
  let mockInvoke: any;

  beforeEach(async () => {
    clearWorkspaceRootCache();
    provider = new FileProvider();
    const electronBridge = await import('$lib/electron-bridge');
    mockInvoke = electronBridge.invoke as any;
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

    it('should return files from workspace:list-files', async () => {
      // Mock workspace:get-by-id call
      mockInvoke.mockResolvedValueOnce({ success: true, data: { worktreePath: '/workspace/root' } });

      // Mock file:list call with new response format
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: [
          {
            name: 'test.ts',
            path: '/workspace/root/src/test.ts',
            isFile: true,
            extension: 'ts',
          },
          {
            name: 'index.ts',
            path: '/workspace/root/src/index.ts',
            isFile: true,
            extension: 'ts',
          },
        ],
      });

      const results = await provider.search('test', mockContext);

      // Should have called workspace:get-by-id first
      expect(mockInvoke).toHaveBeenNthCalledWith(1, 'workspace:get-by-id', {
        workspaceId: 'test-workspace',
      });

      // Then file:list
      expect(mockInvoke).toHaveBeenNthCalledWith(2, 'file:list', {
        path: '/workspace/root',
        recursive: true,
      });

      expect(results).toHaveLength(1); // Only test.ts matches 'test' query
      expect(results[0]).toMatchObject({
        type: 'file',
        label: 'test.ts',
      });
    });

    it('should handle empty query', async () => {
      // Mock workspace:get-by-id call
      mockInvoke.mockResolvedValueOnce({ success: true, data: { worktreePath: '/workspace/root' } });

      // Mock file:list call with empty results
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: [],
      });

      const results = await provider.search('', mockContext);

      expect(mockInvoke).toHaveBeenNthCalledWith(1, 'workspace:get-by-id', {
        workspaceId: 'test-workspace',
      });

      expect(mockInvoke).toHaveBeenNthCalledWith(2, 'file:list', {
        path: '/workspace/root',
        recursive: true,
      });
    });

    it('should limit results to 10 files', async () => {
      // Mock workspace:get-by-id call
      mockInvoke.mockResolvedValueOnce({ success: true, data: { worktreePath: '/workspace/root' } });

      // Mock file:list call with 20 files
      const mockFiles = Array.from({ length: 20 }, (_, i) => ({
        name: `file${i}.ts`,
        path: `/workspace/root/src/file${i}.ts`,
        isFile: true,
        extension: 'ts',
      }));

      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: mockFiles,
      });

      const results = await provider.search('file', mockContext);

      expect(results).toHaveLength(10);
    });

    it('should use fallback files when IPC fails', async () => {
      mockInvoke.mockRejectedValue(new Error('IPC error'));

      const results = await provider.search('README', mockContext);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.label.includes('README'))).toBe(true);
    });

    it('should use fallback when result is invalid', async () => {
      mockInvoke.mockResolvedValue(null);

      const results = await provider.search('README', mockContext);

      // Should return fallback files filtered by query
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.label.includes('README'))).toBe(true);
    });

    it('should use fallback when files array is missing', async () => {
      mockInvoke.mockResolvedValue({ notFiles: [] });

      const results = await provider.search('package', mockContext);

      // Should return fallback files filtered by query
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.label.includes('package'))).toBe(true);
    });

    it('should use fallback when files array is empty', async () => {
      mockInvoke.mockResolvedValue({ files: [] });

      const results = await provider.search('', mockContext);

      // Should return all fallback files when query is empty
      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter invalid file objects', async () => {
      const mockFiles = [
        { name: 'valid.ts', path: 'src/valid.ts' },
        null, // invalid
        { name: 'also-valid.ts', path: 'src/also-valid.ts' },
        { name: 'no-path.ts' }, // missing path
      ];

      mockInvoke.mockResolvedValue({ files: mockFiles });

      const results = await provider.search('test', mockContext);

      // Should only include the 2 valid files
      expect(results.length).toBeLessThanOrEqual(2);
      expect(results.every((r) => r.meta?.path)).toBe(true);
    });

    it('should show distinguishing paths for duplicate filenames', async () => {
      // Mock workspace:get-by-id call
      mockInvoke.mockResolvedValueOnce({ success: true, data: { worktreePath: '/workspace/root' } });

      // Mock file:list call with duplicate filenames
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: [
          {
            name: '+page.svelte',
            path: '/workspace/root/src/routes/home/+page.svelte',
            isFile: true,
            extension: 'svelte',
          },
          {
            name: '+page.svelte',
            path: '/workspace/root/src/routes/settings/+page.svelte',
            isFile: true,
            extension: 'svelte',
          },
          {
            name: '+page.svelte',
            path: '/workspace/root/src/routes/profile/+page.svelte',
            isFile: true,
            extension: 'svelte',
          },
        ],
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
      // Mock workspace:get-by-id call
      mockInvoke.mockResolvedValueOnce({ success: true, data: { worktreePath: '/workspace/root' } });

      // Mock file:list call with unique filenames
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: [
          {
            name: 'unique.ts',
            path: '/workspace/root/src/unique.ts',
            isFile: true,
            extension: 'ts',
          },
          {
            name: 'other.ts',
            path: '/workspace/root/src/other.ts',
            isFile: true,
            extension: 'ts',
          },
        ],
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
