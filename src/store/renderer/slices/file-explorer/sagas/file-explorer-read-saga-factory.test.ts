import { runSaga, stdChannel } from 'redux-saga';
import { select } from 'typed-redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileNode } from '$shared/types';
import { createFileListDirectory } from '$lib/client/live/backend-file-list-directory';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { projectFileExplorerState, projectFlattenedNodes } from '../file-explorer-projections';
import type { FileExplorerState } from '../file-explorer-types';
import {
  directoryReadSettled,
  directoryReadStarted,
  expandAllRequested,
  fileExplorerReducer,
  fileSearchRequested,
  initialState,
  initializeFileExplorer,
  refreshDirectoryRequested,
  refreshFileExplorer,
  retireFileExplorer,
  setChildrenAtPathAction,
  setFileExplorerWorkspacePath,
  setRootNode,
  toggleDirectoryRequested,
} from '../file-explorer-slice';
import { createFileExplorerReadSaga } from './file-explorer-read-saga-factory';

const workspaceStateForTest = {
  *effect(wsId: string) {
    return yield* select((state: { fileExplorer: FileExplorerState }) =>
      projectFileExplorerState(state.fileExplorer, wsId),
    );
  },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function harness(request = vi.fn().mockResolvedValue([]), admitted = true, bounded = true) {
  const channel = stdChannel();
  let state = initialState;
  let context: string | null = 'backend:principal:epoch1:/repo';
  const actions: Parameters<typeof fileExplorerReducer>[1][] = [];
  const dispatch = (action: Parameters<typeof fileExplorerReducer>[1]) => {
    actions.push(action);
    state = fileExplorerReducer(state, action);
    channel.put(action);
  };
  const listDirectory = createFileListDirectory(request, { strict: true });
  const files = {
    listDirectory,
    async explorerTree(wsId: string, isCurrent?: () => boolean): Promise<FileNode> {
      return {
        name: '',
        path: '',
        type: 'directory',
        children: await listDirectory(wsId, '', isCurrent),
      };
    },
  };
  const saga = createFileExplorerReadSaga({
    files,
    selectFileExplorerState: workspaceStateForTest,
    compactChains: false,
    bounded,
    ...(admitted ? { admission: { readCurrentContext: () => context, dispatch } } : {}),
  });
  const task = runSaga({ channel, dispatch, getState: () => ({ fileExplorer: state }) }, saga);
  cleanups.push(async () => {
    task.cancel();
    await task.toPromise();
  });
  return {
    dispatch,
    request,
    task,
    actions,
    state: () => state,
    ws: () => projectFileExplorerState(state, 'ws'),
    context: (value: string | null) => {
      context = value;
    },
  };
}
const directory = (name: string) => ({ name, type: 'directory' });
const file = (name: string) => ({ name, type: 'file' });
const root = {
  name: 'repo',
  path: '/repo',
  type: 'directory' as const,
  children: [{ name: 'src', path: '/repo/src', type: 'directory' as const }],
};

async function initialize(h: ReturnType<typeof harness>) {
  h.dispatch(initializeFileExplorer('ws', { workspacePath: '/repo' }));
  await vi.waitFor(() => expect(h.ws().isLoading).toBe(false));
}

describe('shared bounded file explorer read owner', () => {
  it.each([true, false])(
    'refreshes during initial loading without adopting the retired first result (bounded=%s)',
    async (bounded) => {
      const first = deferred<unknown>();
      const request = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValue([file('fresh.txt')]);
      const h = harness(request, bounded, bounded);
      h.dispatch(initializeFileExplorer('ws', { workspacePath: '/repo' }));
      expect(h.ws().isLoading).toBe(true);
      h.dispatch(refreshFileExplorer('ws'));
      await vi.waitFor(() => expect(getItem(h.ws().nodes, '/repo/fresh.txt')).toBeDefined());
      first.resolve([file('retired.txt')]);
      await first.promise;
      expect(getItem(h.ws().nodes, '/repo/retired.txt')).toBeUndefined();
      expect(h.ws().isLoading).toBe(false);
    },
  );

  it('shares canonical sorting, lazy expansion, collapse and pure projection without a recursive scan', async () => {
    const h = harness(
      vi
        .fn()
        .mockResolvedValueOnce([file('z.txt'), directory('src'), file('a.txt')])
        .mockResolvedValueOnce([directory('nested')]),
    );
    await initialize(h);
    expect(projectFlattenedNodes(h.ws(), false).map((row) => row.node.name)).toEqual([
      'src',
      'a.txt',
      'z.txt',
    ]);
    h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
    await vi.waitFor(() => expect(h.ws().loadingPaths).toEqual([]));
    expect(h.request.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['file.list', { workspaceId: 'ws', path: '' }],
      ['file.list', { workspaceId: 'ws', path: 'src' }],
    ]);
    expect(projectFlattenedNodes(h.ws(), false).map((row) => [row.node.name, row.depth])).toEqual([
      ['src', 0],
      ['nested', 1],
      ['a.txt', 0],
      ['z.txt', 0],
    ]);
    h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
    h.dispatch(expandAllRequested('ws'));
    expect(projectFlattenedNodes(h.ws(), false).map((row) => row.node.name)).toEqual([
      'src',
      'a.txt',
      'z.txt',
    ]);
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it.each(['reopen', 'whole-refresh', 'targeted-refresh'] as const)(
    'restores already-expanded descendants in parent-first order after %s',
    async (trigger) => {
      let filename = 'old.txt';
      const request = vi.fn().mockImplementation(async (_method, params) => {
        if (params.path === '') return [directory('src')];
        if (params.path === 'src') return [directory('nested'), directory('unopened')];
        if (params.path === 'src/nested') return [file(filename)];
        throw new Error('Unexpected read of unopened directory');
      });
      const h = harness(request);
      await initialize(h);
      h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
      await vi.waitFor(() => expect(getItem(h.ws().nodes, '/repo/src/nested')).toBeDefined());
      h.dispatch(toggleDirectoryRequested('ws', '/repo/src/nested'));
      await vi.waitFor(() =>
        expect(getItem(h.ws().nodes, '/repo/src/nested/old.txt')).toBeDefined(),
      );
      h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
      if (trigger !== 'reopen') {
        h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
        await vi.waitFor(() => expect(h.ws().loadingPaths).toEqual([]));
        expect(getItem(h.ws().nodes, '/repo/src/nested/old.txt')).toBeDefined();
      }
      filename = 'fresh.txt';
      request.mockClear();
      if (trigger === 'reopen') h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
      else if (trigger === 'whole-refresh') h.dispatch(refreshFileExplorer('ws'));
      else h.dispatch(refreshDirectoryRequested('ws', '/repo/src/changed.txt'));
      await vi.waitFor(() =>
        expect(projectFlattenedNodes(h.ws(), false).map((row) => row.node.path)).toContain(
          '/repo/src/nested/fresh.txt',
        ),
      );
      expect(getItem(h.ws().nodes, '/repo/src/nested/old.txt')).toBeUndefined();
      expect(request.mock.calls.map((call) => call[1].path)).toEqual(
        trigger === 'whole-refresh' ? ['', 'src', 'src/nested'] : ['src', 'src/nested'],
      );
    },
  );

  it('does not restore descendants hidden beneath a collapsed branch or removed by the new listing', async () => {
    let removed = false;
    const request = vi.fn().mockImplementation(async (_method, params) => {
      if (params.path === '') return [directory('src')];
      if (params.path === 'src') return removed ? [] : [directory('middle')];
      if (params.path === 'src/middle') return [directory('deep')];
      if (params.path === 'src/middle/deep') return [file('deep.txt')];
      throw new Error('Unexpected directory');
    });
    const h = harness(request);
    await initialize(h);
    for (const path of ['/repo/src', '/repo/src/middle', '/repo/src/middle/deep']) {
      h.dispatch(toggleDirectoryRequested('ws', path));
      await vi.waitFor(() => expect(h.ws().loadingPaths).toEqual([]));
    }
    h.dispatch(toggleDirectoryRequested('ws', '/repo/src/middle'));
    h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
    request.mockClear();
    h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
    await vi.waitFor(() => expect(h.ws().loadingPaths).toEqual([]));
    expect(request.mock.calls.map((call) => call[1].path)).toEqual(['src']);
    expect(h.ws().expandedPaths).toContain('/repo/src/middle/deep');
    h.dispatch(toggleDirectoryRequested('ws', '/repo/src/middle'));
    await vi.waitFor(() =>
      expect(getItem(h.ws().nodes, '/repo/src/middle/deep/deep.txt')).toBeDefined(),
    );
    removed = true;
    request.mockClear();
    h.dispatch(refreshDirectoryRequested('ws', '/repo/src/changed'));
    await vi.waitFor(() => expect(h.ws().loadingPaths).toEqual([]));
    expect(request.mock.calls.map((call) => call[1].path)).toEqual(['src']);
    expect(getItem(h.ws().nodes, '/repo/src/middle')).toBeUndefined();
  });

  it('retains an empty success separately from a directory failure and retries only its parent', async () => {
    const h = harness(
      vi
        .fn()
        .mockResolvedValueOnce([directory('src')])
        .mockRejectedValueOnce(new Error('denied'))
        .mockResolvedValueOnce([]),
    );
    await initialize(h);
    h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
    await vi.waitFor(() => expect(h.ws().directoryErrors['/repo/src']).toBe('denied'));
    expect(h.ws().loadingPaths).toEqual([]);
    h.dispatch(refreshDirectoryRequested('ws', '/repo/src/a.txt'));
    await vi.waitFor(() => expect(h.ws().directoryErrors).toEqual({}));
    expect(getItem(h.ws().nodes, '/repo/src')?.children).toEqual([]);
    expect(h.request.mock.calls.map((call) => call[1])).toEqual([
      { workspaceId: 'ws', path: '' },
      { workspaceId: 'ws', path: 'src' },
      { workspaceId: 'ws', path: 'src' },
    ]);
  });

  it('retries a failed expanded directory during bounded whole refresh', async () => {
    const h = harness(
      vi
        .fn()
        .mockResolvedValueOnce([directory('src')])
        .mockRejectedValueOnce(new Error('denied'))
        .mockResolvedValueOnce([directory('src')])
        .mockResolvedValueOnce([file('recovered')]),
    );
    await initialize(h);
    h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
    await vi.waitFor(() => expect(h.ws().directoryErrors['/repo/src']).toBe('denied'));
    h.dispatch(refreshFileExplorer('ws'));
    await vi.waitFor(() => expect(getItem(h.ws().nodes, '/repo/src/recovered')).toBeDefined());
    expect(h.ws().directoryErrors).toEqual({});
  });

  it('retries an initial root failure through the ordinary refresh action', async () => {
    const h = harness(
      vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce([file('recovered')]),
    );
    await initialize(h);
    expect(h.ws().error).toBe('offline');
    expect(h.ws().rootPath).toBeNull();
    h.dispatch(refreshFileExplorer('ws'));
    await vi.waitFor(() => expect(h.ws().rootPath).toBe('/repo'));
    expect(h.ws().error).toBeNull();
  });

  it('retains existing root rows on refresh failure and clears the root error after retry', async () => {
    const h = harness(
      vi
        .fn()
        .mockResolvedValueOnce([file('kept')])
        .mockRejectedValueOnce(new Error('unavailable'))
        .mockResolvedValueOnce([]),
    );
    await initialize(h);
    h.dispatch(refreshFileExplorer('ws'));
    await vi.waitFor(() => expect(h.ws().error).toBe('unavailable'));
    expect(projectFlattenedNodes(h.ws(), false).map((row) => row.node.name)).toEqual(['kept']);
    expect(h.ws().directoryErrors).toEqual({});
    h.dispatch(refreshFileExplorer('ws'));
    await vi.waitFor(() => expect(projectFlattenedNodes(h.ws(), false)).toEqual([]));
    expect(h.ws().error).toBeNull();
  });

  it.each(['principal', 'backend', 'root'])(
    'drops held replies when the %s read context changes, even without a channel notice',
    async (replacement) => {
      const pending = deferred<unknown[]>();
      const h = harness(vi.fn().mockReturnValue(pending.promise));
      h.dispatch(initializeFileExplorer('ws', { workspacePath: '/repo' }));
      h.context(replacement);
      const before = h.state();
      const guard = h.request.mock.calls[0][2].onDispatch;
      expect(() => guard()).toThrow('retired');
      pending.resolve([file('stale')]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(h.state()).toBe(before);
      expect(h.ws().nodes.ids).toEqual([]);
    },
  );

  it('retires only the explorer, cancels held reads, and permits an immediate same-root restart', async () => {
    const stale = deferred<unknown[]>();
    const h = harness(
      vi
        .fn()
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValueOnce([file('fresh')]),
    );
    h.dispatch(fileSearchRequested('ws', 'search', 'request', 'keep'));
    h.dispatch(initializeFileExplorer('ws', { workspacePath: '/repo' }));
    h.dispatch(retireFileExplorer('ws'));
    h.dispatch(initializeFileExplorer('ws', { workspacePath: '/repo' }));
    await vi.waitFor(() => expect(h.ws().rootPath).toBe('/repo'));
    stale.resolve([file('stale')]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(projectFlattenedNodes(h.ws(), false).map((row) => row.node.name)).toEqual(['fresh']);
    expect(getItem(h.state().searches, 'search')?.requestId).toBe('request');
  });

  it('cancels a held initialization on a changed root and reads the replacement root', async () => {
    const stale = deferred<unknown[]>();
    const h = harness(
      vi
        .fn()
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValueOnce([file('fresh')]),
      false,
    );
    h.dispatch(initializeFileExplorer('ws', { workspacePath: '/repo' }));
    h.dispatch(initializeFileExplorer('ws', { workspacePath: '/new' }));
    await vi.waitFor(() => expect(h.ws().rootPath).toBe('/new'));
    stale.resolve([file('stale')]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(h.ws().nodes.ids).toContain('/new/fresh');
    expect(h.ws().nodes.ids).not.toContain('/repo/stale');
  });

  it('prevents a pending expansion from resurrecting children after refresh', async () => {
    const old = deferred<unknown[]>();
    const h = harness(
      vi
        .fn()
        .mockResolvedValueOnce([directory('src')])
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce([directory('src')])
        .mockResolvedValueOnce([file('new')]),
    );
    await initialize(h);
    h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
    h.dispatch(refreshFileExplorer('ws'));
    await vi.waitFor(() => expect(getItem(h.ws().nodes, '/repo/src/new')).toBeDefined());
    old.resolve([file('old')]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(getItem(h.ws().nodes, '/repo/src')?.children).toEqual(['/repo/src/new']);
    expect(h.ws().directoryRequests).toEqual({});
    expect(h.ws().loadingPaths).toEqual([]);
  });

  it('collapses an in-flight directory and ignores its late response', async () => {
    const pending = deferred<unknown[]>();
    const h = harness(
      vi
        .fn()
        .mockResolvedValueOnce([directory('src')])
        .mockReturnValueOnce(pending.promise),
    );
    await initialize(h);
    h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
    expect(h.ws().loadingPaths).toEqual(['/repo/src']);
    h.dispatch(toggleDirectoryRequested('ws', '/repo/src'));
    expect(h.ws().expandedPaths).not.toContain('/repo/src');
    expect(h.ws().loadingPaths).toEqual([]);
    pending.resolve([file('late')]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(getItem(h.ws().nodes, '/repo/src/late')).toBeUndefined();
  });

  it('coalesces a burst of directory notifications into one trailing read', async () => {
    const pending = deferred<unknown[]>();
    const h = harness(
      vi
        .fn()
        .mockResolvedValueOnce([directory('src')])
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce([file('final')]),
    );
    await initialize(h);
    for (const name of ['one', 'two', 'three'])
      h.dispatch(refreshDirectoryRequested('ws', `/repo/src/${name}`));
    expect(h.request).toHaveBeenCalledTimes(2);
    pending.resolve([]);
    await vi.waitFor(() => expect(getItem(h.ws().nodes, '/repo/src/final')).toBeDefined());
    expect(h.request).toHaveBeenCalledTimes(3);
  });

  it('never publishes after owner cancellation or starts requests without admission', async () => {
    const pending = deferred<unknown[]>();
    const h = harness(vi.fn().mockReturnValue(pending.promise));
    h.context(null);
    h.dispatch(initializeFileExplorer('ws', { workspacePath: '/repo' }));
    expect(h.request).not.toHaveBeenCalled();
    h.context('allowed');
    h.dispatch(initializeFileExplorer('ws', { workspacePath: '/repo' }));
    h.task.cancel();
    const before = h.state();
    pending.resolve([file('late')]);
    await h.task.toPromise();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(h.state()).toBe(before);
  });
});

describe('correlated canonical directory state', () => {
  it('ignores late success/failure and retired completions by reference', () => {
    let state = fileExplorerReducer(undefined, setFileExplorerWorkspacePath('ws', '/repo'));
    state = fileExplorerReducer(state, setRootNode('ws', root));
    state = fileExplorerReducer(state, directoryReadStarted('ws', '/repo/src', 'old'));
    state = fileExplorerReducer(state, directoryReadStarted('ws', '/repo/src', 'new'));
    expect(
      fileExplorerReducer(
        state,
        setChildrenAtPathAction(
          'ws',
          '/repo/src',
          [{ name: 'late', path: '/repo/src/late', type: 'file' }],
          'old',
        ),
      ),
    ).toBe(state);
    expect(fileExplorerReducer(state, directoryReadSettled('ws', '/repo/src', 'old', 'late'))).toBe(
      state,
    );
    state = fileExplorerReducer(state, directoryReadSettled('ws', '/repo/src', 'new', 'denied'));
    expect(projectFileExplorerState(state, 'ws').directoryErrors).toEqual({
      '/repo/src': 'denied',
    });
    const serialized = structuredClone(state);
    expect(serialized).toEqual(state);
    state = fileExplorerReducer(state, retireFileExplorer('ws'));
    expect(fileExplorerReducer(state, directoryReadSettled('ws', '/repo/src', 'new', null))).toBe(
      state,
    );
    expect(fileExplorerReducer(state, retireFileExplorer('ws'))).toBe(state);
  });

  it('removes correlation and loading for descendants removed by a parent refresh', () => {
    let state = fileExplorerReducer(undefined, setRootNode('ws', root));
    state = fileExplorerReducer(state, directoryReadStarted('ws', '/repo/src', 'r'));
    state = fileExplorerReducer(state, setChildrenAtPathAction('ws', '/repo', []));
    expect(projectFileExplorerState(state, 'ws').directoryRequests).toEqual({});
    expect(
      fileExplorerReducer(
        state,
        setChildrenAtPathAction(
          'ws',
          '/repo/src',
          [{ name: 'late', path: '/repo/src/late', type: 'file' }],
          'r',
        ),
      ),
    ).toBe(state);
  });
});
