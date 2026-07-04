/**
 * Wire-contract tests for the file IPC bridge seeder.
 *
 * Asserts each legacy `file:*` channel (a) forwards to the daemon filesystem
 * surface (`file.read` / `file.write` / `file.delete` / `file.rename`,
 * PROTOCOL §5.9, and `host.directoryStatus`, §5.14) with the exact params, and
 * (b) maps the daemon result back to the legacy envelope the call sites
 * (context-api, diff viewers, FilesPanel, the explorer CRUD, the file-explorer
 * route) already consume.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires. The
// store + selector are mocked so the active-workspace fallback is exercised
// without booting the real store.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));
vi.mock('$store/renderer/store', () => ({
  store: { state: {} },
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: { select: vi.fn(() => 'ws-active') },
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { mockInvoke } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const mockedRequest = vi.mocked(backendRequest);

describe('file-bridge-seeder', () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import('./file-bridge-seeder');
  });

  afterEach(() => vi.clearAllMocks());

  describe('file:read → file.read (§5.9)', () => {
    it('forwards workspaceId + path and folds the bare string into the double shape', async () => {
      mockedRequest.mockResolvedValueOnce('hello world');

      const result = await mockInvoke(IPC_CHANNELS.FILE.READ, {
        path: '/ws/src/x.ts',
        workspaceId: 'ws-1',
      });

      expect(mockedRequest).toHaveBeenCalledWith('file.read', {
        workspaceId: 'ws-1',
        path: '/ws/src/x.ts',
      });
      expect(result).toEqual({
        success: true,
        content: 'hello world',
        data: { content: 'hello world', isBinary: false, truncated: false },
      });
    });

    it('resolves the active workspace when the call site omits workspaceId', async () => {
      mockedRequest.mockResolvedValueOnce('body');

      await mockInvoke(IPC_CHANNELS.FILE.READ, { path: '/ws/notes/a.md' });

      expect(mockedRequest).toHaveBeenCalledWith('file.read', {
        workspaceId: 'ws-active',
        path: '/ws/notes/a.md',
      });
    });

    it('folds a daemon error into the legacy IpcResponse error object', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('Access denied: path outside workspace'));

      const result = await mockInvoke(IPC_CHANNELS.FILE.READ, {
        path: '/etc/passwd',
        workspaceId: 'ws-1',
      });

      expect(result).toEqual({
        success: false,
        error: { code: 'FILE_READ_FAILED', message: 'Access denied: path outside workspace' },
      });
    });
  });

  describe('file:write → file.write (§5.9)', () => {
    it('forwards workspaceId + path + content and reports bytesWritten', async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true, path: 'src/x.ts', size: 5 });

      const result = await mockInvoke(IPC_CHANNELS.FILE.WRITE, {
        path: '/ws/src/x.ts',
        content: 'hello',
        workspaceId: 'ws-1',
      });

      expect(mockedRequest).toHaveBeenCalledWith('file.write', {
        workspaceId: 'ws-1',
        path: '/ws/src/x.ts',
        content: 'hello',
      });
      expect(result).toEqual({ success: true, data: { bytesWritten: 5 } });
    });

    it('rejects base64 (binary) writes shaped, without touching the wire', async () => {
      const result = (await mockInvoke(IPC_CHANNELS.FILE.WRITE, {
        path: '/ws/img.png',
        content: 'aGVsbG8=',
        encoding: 'base64',
        workspaceId: 'ws-1',
      })) as { success: boolean; error: { code: string } };

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('UNSUPPORTED_ENCODING');
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });

  describe('file:open / file:save (file-explorer route)', () => {
    it('open reads via file.read and returns top-level content', async () => {
      mockedRequest.mockResolvedValueOnce('file body');

      const result = await mockInvoke('file:open', { path: '/ws/readme.md' });

      expect(mockedRequest).toHaveBeenCalledWith('file.read', {
        workspaceId: 'ws-active',
        path: '/ws/readme.md',
      });
      expect(result).toEqual({ success: true, content: 'file body' });
    });

    it('save maps filePath → file.write path', async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true });

      const result = await mockInvoke('file:save', {
        filePath: '/ws/readme.md',
        content: 'updated',
      });

      expect(mockedRequest).toHaveBeenCalledWith('file.write', {
        workspaceId: 'ws-active',
        path: '/ws/readme.md',
        content: 'updated',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('file:exists → host.directoryStatus (§5.14)', () => {
    it('maps the host existence probe into the legacy double shape', async () => {
      mockedRequest.mockResolvedValueOnce({ exists: true, isDirectory: false });

      const result = await mockInvoke(IPC_CHANNELS.FILE.EXISTS, { path: '/ws/src/x.ts' });

      expect(mockedRequest).toHaveBeenCalledWith('host.directoryStatus', {
        path: '/ws/src/x.ts',
      });
      expect(result).toEqual({ success: true, exists: true, data: true });
    });

    it('folds a transport throw into exists:false', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('daemon unavailable'));

      const result = await mockInvoke(IPC_CHANNELS.FILE.EXISTS, { path: '/ws/x' });

      expect(result).toEqual({ success: false, exists: false, error: 'daemon unavailable' });
    });
  });

  describe('file:delete → file.delete (§5.9)', () => {
    it('forwards workspaceId + path and returns the legacy success envelope', async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true, path: '/ws/x', deleted: true });

      const result = await mockInvoke(IPC_CHANNELS.FILE.DELETE, {
        path: '/ws/x',
        workspaceId: 'ws-1',
      });

      expect(mockedRequest).toHaveBeenCalledWith('file.delete', {
        workspaceId: 'ws-1',
        path: '/ws/x',
      });
      expect(result).toEqual({ success: true, data: undefined });
    });

    it('folds a daemon error into the legacy string error', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('No such file'));

      const result = await mockInvoke(IPC_CHANNELS.FILE.DELETE, {
        path: '/ws/missing',
        workspaceId: 'ws-1',
      });

      expect(result).toEqual({ success: false, error: 'No such file' });
    });
  });

  describe('file:move → file.rename (§5.9)', () => {
    it('forwards oldPath/newPath with the resolved workspace', async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true, oldPath: '/ws/a', newPath: '/ws/b' });

      const result = await mockInvoke(IPC_CHANNELS.FILE.MOVE, {
        oldPath: '/ws/a',
        newPath: '/ws/b',
      });

      expect(mockedRequest).toHaveBeenCalledWith('file.rename', {
        workspaceId: 'ws-active',
        oldPath: '/ws/a',
        newPath: '/ws/b',
      });
      expect(result).toEqual({ success: true, data: undefined });
    });
  });

  describe('file:copy → file.read + file.write compose', () => {
    it('reads the source then writes the destination and reports a file copy', async () => {
      mockedRequest.mockResolvedValueOnce('source body');
      mockedRequest.mockResolvedValueOnce({ ok: true });

      const result = await mockInvoke(IPC_CHANNELS.FILE.COPY, {
        sourcePath: '/ws/a.txt',
        destinationPath: '/ws/b.txt',
      });

      expect(mockedRequest).toHaveBeenNthCalledWith(1, 'file.read', {
        workspaceId: 'ws-active',
        path: '/ws/a.txt',
      });
      expect(mockedRequest).toHaveBeenNthCalledWith(2, 'file.write', {
        workspaceId: 'ws-active',
        path: '/ws/b.txt',
        content: 'source body',
      });
      expect(result).toEqual({ success: true, data: { isDirectory: false } });
    });

    it('folds an unreadable (e.g. directory) source into the legacy string error', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('Is a directory (os error 21)'));

      const result = await mockInvoke(IPC_CHANNELS.FILE.COPY, {
        sourcePath: '/ws/dir',
        destinationPath: '/ws/dir-copy',
      });

      expect(result).toEqual({ success: false, error: 'Is a directory (os error 21)' });
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });
  });
});
