import { afterEach, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the backend bridge is mocked so no file mutation ever
// reaches the user's real daemon/disk. `runMutation` / `newIdempotencyKey` stay
// real so the asserted method + params and the success/error folding are the
// genuine code paths.
vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from './backend-transport';
import { LiveFilesClient } from './live-files-client';
import { BackendError } from './backend-transport-types';
import { JsonRpcError } from '$features/backend/main/json-rpc-errors';

const mockedRequest = vi.mocked(backendRequest);

describe('LiveFilesClient mutations (fake transport)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('write forwards file.write with workspace-relative path + an idempotencyKey', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveFilesClient();

    const result = await client.write('ws-1', 'src/a.ts', 'hello');

    expect(result).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      'file.write',
      expect.objectContaining({
        workspaceId: 'ws-1',
        path: 'src/a.ts',
        content: 'hello',
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it('write generates a distinct idempotencyKey per call', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const client = new LiveFilesClient();

    await client.write('ws-1', 'a.ts', 'x');
    await client.write('ws-1', 'a.ts', 'y');

    const first = (mockedRequest.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey;
    const second = (mockedRequest.mock.calls[1][1] as { idempotencyKey: string }).idempotencyKey;
    expect(first).not.toEqual(second);
  });

  it('delete forwards file.delete WITHOUT an idempotencyKey', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveFilesClient();

    expect(await client.delete('ws-1', 'src/a.ts')).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith('file.delete', {
      workspaceId: 'ws-1',
      path: 'src/a.ts',
    });
  });

  it('mkdir forwards file.mkdir with an idempotencyKey', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveFilesClient();

    expect(await client.mkdir('ws-1', 'src/new')).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      'file.mkdir',
      expect.objectContaining({
        workspaceId: 'ws-1',
        path: 'src/new',
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it('rename forwards file.rename with old/new paths + an idempotencyKey', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveFilesClient();

    expect(await client.rename('ws-1', 'old.ts', 'new.ts')).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      'file.rename',
      expect.objectContaining({
        workspaceId: 'ws-1',
        oldPath: 'old.ts',
        newPath: 'new.ts',
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it('maps a daemon error to a failed MutationResult without throwing', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const client = new LiveFilesClient();

    expect(await client.write('ws-1', 'a.ts', 'x')).toEqual({ success: false, error: 'boom' });
  });
});

describe('LiveFilesClient.explorerTree (fake transport)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forwards file.tree anchored at '.' and returns a synthetic root FileNode", async () => {
    mockedRequest.mockResolvedValueOnce([
      { path: 'src', name: 'src', isDirectory: true },
      { path: 'README.md', name: 'README.md', isDirectory: false },
    ]);
    const client = new LiveFilesClient();

    const tree = await client.explorerTree('ws-1');

    expect(mockedRequest).toHaveBeenCalledWith('file.tree', { workspaceId: 'ws-1', path: '.' });
    expect(tree).toEqual({
      name: '',
      path: '',
      type: 'directory',
      children: [
        { name: 'src', path: 'src', type: 'directory' },
        { name: 'README.md', path: 'README.md', type: 'file' },
      ],
    });
  });

  it('propagates daemon errors so initialization can expose a retry', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('tree boom'));
    const client = new LiveFilesClient();

    await expect(client.explorerTree('ws-1')).rejects.toThrow('tree boom');
  });

  it('rejects a non-array file.tree response instead of treating it as an empty tree', async () => {
    mockedRequest.mockResolvedValueOnce({ entries: [] });
    const client = new LiveFilesClient();

    await expect(client.explorerTree('ws-1')).rejects.toThrow(
      'Invalid file.tree response: expected an array',
    );
  });
});

describe('LiveFilesClient.read', () => {
  afterEach(() => vi.resetAllMocks());

  it.each([
    '.intent/artifacts/report.xlsx',
    '.intent/artifacts/report.xslx',
    'data.unknown',
    'extensionless',
  ])('identifies an existing non-UTF-8 file without relying on its extension: %s', async (path) => {
    mockedRequest.mockRejectedValueOnce(
      new BackendError({
        code: 'INTERNAL_ERROR',
        rpcCode: -32603,
        message: 'Internal error',
        data: { code: 'INTERNAL_ERROR', detail: 'stream did not contain valid UTF-8' },
      }),
    );
    expect(await new LiveFilesClient().read('remote-workspace', path)).toMatchObject({
      isBinary: true,
      originalContent: '',
      localContent: '',
      error: null,
    });
    expect(mockedRequest).toHaveBeenCalledExactlyOnceWith('file.read', {
      workspaceId: 'remote-workspace',
      path,
    });
  });

  it('recognizes the daemon UTF-8 error after the Electron IPC normalization', async () => {
    const rpcError = new JsonRpcError({
      code: -32603,
      message: 'Internal error',
      data: 'stream did not contain valid UTF-8',
    });
    mockedRequest.mockRejectedValueOnce(new BackendError(rpcError.toErrorPayload()));
    expect(await new LiveFilesClient().read('ws-1', 'report.xlsx')).toMatchObject({
      isBinary: true,
      originalContent: '',
    });
  });

  it('recognizes the raw daemon data string when transport normalization is absent', async () => {
    mockedRequest.mockRejectedValueOnce(
      new BackendError({
        code: 'INTERNAL_ERROR',
        rpcCode: -32603,
        message: 'Internal error',
        data: 'stream did not contain valid UTF-8',
      }),
    );
    expect(await new LiveFilesClient().read('ws-1', 'data.unknown')).toMatchObject({
      isBinary: true,
    });
  });

  it.each(['data.pb', 'extensionless', 'data.unknown'])(
    'recognizes UTF-8 binary control bytes in %s',
    async (path) => {
      mockedRequest.mockResolvedValueOnce('\b\u0001');
      expect(await new LiveFilesClient().read('ws-1', path)).toMatchObject({
        isBinary: true,
        originalContent: '',
        localContent: '',
      });
    },
  );

  it('does not offer null-containing bytes to the text editor', async () => {
    mockedRequest.mockResolvedValueOnce('PK\0\0');
    expect(await new LiveFilesClient().read('ws-1', 'data.bin')).toMatchObject({
      isBinary: true,
      originalContent: '',
      localContent: '',
    });
  });

  it.each(['', 'name,value\nhello,123', 'Hello café', '你好 🌍\t\r\n', '\t\r\n'])(
    'preserves ordinary UTF-8 text: %s',
    async (content) => {
      mockedRequest.mockResolvedValueOnce(content);
      expect(await new LiveFilesClient().read('ws-1', 'data.unknown')).toMatchObject({
        isBinary: false,
        originalContent: content,
        localContent: content,
      });
    },
  );

  it.each([
    'internal error: No such file or directory (os error 2)',
    'internal error: The system cannot find the file specified. (os error 2)',
    'internal error: The system cannot find the path specified. (os error 3)',
  ])('preserves missing-file recovery for %s', async (message) => {
    mockedRequest.mockRejectedValueOnce(
      new BackendError({
        code: 'INTERNAL_ERROR',
        rpcCode: -32603,
        message: 'Internal error',
        data: { detail: message },
      }),
    );
    expect(await new LiveFilesClient().read('ws-1', 'missing.xlsx')).toBeNull();
  });

  it.each([
    new BackendError({
      code: 'INTERNAL_ERROR',
      rpcCode: -32603,
      message: 'internal error: Permission denied (os error 13)',
    }),
    new BackendError({
      code: 'INTERNAL_ERROR',
      rpcCode: -32603,
      message: 'internal error: Access denied: path outside workspace',
    }),
    new BackendError({
      code: 'INTERNAL_ERROR',
      rpcCode: -32603,
      message: 'internal error: Is a directory (os error 21)',
    }),
    new BackendError({ code: 'INTERNAL_ERROR', rpcCode: -32603, message: 'Internal error' }),
    new BackendError({
      code: 'INTERNAL_ERROR',
      rpcCode: -32603,
      message: 'Internal error',
      data: { detail: 'Permission denied (os error 13)' },
    }),
    new BackendError({
      code: 'INTERNAL_ERROR',
      rpcCode: -32603,
      message: 'Internal error',
      data: { detail: { message: 'stream did not contain valid UTF-8' } },
    }),
    new BackendError({
      code: 'TRANSPORT_ERROR',
      message: 'Internal error',
      data: { detail: 'stream did not contain valid UTF-8' },
    }),
    new Error('Connection closed'),
    new Error('stream did not contain valid UTF-8'),
  ])('preserves read errors instead of claiming a file is missing or binary: %s', async (error) => {
    mockedRequest.mockRejectedValueOnce(error);
    await expect(new LiveFilesClient().read('ws-1', 'report.xlsx')).rejects.toBe(error);
  });
});
