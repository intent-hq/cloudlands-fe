import { describe, expect, it, vi } from 'vitest';
import { createFileListDirectory } from './backend-file-list-directory';

describe('strict file.list immediate directory contract', () => {
  it('sends the exact method and requested relative directory, preserving names and ordering', async () => {
    const request = vi.fn().mockResolvedValue([
      { name: 'z.txt', type: 'file' },
      { name: '資料', type: 'directory' },
      { name: 'back\\slash.txt', type: 'file' },
    ]);
    const list = createFileListDirectory(request, { strict: true });
    expect(await list('ws', 'src')).toEqual([
      { name: 'z.txt', path: 'src/z.txt', type: 'file' },
      { name: '資料', path: 'src/資料', type: 'directory' },
      { name: 'back\\slash.txt', path: 'src/back\\slash.txt', type: 'file' },
    ]);
    expect(request.mock.calls).toEqual([['file.list', { workspaceId: 'ws', path: 'src' }]]);
  });

  it('preserves a successful empty root and rejects a backend failure unchanged', async () => {
    const failure = new Error('permission denied');
    const request = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(failure);
    const list = createFileListDirectory(request, { strict: true });
    expect(await list('ws', '')).toEqual([]);
    await expect(list('ws', 'private')).rejects.toBe(failure);
  });

  it.each([
    null,
    { entries: [] },
    [{ name: 'bad', type: 'dir' }],
    [{ name: '', type: 'file' }],
    [{ name: '..', type: 'directory' }],
    [{ name: '../outside', type: 'file' }],
    [{ name: '/outside', type: 'file' }],
    [{ name: 'bad\0name', type: 'file' }],
    [{ name: 'ok', type: 'file', path: 'other/ok' }],
    [{ name: 'ok', type: 'directory', children: [] }],
    [{ name: 'ok', type: 'file', isDirectory: true }],
    [
      { name: 'same', type: 'file' },
      { name: 'same', type: 'file' },
    ],
  ])(
    'rejects malformed or outside-directory response %j without partial adoption',
    async (response) => {
      const list = createFileListDirectory(vi.fn().mockResolvedValue(response), { strict: true });
      await expect(list('ws', 'src')).rejects.toBeInstanceOf(TypeError);
    },
  );

  it.each(['../outside', '/absolute', 'a/../b', 'a//b', 'C:/outside'])(
    'rejects an uncontained request %s before dispatch',
    async (path) => {
      const request = vi.fn();
      await expect(
        createFileListDirectory(request, { strict: true })('ws', path),
      ).rejects.toBeInstanceOf(TypeError);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('carries the live guard through asynchronous transport preflight', async () => {
    let active = true;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wire = vi.fn();
    const list = createFileListDirectory(
      async <T>(
        _method: string,
        _params: Record<string, unknown>,
        options?: { onDispatch?: () => void },
      ) => {
        await ready;
        options?.onDispatch?.();
        wire();
        return [] as T;
      },
      { strict: true },
    );
    const result = list('ws', '', () => active);
    active = false;
    release();
    await expect(result).rejects.toThrow('retired');
    expect(wire).not.toHaveBeenCalled();
  });

  it('retains tolerant legacy callers and their empty failure fallback', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ entries: [{ path: 'src', isDirectory: true }] })
      .mockRejectedValueOnce(new Error('offline'));
    const list = createFileListDirectory(request);
    expect(await list('ws', '')).toEqual([{ name: 'src', path: 'src', type: 'directory' }]);
    expect(await list('ws', '')).toEqual([]);
  });
});
