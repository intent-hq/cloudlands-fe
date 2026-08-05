/**
 * Wire-contract tests for the daemon-backed diff batcher (D2).
 *
 * FAKE transport only: `backendRequest` is mocked so no request reaches a
 * real daemon. Asserts the JSON-RPC methods + params the batcher emits
 * (PROTOCOL.md §5.6 `git.diffs`/`git.showFile`, §5.9 `file.read`) and how the
 * hunk-only `git.diffs` result is composed with the per-file full contents.
 * The app store is mocked so tests control the workspace rows the batcher
 * reads the worktree root from (request-path normalization).
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

const storeState = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; worktreePath?: string; repositoryPath?: string }>,
}));

vi.mock('$store/renderer/store', async () => {
  const { createCollection } = await import(
    '$lib/store-shim/utils/collections/collection-utils'
  );
  return {
    store: {
      get state() {
        return { workspace: { workspaces: createCollection('id', storeState.workspaces) } };
      },
    },
  };
});

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

/** Daemon that narrows `git.diffs` when `paths` is present and returns the
 * full tree when it is absent (the recovery read). */
function mockNarrowingDaemon(fullTree: unknown[]) {
  mockedRequest.mockImplementation(async (method: string, params?: unknown) => {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === 'git.diffs') {
      if (Array.isArray(p.paths)) {
        const paths = p.paths as string[];
        return fullTree.filter((entry) =>
          paths.includes((entry as { path: string }).path),
        );
      }
      return fullTree;
    }
    if (method === 'git.showFile') return { content: `show:${p.filePath}` };
    if (method === 'file.read') return { content: `read:${p.path}` };
    throw new Error(`unexpected method: ${method}`);
  });
}

describe('diff-ipc-batcher (daemon wire)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    storeState.workspaces = [];
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
    // A well-formed relative path never triggers the full-tree recovery read.
    expect(
      mockedRequest.mock.calls.filter(([method]) => method === 'git.diffs'),
    ).toHaveLength(1);
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

  describe('worktree-root path normalization', () => {
    it('normalizes an absolute path under the worktree root into the batch paths (narrowed read only)', async () => {
      storeState.workspaces = [{ id: 'ws-n1', worktreePath: '/root/ws' }];
      mockNarrowingDaemon([{ path: 'src/a.ts', hunks: [HUNK] }]);

      const promise = batchedGitDiff('ws-n1', false, '/root/ws/src/a.ts');
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toEqual({
        file: 'src/a.ts',
        chunks: [HUNK],
        oldContent: 'show:src/a.ts',
        newContent: 'read:src/a.ts',
      });
      // Exactly one narrowed read carrying the worktree-relative path — no
      // full-tree recovery read.
      const diffCalls = mockedRequest.mock.calls.filter(([method]) => method === 'git.diffs');
      expect(diffCalls).toEqual([['git.diffs', { workspaceId: 'ws-n1', paths: ['src/a.ts'] }]]);
    });

    it('merges an absolute request with its already-relative duplicate into one wire path', async () => {
      storeState.workspaces = [{ id: 'ws-n2', worktreePath: '/root/ws' }];
      mockNarrowingDaemon([{ path: 'src/a.ts', hunks: [HUNK] }]);

      const absPromise = batchedGitDiff('ws-n2', false, '/root/ws/src/a.ts');
      const relPromise = batchedGitDiff('ws-n2', false, 'src/a.ts');
      await vi.runAllTimersAsync();

      await expect(absPromise).resolves.toMatchObject({ file: 'src/a.ts', chunks: [HUNK] });
      await expect(relPromise).resolves.toMatchObject({ file: 'src/a.ts', chunks: [HUNK] });
      const diffCalls = mockedRequest.mock.calls.filter(([method]) => method === 'git.diffs');
      expect(diffCalls).toEqual([['git.diffs', { workspaceId: 'ws-n2', paths: ['src/a.ts'] }]]);
    });

    it('normalizes a ~-prefixed path whose components match a suffix of the worktree root', async () => {
      storeState.workspaces = [{ id: 'ws-n3', worktreePath: '/Users/u/root/ws' }];
      mockNarrowingDaemon([{ path: 'src/a.ts', hunks: [HUNK] }]);

      const promise = batchedGitDiff('ws-n3', false, '~/root/ws/src/a.ts');
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toMatchObject({ file: 'src/a.ts', chunks: [HUNK] });
      const diffCalls = mockedRequest.mock.calls.filter(([method]) => method === 'git.diffs');
      expect(diffCalls).toEqual([['git.diffs', { workspaceId: 'ws-n3', paths: ['src/a.ts'] }]]);
    });

    it('does not emit an empty wire path when a ~-prefixed request points at the root itself', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      storeState.workspaces = [{ id: 'ws-n5', worktreePath: '/Users/u/root/ws' }];
      mockNarrowingDaemon([{ path: 'src/a.ts', hunks: [HUNK] }]);

      const promise = batchedGitDiff('ws-n5', false, '~/root/ws/');
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBeUndefined();
      const diffCalls = mockedRequest.mock.calls.filter(([method]) => method === 'git.diffs');
      expect(diffCalls).toEqual([
        ['git.diffs', { workspaceId: 'ws-n5', paths: ['~/root/ws/'] }],
        ['git.diffs', { workspaceId: 'ws-n5' }],
      ]);
      vi.mocked(console.warn).mockRestore();
    });

    it('falls back to repositoryPath as the root when worktreePath is absent', async () => {
      storeState.workspaces = [{ id: 'ws-n4', repositoryPath: '/repos/proj' }];
      mockNarrowingDaemon([{ path: 'src/a.ts', hunks: [HUNK] }]);

      const promise = batchedGitDiff('ws-n4', true, '/repos/proj/src/a.ts');
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toMatchObject({ file: 'src/a.ts', chunks: [HUNK] });
      const diffCalls = mockedRequest.mock.calls.filter(([method]) => method === 'git.diffs');
      expect(diffCalls).toEqual([
        ['git.diffs', { workspaceId: 'ws-n4', staged: true, paths: ['src/a.ts'] }],
      ]);
    });
  });

  describe('suspicious-path recovery (mis-normalized request paths)', () => {
    it('recovers an absolute request path via exactly one full-tree git.diffs read', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockNarrowingDaemon([{ path: 'src/a.ts', hunks: [HUNK] }]);

      const promise = batchedGitDiff('ws-r1', false, '/repo/src/a.ts');
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toEqual({
        file: 'src/a.ts',
        chunks: [HUNK],
        oldContent: 'show:src/a.ts',
        newContent: 'read:src/a.ts',
      });
      const diffCalls = mockedRequest.mock.calls.filter(([method]) => method === 'git.diffs');
      expect(diffCalls).toEqual([
        ['git.diffs', { workspaceId: 'ws-r1', paths: ['/repo/src/a.ts'] }],
        ['git.diffs', { workspaceId: 'ws-r1' }],
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('/repo/src/a.ts'),
        expect.anything(),
      );
      warnSpy.mockRestore();
    });

    it('keeps staged: true on the staged recovery read', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockNarrowingDaemon([{ path: 'src/a.ts', hunks: [HUNK] }]);

      const promise = batchedGitDiff('ws-r2', true, '/repo/src/a.ts');
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toMatchObject({ file: 'src/a.ts', chunks: [HUNK] });
      const diffCalls = mockedRequest.mock.calls.filter(([method]) => method === 'git.diffs');
      expect(diffCalls).toEqual([
        ['git.diffs', { workspaceId: 'ws-r2', staged: true, paths: ['/repo/src/a.ts'] }],
        ['git.diffs', { workspaceId: 'ws-r2', staged: true }],
      ]);
      vi.mocked(console.warn).mockRestore();
    });

    it('mixed group: matched relative path is unaffected, one recovery call total, warn logged', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockNarrowingDaemon([
        { path: 'b.ts', hunks: [] },
        { path: 'src/a.ts', hunks: [HUNK] },
      ]);

      const aPromise = batchedGitDiff('ws-r3', false, '/repo/src/a.ts');
      const bPromise = batchedGitDiff('ws-r3', false, 'b.ts');
      await vi.runAllTimersAsync();

      await expect(bPromise).resolves.toEqual({
        file: 'b.ts',
        chunks: [],
        oldContent: 'show:b.ts',
        newContent: 'read:b.ts',
      });
      await expect(aPromise).resolves.toEqual({
        file: 'src/a.ts',
        chunks: [HUNK],
        oldContent: 'show:src/a.ts',
        newContent: 'read:src/a.ts',
      });
      const diffCalls = mockedRequest.mock.calls.filter(([method]) => method === 'git.diffs');
      expect(diffCalls).toEqual([
        ['git.diffs', { workspaceId: 'ws-r3', paths: ['/repo/src/a.ts', 'b.ts'] }],
        ['git.diffs', { workspaceId: 'ws-r3' }],
      ]);
      // The matched chunk is enriched exactly once (no double-enrich from recovery).
      expect(
        mockedRequest.mock.calls.filter(
          ([method, params]) =>
            method === 'file.read' && (params as { path?: string })?.path === 'b.ts',
        ),
      ).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('/repo/src/a.ts'),
        expect.anything(),
      );
      warnSpy.mockRestore();
    });

    it('a failed recovery read resolves the suspicious path undefined without rejecting the group', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockedRequest.mockImplementation(async (method: string, params?: unknown) => {
        const p = (params ?? {}) as Record<string, unknown>;
        if (method === 'git.diffs') {
          if (Array.isArray(p.paths)) return [{ path: 'b.ts', hunks: [HUNK] }];
          throw new Error('recovery boom');
        }
        if (method === 'git.showFile') return { content: '' };
        if (method === 'file.read') return { content: '' };
        throw new Error(`unexpected method: ${method}`);
      });

      const aPromise = batchedGitDiff('ws-r4', false, '/repo/src/a.ts');
      const bPromise = batchedGitDiff('ws-r4', false, 'b.ts');
      await vi.runAllTimersAsync();

      await expect(aPromise).resolves.toBeUndefined();
      await expect(bPromise).resolves.toMatchObject({ file: 'b.ts', chunks: [HUNK] });
      warnSpy.mockRestore();
    });

    it('treats home-relative, Windows drive, and UNC paths as suspicious', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockNarrowingDaemon([
        { path: 'src/a.ts', hunks: [HUNK] },
        { path: 'src/b.ts', hunks: [] },
        { path: 'src/c.ts', hunks: [] },
      ]);

      const aPromise = batchedGitDiff('ws-r5', false, '~/repo/src/a.ts');
      const bPromise = batchedGitDiff('ws-r5', false, 'C:/repo/src/b.ts');
      const cPromise = batchedGitDiff('ws-r5', false, '\\\\server\\repo/src/c.ts');
      await vi.runAllTimersAsync();

      await expect(aPromise).resolves.toMatchObject({ file: 'src/a.ts' });
      await expect(bPromise).resolves.toMatchObject({ file: 'src/b.ts' });
      await expect(cPromise).resolves.toMatchObject({ file: 'src/c.ts' });
      expect(
        mockedRequest.mock.calls.filter(([method]) => method === 'git.diffs'),
      ).toHaveLength(2);
      vi.mocked(console.warn).mockRestore();
    });

    it('shares one in-flight full-tree recovery read across concurrent groups', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let resolveFullTree!: (chunks: unknown[]) => void;
      const fullTreeGate = new Promise<unknown[]>((resolve) => {
        resolveFullTree = resolve;
      });
      let fullTreeCalls = 0;
      mockedRequest.mockImplementation(async (method: string, params?: unknown) => {
        const p = (params ?? {}) as Record<string, unknown>;
        if (method === 'git.diffs') {
          if (Array.isArray(p.paths)) return [];
          fullTreeCalls += 1;
          return fullTreeGate;
        }
        if (method === 'git.showFile') return { content: '' };
        if (method === 'file.read') return { content: '' };
        throw new Error(`unexpected method: ${method}`);
      });

      // Group 1 flushes and parks on the (gated) full-tree recovery read…
      const first = batchedGitDiff('ws-sf', false, '/elsewhere/a.ts');
      await vi.runAllTimersAsync();
      // …then group 2 flushes while that read is still in flight and joins it.
      const second = batchedGitDiff('ws-sf', false, '/elsewhere/b.ts');
      await vi.runAllTimersAsync();

      resolveFullTree([
        { path: 'a.ts', hunks: [HUNK] },
        { path: 'b.ts', hunks: [] },
      ]);

      await expect(first).resolves.toMatchObject({ file: 'a.ts', chunks: [HUNK] });
      await expect(second).resolves.toMatchObject({ file: 'b.ts', chunks: [] });
      expect(fullTreeCalls).toBe(1);
      const diffCalls = mockedRequest.mock.calls.filter(([method]) => method === 'git.diffs');
      expect(diffCalls).toEqual([
        ['git.diffs', { workspaceId: 'ws-sf', paths: ['/elsewhere/a.ts'] }],
        ['git.diffs', { workspaceId: 'ws-sf' }],
        ['git.diffs', { workspaceId: 'ws-sf', paths: ['/elsewhere/b.ts'] }],
      ]);
      warnSpy.mockRestore();
    });
  });
});
