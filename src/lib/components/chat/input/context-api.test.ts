/**
 * Regression tests for the chat context API daemon reads.
 *
 * Guards the P3 audit fix: on transport failure these reads MUST surface empty
 * results (never fabricated files/notes/selections/symbols), and file/symbol
 * search MUST hit the daemon search namespace (PROTOCOL §5.15).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(),
}));

import * as contextApi from './context-api';
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';

const mockBackendRequest = backendRequest as ReturnType<typeof vi.fn>;
const mockInvoke = invoke as ReturnType<typeof vi.fn>;

describe('context-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('searchFiles', () => {
    it('requests search.fileNames and maps returned paths', async () => {
      mockBackendRequest.mockResolvedValueOnce({
        requestId: 'srch-1',
        files: ['src/foo.ts', 'docs/bar.md'],
        truncated: false,
      });

      const results = await contextApi.searchFiles('ws-1', 'foo', 5);

      expect(mockBackendRequest).toHaveBeenCalledWith('search.fileNames', {
        workspaceId: 'ws-1',
        pattern: 'foo',
        limit: 5,
      });
      expect(results).toEqual([
        { name: 'foo.ts', path: 'src/foo.ts', relativePath: 'src/foo.ts', type: 'file' },
        { name: 'bar.md', path: 'docs/bar.md', relativePath: 'docs/bar.md', type: 'file' },
      ]);
    });

    it('returns empty results on failure — never fabricated files', async () => {
      mockBackendRequest.mockRejectedValue(new Error('daemon error'));

      const results = await contextApi.searchFiles('ws-1', 'foo');

      expect(results).toEqual([]);
    });

    it('returns empty results when the files array is missing', async () => {
      mockBackendRequest.mockResolvedValue({ requestId: 'srch-1' });

      const results = await contextApi.searchFiles('ws-1', 'foo');

      expect(results).toEqual([]);
    });
  });

  describe('searchSymbols', () => {
    it('requests search.codebase and maps returned matches', async () => {
      mockBackendRequest.mockResolvedValueOnce({
        requestId: 'srch-2',
        matches: [
          { symbol: 'MyClass', kind: 'class', file: 'src/my-class.ts', line: 12, preview: 'class MyClass {' },
        ],
      });

      const results = await contextApi.searchSymbols('ws-1', 'MyClass', 5);

      expect(mockBackendRequest).toHaveBeenCalledWith('search.codebase', {
        workspaceId: 'ws-1',
        query: 'MyClass',
      });
      expect(results).toEqual([
        {
          name: 'MyClass',
          kind: 'class',
          file: 'src/my-class.ts',
          line: 12,
          documentation: 'class MyClass {',
        },
      ]);
    });

    it('returns empty results on failure — never fabricated symbols', async () => {
      mockBackendRequest.mockRejectedValue(new Error('daemon error'));

      const results = await contextApi.searchSymbols('ws-1', 'MyClass');

      expect(results).toEqual([]);
    });
  });

  describe('getEditorSelection', () => {
    it('returns null on failure — never a fabricated selection', async () => {
      mockInvoke.mockRejectedValue(new Error('IPC error'));

      const selection = await contextApi.getEditorSelection('ws-1');

      expect(selection).toBeNull();
    });

    it('returns null when there is no selection', async () => {
      mockInvoke.mockResolvedValue(null);

      const selection = await contextApi.getEditorSelection('ws-1');

      expect(selection).toBeNull();
    });
  });

  describe('dead note readers', () => {
    it('no longer exports the legacy notes:* readers', () => {
      expect((contextApi as any).getNotes).toBeUndefined();
      expect((contextApi as any).getNote).toBeUndefined();
      expect((contextApi as any).createNoteContext).toBeUndefined();
    });
  });
});
