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

import * as contextApi from './context-api';
import { backendRequest } from '$lib/client/live/backend-transport';

const mockBackendRequest = backendRequest as ReturnType<typeof vi.fn>;

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
          {
            symbol: 'MyClass',
            kind: 'class',
            file: 'src/my-class.ts',
            line: 12,
            preview: 'class MyClass {',
          },
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

  describe('dead note readers', () => {
    it('no longer exports the legacy notes:* readers', () => {
      expect((contextApi as any).getNotes).toBeUndefined();
      expect((contextApi as any).getNote).toBeUndefined();
      expect((contextApi as any).createNoteContext).toBeUndefined();
    });
  });

  describe('placeAttachment (file.placeAttachment, PROTOCOL §5.9, v6.5)', () => {
    it('sends the base64 data variant on the wire and returns the daemon result', async () => {
      mockBackendRequest.mockResolvedValueOnce({
        ok: true,
        path: '.intent/attachments/dump.har',
        fileName: 'dump.har',
        size: 12_582_912,
      });

      const result = await contextApi.placeAttachment('ws-1', 'dump.har', {
        data: 'data:application/json;base64,eyJsb2ciOnt9fQ==',
      });

      expect(mockBackendRequest).toHaveBeenCalledWith('file.placeAttachment', {
        workspaceId: 'ws-1',
        fileName: 'dump.har',
        data: 'data:application/json;base64,eyJsb2ciOnt9fQ==',
      });
      expect(result).toEqual({
        ok: true,
        path: '.intent/attachments/dump.har',
        fileName: 'dump.har',
        size: 12_582_912,
      });
    });

    it('sends the sourcePath variant on the wire (same-host fast path)', async () => {
      mockBackendRequest.mockResolvedValueOnce({
        ok: true,
        path: '.intent/attachments/dump-2.har',
        fileName: 'dump-2.har',
        size: 42,
      });

      const result = await contextApi.placeAttachment('ws-1', 'dump.har', {
        sourcePath: '/home/user/Downloads/dump.har',
      });

      expect(mockBackendRequest).toHaveBeenCalledWith('file.placeAttachment', {
        workspaceId: 'ws-1',
        fileName: 'dump.har',
        sourcePath: '/home/user/Downloads/dump.har',
      });
      // The daemon owns collision-safe renaming — the FE surfaces its choice.
      expect(result.fileName).toBe('dump-2.har');
      expect(result.path).toBe('.intent/attachments/dump-2.har');
    });

    it('propagates daemon errors to the caller — never a fabricated placement', async () => {
      mockBackendRequest.mockRejectedValueOnce(new Error('-32602 invalid params'));

      await expect(
        contextApi.placeAttachment('ws-1', 'dump.har', { data: 'AAAA' }),
      ).rejects.toThrow('-32602 invalid params');
    });
  });
});
