/**
 * Wire-contract tests for the daemon-backed diff batcher (D2).
 *
 * FAKE transport only: `backendRequest` is mocked so no request reaches a
 * real daemon. Asserts the JSON-RPC methods + params the batcher emits
 * (PROTOCOL.md §5.6 `git.diffs`/`git.showFile`, §5.9 `file.read`) and how the
 * hunk-only `git.diffs` result is composed with the per-file full contents.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));
vi.mock('$lib/electron-bridge', async () =>
  await import('$store/renderer/utils/test-helpers/electron-bridge-mock'),
);

import { backendRequest } from '$lib/client/live/backend-transport';
import { batchedGitDiff, dedupedShowFile } from '../diff-ipc-batcher';

const mockedRequest = vi.mocked(backendRequest);

const HUNK = {
  oldStart: 1,
  oldLines: 0,
  newStart: 1,
  newLines: 1,
  lines: [{ type: 'Addition', content: 'x', newNumber: 1 }],
};

/** PROTOCOL-shaped daemon: `git.diffs` → bare `[{ path, hunks }]`,
 * `git.showFile` → `{ content }` keyed by `<ref>:<filePath>`, `file.read` →
 * `{ content }` keyed by path (missing → rejects, like a deleted file). */
function mockDaemon({
  diffs = [] as unknown[],
  showFiles = {} as Record<string, string>,
  files = {} as Record<string, string>,
} = {}) {
  mockedRequest.mockImplementation(async (method: string, params?: unknown) => {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === 'git.diffs') return diffs;
    if (method === 'git.showFile') {
      return { content: showFiles[`${p.ref}:${p.filePath}`] ?? '' };
    }
    if (method === 'file.read') {
      const path = String(p.path);
      if (path in files) return { content: files[path] };
      throw new Error(`file not found: ${path}`);
    }
    throw new Error(`unexpected method: ${method}`);
  });
}

describe('diff-ipc-batcher (daemon wire)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces same-tick unstaged requests into one git.diffs read and composes ":0" + file.read contents', async () => {
    mockDaemon({
      diffs: [
        { path: 'a.ts', hunks: [HUNK] },
        { path: 'b.ts', hunks: [] },
      ],
      showFiles: { ':0:a.ts': 'old a', ':0:b.ts': 'old b' },
      files: { 'a.ts': 'new a', 'b.ts': 'new b' },
    });

    const aPromise = batchedGitDiff('ws-1', false, 'a.ts');
    const bPromise = batchedGitDiff('ws-1', false, 'b.ts');
    await vi.runAllTimersAsync();

    await expect(Promise.all([aPromise, bPromise])).resolves.toEqual([
      { file: 'a.ts', chunks: [HUNK], oldContent: 'old a', newContent: 'new a' },
      { file: 'b.ts', chunks: [], oldContent: 'old b', newContent: 'new b' },
    ]);

    const diffCalls = mockedRequest.mock.calls.filter(([method]) => method === 'git.diffs');
    expect(diffCalls).toEqual([['git.diffs', { workspaceId: 'ws-1', paths: ['a.ts', 'b.ts'] }]]);
    expect(mockedRequest).toHaveBeenCalledWith('git.showFile', {
      workspaceId: 'ws-1',
      filePath: 'a.ts',
      ref: ':0',
    });
    expect(mockedRequest).toHaveBeenCalledWith('file.read', { workspaceId: 'ws-1', path: 'a.ts' });
  });

  it('sends staged: true for the staged group and composes HEAD + ":0" contents', async () => {
    mockDaemon({
      diffs: [{ path: 'a.ts', hunks: [HUNK] }],
      showFiles: { 'HEAD:a.ts': 'head a', ':0:a.ts': 'index a' },
    });

    const promise = batchedGitDiff('ws-2', true, 'a.ts');
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({
      file: 'a.ts',
      chunks: [HUNK],
      oldContent: 'head a',
      newContent: 'index a',
    });
    expect(mockedRequest).toHaveBeenCalledWith('git.diffs', {
      workspaceId: 'ws-2',
      staged: true,
      paths: ['a.ts'],
    });
    expect(mockedRequest).toHaveBeenCalledWith('git.showFile', {
      workspaceId: 'ws-2',
      filePath: 'a.ts',
      ref: 'HEAD',
    });
    expect(mockedRequest).toHaveBeenCalledWith('git.showFile', {
      workspaceId: 'ws-2',
      filePath: 'a.ts',
      ref: ':0',
    });
    expect(
      mockedRequest.mock.calls.some(([method]) => method === 'file.read'),
    ).toBe(false);
  });

  it('resolves undefined for a path the daemon returned no diff entry for', async () => {
    mockDaemon({ diffs: [{ path: 'other.ts', hunks: [] }], files: { 'other.ts': 'x' } });

    const promise = batchedGitDiff('ws-3', false, 'missing.ts');
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBeUndefined();
  });

  it('folds a deleted working-tree file to an empty new side', async () => {
    // `files` is empty → file.read rejects, mirroring an unstaged deletion.
    mockDaemon({
      diffs: [{ path: 'gone.ts', hunks: [HUNK] }],
      showFiles: { ':0:gone.ts': 'index content' },
    });

    const promise = batchedGitDiff('ws-4', false, 'gone.ts');
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({
      file: 'gone.ts',
      chunks: [HUNK],
      oldContent: 'index content',
      newContent: '',
    });
  });

  it('leaves a side undefined (hunk-only fallback) when its git.showFile read fails', async () => {
    mockedRequest.mockImplementation(async (method: string) => {
      if (method === 'git.diffs') return [{ path: 'a.ts', hunks: [HUNK] }];
      if (method === 'git.showFile') throw new Error('daemon unavailable');
      if (method === 'file.read') return { content: 'workdir a' };
      throw new Error(`unexpected method: ${method}`);
    });

    const promise = batchedGitDiff('ws-5', false, 'a.ts');
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({
      file: 'a.ts',
      chunks: [HUNK],
      newContent: 'workdir a',
    });
  });

  it('rejects every batched request when the git.diffs read fails', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'));

    // Attach the rejection handlers before flushing timers so the settled
    // promises never surface as unhandled rejections.
    const aExpectation = expect(batchedGitDiff('ws-6', false, 'a.ts')).rejects.toThrow('boom');
    const bExpectation = expect(batchedGitDiff('ws-6', false, 'b.ts')).rejects.toThrow('boom');
    await vi.runAllTimersAsync();

    await aExpectation;
    await bExpectation;
  });

  it('dedupedShowFile shares one in-flight git.showFile per (workspace, ref, path) and maps { content }', async () => {
    mockDaemon({ showFiles: { 'HEAD:a.ts': 'head a' } });

    const [first, second] = await Promise.all([
      dedupedShowFile('ws-7', 'HEAD', 'a.ts'),
      dedupedShowFile('ws-7', 'HEAD', 'a.ts'),
    ]);

    expect(first).toEqual({ success: true, data: 'head a' });
    expect(second).toEqual({ success: true, data: 'head a' });
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith('git.showFile', {
      workspaceId: 'ws-7',
      filePath: 'a.ts',
      ref: 'HEAD',
    });
  });

  it('dedupedShowFile folds daemon/transport errors into { success: false, error }', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('unresolvable ref'));

    await expect(dedupedShowFile('ws-8', 'nope', 'a.ts')).resolves.toEqual({
      success: false,
      error: 'unresolvable ref',
    });
  });
});