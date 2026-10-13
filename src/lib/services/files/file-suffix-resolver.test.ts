import { describe, expect, it, vi } from 'vitest';
import { createFileListDirectory } from '$lib/client/live/backend-file-list-directory';
import type { BackendTransport } from '$lib/client/live/backend-transport-types';
import { createFileSuffixResolver } from './file-suffix-resolver';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('host-bound file suffix resolution', () => {
  it('uses the shared file.list response normalization for bounded media recovery', async () => {
    const request = vi
      .fn<BackendTransport['request']>()
      .mockResolvedValueOnce([{ name: 'run', path: 'run', type: 'directory' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: 'preview.png', path: 'preview.png', type: 'file' }]);
    const resolve = createFileSuffixResolver({
      request,
      listDirectory: createFileListDirectory(request),
    });
    await expect(resolve('ws-1', 'preview.png')).resolves.toEqual({
      candidates: ['.demo-artifacts/run/preview.png'],
      truncated: false,
    });
    expect(request.mock.calls).toEqual([
      ['file.list', { workspaceId: 'ws-1', path: '.demo-artifacts' }],
      ['file.list', { workspaceId: 'ws-1', path: 'artifacts' }],
      ['file.list', { workspaceId: 'ws-1', path: '.demo-artifacts/run' }],
    ]);
  });

  it('does not enter filename search or artifact traversal when admission is retired', async () => {
    const request = vi.fn<BackendTransport['request']>();
    const resolve = createFileSuffixResolver({
      request,
      listDirectory: createFileListDirectory(request),
    });
    await expect(resolve('ws-1', 'src/a.ts', () => false)).resolves.toEqual({
      candidates: [],
      truncated: true,
    });
    await expect(resolve('ws-1', 'preview.png', () => false)).resolves.toEqual({
      candidates: [],
      truncated: true,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not start artifact fallback after an in-flight search loses admission', async () => {
    const search = deferred<unknown>();
    const request = vi.fn<BackendTransport['request']>().mockReturnValueOnce(search.promise);
    let current = true;
    const resolve = createFileSuffixResolver({
      request,
      listDirectory: createFileListDirectory(request),
    });
    const result = resolve('ws-1', 'run/preview.png', () => current);
    current = false;
    search.resolve({ files: [], truncated: false });
    await expect(result).resolves.toEqual({ candidates: [], truncated: true });
    expect(request.mock.calls).toEqual([
      ['search.fileNames', { workspaceId: 'ws-1', pattern: 'run/preview.png', limit: 50 }],
    ]);
  });

  it('stops queued artifact directory reads when admission retires during a listing', async () => {
    const listing = deferred<unknown>();
    const request = vi.fn<BackendTransport['request']>().mockReturnValueOnce(listing.promise);
    let current = true;
    const resolve = createFileSuffixResolver({
      request,
      listDirectory: createFileListDirectory(request),
    });
    const result = resolve('ws-1', 'preview.png', () => current);
    current = false;
    listing.resolve([{ name: 'preview.png', path: 'preview.png', type: 'file' }]);
    await expect(result).resolves.toEqual({ candidates: [], truncated: true });
    expect(request.mock.calls).toEqual([
      ['file.list', { workspaceId: 'ws-1', path: '.demo-artifacts' }],
    ]);
  });
});
