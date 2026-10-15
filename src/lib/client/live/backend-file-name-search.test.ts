import { describe, expect, it, vi } from 'vitest';
import { createBackendFileNameSearch } from './backend-file-name-search';

describe('backend filename search', () => {
  it('sends the bounded wire request and preserves returned relative paths and order', async () => {
    const files = [
      'docs/Notes with spaces.md',
      'src/日本語.ts',
      'literal\\name.ts',
      'C:notes.ts',
      'test/Notes with spaces.md',
    ];
    const request = vi
      .fn()
      .mockResolvedValue({ files, requestId: 'wire-request', truncated: true });
    const read = createBackendFileNameSearch(request);
    expect(await read('workspace', 'Notes')).toEqual({ files, truncated: true });
    expect(request.mock.calls).toEqual([
      ['search.fileNames', { workspaceId: 'workspace', pattern: 'Notes', limit: 100 }],
    ]);
  });

  it('distinguishes a successful empty result from a rejected transport', async () => {
    const failure = new Error('offline');
    const request = vi
      .fn()
      .mockResolvedValueOnce({ files: [], requestId: 'wire-request', truncated: false })
      .mockRejectedValueOnce(failure);
    const read = createBackendFileNameSearch(request);
    expect(await read('workspace', 'missing')).toEqual({ files: [], truncated: false });
    await expect(read('workspace', 'retry')).rejects.toBe(failure);
  });

  it.each([
    null,
    [],
    {},
    { files: [], requestId: undefined },
    { files: [], requestId: '' },
    { files: [], truncated: undefined },
    { files: [], truncated: 1 },
    { files: 'src/index.ts' },
    { files: [1] },
    { files: [''] },
    { files: ['../outside'] },
    { files: ['/absolute'] },
    { files: ['src/../outside'] },
    { files: ['src/./index.ts'] },
    { files: ['src//index.ts'] },
    { files: ['bad\0name'] },
    { files: ['same.ts', 'same.ts'] },
    { files: Array.from({ length: 101 }, (_, index) => `file-${index}`) },
  ])('rejects malformed results without adopting partial paths: %j', async (result) => {
    const response =
      result && !Array.isArray(result)
        ? { requestId: 'wire-request', truncated: false, ...result }
        : result;
    const read = createBackendFileNameSearch(vi.fn().mockResolvedValue(response));
    await expect(read('workspace', 'file')).rejects.toBeInstanceOf(TypeError);
  });

  it('checks admission before dispatch, after asynchronous preflight, and after response', async () => {
    const blocked = vi.fn();
    await expect(createBackendFileNameSearch(blocked)('ws', 'file', () => false)).rejects.toThrow(
      'retired',
    );
    expect(blocked).not.toHaveBeenCalled();

    let active = true;
    let finishPreflight!: () => void;
    const preflight = new Promise<void>((resolve) => {
      finishPreflight = resolve;
    });
    const wire = vi.fn();
    const read = createBackendFileNameSearch(
      async <T>(
        _method: string,
        _params: Record<string, unknown>,
        options?: { onDispatch?: () => void },
      ) => {
        await preflight;
        options?.onDispatch?.();
        wire();
        return { files: [], requestId: 'wire-request', truncated: false } as T;
      },
    );
    const pending = read('ws', 'file', () => active);
    active = false;
    finishPreflight();
    await expect(pending).rejects.toThrow('retired');
    expect(wire).not.toHaveBeenCalled();

    active = true;
    const late = createBackendFileNameSearch(async <T>() => {
      active = false;
      return { files: ['late.ts'], requestId: 'wire-request', truncated: false } as T;
    });
    await expect(late('ws', 'file', () => active)).rejects.toThrow('retired');
  });
});
