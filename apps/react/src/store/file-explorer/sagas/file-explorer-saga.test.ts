import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '@/store';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { selectDesktopLayout } from '@/store/desktop/desktop-selectors';
import { fileExplorerSaga } from './file-explorer-saga';
import { observeDesktopFileTreeRetirement } from './desktop-file-tree-lifetime';
import { openWorkspaceTab } from '../../../../../../src/store/renderer/slices/tab-state/tab-state-slice';
import {
  selectFileExplorerContext,
  selectFileExplorerRows,
  selectFileExplorerState,
  selectFileSearch,
  selectDesktopFileExplorerRows,
  selectDesktopFileExplorerGitStatus,
  selectDesktopFileExplorerSelectedPath,
} from '../file-explorer-selectors';
import {
  clearExpandedPathsExceptRoot,
  expandAllRequested,
  expandToPathRequested,
  fileSearchOpened,
  fileSearchReleased,
  fileSearchRequested,
  initializeFileExplorer,
  refreshFileExplorer,
  retireFileExplorer,
  toggleDirectoryRequested,
} from '../../../../../../src/store/renderer/slices/file-explorer/file-explorer-slice';
import { createFileExplorerReadSaga } from '../../../../../../src/store/renderer/slices/file-explorer/sagas/file-explorer-read-saga-factory';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
  backendReconnected,
} from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  principalContextChanged,
  principalReceived,
} from '../../../../../../src/store/renderer/slices/principal/principal-slice';
import { setGitStatus } from '../../../../../../src/store/renderer/slices/git/git-slice';
import {
  resetLayout,
  openTab,
  splitPanel,
  focusPanel,
} from '../../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import { createAdmittedLegacyPrincipal } from '../../../../../../src/test/fixtures/admitted-legacy-principal';
import { GitFileStatus, type Workspace, type GitStatus, type FileNode } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/features/backend/backend-transport', () => ({ backendRequest: request }));
vi.mock('../../../../../../src/store/renderer/store', () => {
  throw new Error('Desktop tree must not construct the Svelte Store');
});

const ws = WorkspaceId('desktop-tree');
const root = '/owned/repo';
const directory = (name: string) => ({ name, type: 'directory' });
const file = (name: string) => ({ name, type: 'file' });
let listings: Record<string, unknown>;
let dispose: () => void;
let stop: () => void;
const stopObservers: Array<() => void> = [];
function state() {
  return selectFileExplorerState.select(store.state, ws);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function start(mode?: 'browser' | 'desktop') {
  stop = store.runSaga(function* () {
    yield* fileExplorerSaga(mode);
  });
}
async function initialize(path = root) {
  store.dispatch(initializeFileExplorer(ws, { workspacePath: path }));
  await vi.waitFor(() => expect(state().isInitialized).toBe(true));
}
async function expand(path = 'src') {
  store.dispatch(toggleDirectoryRequested(ws, `${root}/${path}`));
  await vi.waitFor(() => expect(state().loadingPaths).toEqual([]));
}
function wireCalls() {
  return request.mock.calls.map(([method, params]) => [method, params]);
}

beforeEach(() => {
  dispose = store.init(createAdmittedLegacyPrincipal());
  stop = () => undefined;
  store.dispatch(setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: root } as Workspace));
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  listings = {
    '': [file('z.txt'), directory('src'), directory('empty'), directory('.git')],
    src: [directory('nested')],
    'src/nested': [file('a.txt')],
    empty: [],
    '.git': [],
  };
  request.mockReset().mockImplementation(async (method, params, options) => {
    options?.onDispatch?.();
    if (method === 'file.list') {
      if (!(params.path in listings)) throw new Error(`Unexpected directory ${params.path}`);
      return listings[params.path];
    }
    if (method === 'search.fileNames')
      return {
        files: ['src/nested/a.txt', 'z.txt'],
        requestId: 'daemon-search',
        truncated: false,
      };
    throw new Error(`Unexpected request ${method}`);
  });
});
afterEach(() => {
  for (const stopObserver of stopObservers.splice(0)) stopObserver();
  stop();
  dispose();
  vi.useRealTimers();
});

describe('desktop binding of the canonical file explorer', () => {
  it('initializes shallowly, then reads only an explicitly opened compact chain', async () => {
    start('desktop');
    await initialize();
    expect(wireCalls()).toEqual([['file.list', { workspaceId: ws, path: '' }]]);
    expect(
      selectDesktopFileExplorerRows.select(store.state, ws).map((row) => row.node.name),
    ).toEqual(['.git', 'empty', 'src', 'z.txt']);
    await expand();
    expect(wireCalls()).toEqual([
      ['file.list', { workspaceId: ws, path: '' }],
      ['file.list', { workspaceId: ws, path: 'src' }],
      ['file.list', { workspaceId: ws, path: 'src/nested' }],
    ]);
    expect(
      selectDesktopFileExplorerRows
        .select(store.state, ws)
        .map((row) => [row.node.path, row.displayPath, row.depth]),
    ).toEqual([
      [`${root}/.git`, undefined, 0],
      [`${root}/empty`, undefined, 0],
      [`${root}/src/nested`, 'src/nested', 0],
      [`${root}/src/nested/a.txt`, undefined, 1],
      [`${root}/z.txt`, undefined, 0],
    ]);
    const tree = state();
    await initialize(); // A parked card's return initializes the same canonical owner.
    expect(state()).toBe(tree);
    expect(request).toHaveBeenCalledTimes(3);
    store.dispatch(clearExpandedPathsExceptRoot(ws));
    expect(
      selectDesktopFileExplorerRows
        .select(store.state, ws)
        .some((row) => row.node.name === 'a.txt'),
    ).toBe(false);
    await expand('src/nested');
    expect(
      selectDesktopFileExplorerRows
        .select(store.state, ws)
        .some((row) => row.node.name === 'a.txt'),
    ).toBe(true);
  });

  it('retains browser defaults and ignores automatic ancestor/full expansion in browser mode', async () => {
    start();
    await initialize();
    await expand();
    store.dispatch(expandAllRequested(ws));
    store.dispatch(expandToPathRequested(ws, `${root}/src/nested/a.txt`));
    expect(request.mock.calls.map(([, params]) => params.path)).toEqual(['', 'src']);
    expect(
      selectFileExplorerRows.select(store.state, ws).map((row) => [row.node.name, row.depth]),
    ).toEqual([
      ['.git', 0],
      ['empty', 0],
      ['src', 0],
      ['nested', 1],
      ['z.txt', 0],
    ]);
  });

  it.each(['ancestors', 'all'] as const)(
    'allows explicit desktop %s expansion',
    async (operation) => {
      start('desktop');
      await initialize();
      store.dispatch(
        operation === 'all'
          ? expandAllRequested(ws)
          : expandToPathRequested(ws, `${root}/src/nested/a.txt`),
      );
      await vi.waitFor(() =>
        expect(getItem(state().nodes, `${root}/src/nested/a.txt`)).toBeDefined(),
      );
      expect(state().isBulkOperation).toBe(false);
      expect(state().expandedPaths).toContain(`${root}/src/nested`);
      expect(request.mock.calls.map(([, params]) => params.path)).toEqual(
        operation === 'all'
          ? ['', '.git', 'empty', 'src', 'src/nested']
          : ['', 'src', 'src/nested'],
      );
    },
  );

  it('refreshes previously expanded directories and coalesces a refresh burst', async () => {
    start('desktop');
    await initialize();
    await expand();
    const pending = deferred<unknown>();
    request.mockReturnValueOnce(pending.promise);
    store.dispatch(refreshFileExplorer(ws));
    store.dispatch(refreshFileExplorer(ws));
    store.dispatch(refreshFileExplorer(ws));
    listings['src/nested'] = [file('fresh.txt')];
    pending.resolve(listings['']);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(9));
    await vi.waitFor(() => expect(state().isLoading).toBe(false));
    expect(request.mock.calls.map(([, params]) => params.path)).toEqual([
      '',
      'src',
      'src/nested',
      '',
      'src',
      'src/nested',
      '',
      'src',
      'src/nested',
    ]);
    expect(state().expandedPaths).toContain(`${root}/src/nested`);
    expect(getItem(state().nodes, `${root}/src/nested/fresh.txt`)).toBeDefined();
    expect(getItem(state().nodes, `${root}/src/nested/a.txt`)).toBeUndefined();
  });

  it.each(['root', 'authority', 'reconnect', 'workspace', 'retire', 'stop'] as const)(
    'fences a pending read after %s retirement',
    async (reason) => {
      start('desktop');
      await initialize();
      const pending = deferred<unknown>();
      request.mockReturnValueOnce(pending.promise);
      store.dispatch(toggleDirectoryRequested(ws, `${root}/src`));
      const guard = request.mock.calls.at(-1)![2].onDispatch;
      if (reason === 'root')
        store.dispatch(
          setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/other' } as Workspace),
        );
      if (reason === 'authority') store.dispatch(principalContextChanged('retired'));
      if (reason === 'reconnect') store.dispatch(backendReconnected());
      if (reason === 'workspace') store.dispatch(workspaceUnmounted(ws));
      if (reason === 'retire') store.dispatch(retireFileExplorer(ws));
      if (reason === 'stop') stop();
      expect(() => guard()).toThrow('retired');
      pending.resolve([directory('late')]);
      await pending.promise;
      await Promise.resolve();
      expect(getItem(state().nodes, `${root}/src/late`)).toBeUndefined();
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it('starts a new same-root owner after retirement without admitting its predecessor', async () => {
    start('desktop');
    const pending = deferred<unknown>();
    request.mockReturnValueOnce(pending.promise);
    store.dispatch(initializeFileExplorer(ws, { workspacePath: root }));
    store.dispatch(retireFileExplorer(ws));
    await initialize();
    pending.resolve([file('late.txt')]);
    await pending.promise;
    expect(getItem(state().nodes, `${root}/late.txt`)).toBeUndefined();
    expect(getItem(state().nodes, `${root}/z.txt`)).toBeDefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('preserves source factory defaults without registering a browser owner', async () => {
    const files = {
      explorerTree: vi.fn().mockResolvedValue({
        name: '',
        path: '',
        type: 'directory',
        children: [{ name: 'src', path: 'src', type: 'directory' }],
      } satisfies FileNode),
      listDirectory: vi.fn().mockImplementation(async (_ws, path) =>
        (listings[path] as Array<{ name: string; type: string }>).map((node) => ({
          ...node,
          path: node.name,
        })),
      ),
    };
    stop = store.runSaga(createFileExplorerReadSaga({ files, selectFileExplorerState }));
    await initialize();
    await expand();
    expect(files.listDirectory.mock.calls).toEqual([
      [ws, 'src'],
      [ws, 'src/nested'],
    ]);
    expect(request).not.toHaveBeenCalled();
    expect(getItem(state().nodes, `${root}/src/nested/a.txt`)).toBeDefined();
  });

  it('uses one bounded filename-search watcher and retires old consumer replies', async () => {
    vi.useFakeTimers();
    start('desktop');
    const context = selectFileExplorerContext.select(store.state, ws)!;
    store.dispatch(fileSearchOpened(ws, 'finder', context));
    store.dispatch(fileSearchRequested(ws, 'finder', 'request-1', 'a', context));
    await vi.advanceTimersByTimeAsync(50);
    expect(wireCalls()).toEqual([
      ['search.fileNames', { workspaceId: ws, pattern: 'a', limit: 100 }],
    ]);
    expect(selectFileSearch.select(store.state, ws, 'finder')).toMatchObject({
      paths: ['src/nested/a.txt', 'z.txt'],
      settled: true,
    });
    const pending = deferred<unknown>();
    request.mockReturnValueOnce(pending.promise);
    store.dispatch(fileSearchRequested(ws, 'finder', 'request-2', 'late', context));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(fileSearchReleased(ws, 'finder'));
    store.dispatch(fileSearchOpened(ws, 'finder', context));
    pending.resolve({ files: ['late.txt'], requestId: 'late', truncated: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(selectFileSearch.select(store.state, ws, 'finder')?.paths).toEqual([]);
    store.dispatch(fileSearchRequested(ws, 'finder', 'blank', '  ', context));
    await vi.advanceTimersByTimeAsync(50);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('derives changed rows and compact-directory rollups from canonical Git status', async () => {
    start('desktop');
    await initialize();
    await expand();
    const status: GitStatus = {
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      hasUncommittedChanges: true,
      hasUntrackedFiles: true,
      files: [
        { path: 'src/nested/a.txt', status: GitFileStatus.Modified, staged: true },
        { path: 'z.txt', status: GitFileStatus.Untracked, staged: false },
      ],
    };
    store.dispatch(setGitStatus(ws, status));
    expect(selectDesktopFileExplorerGitStatus.select(store.state, ws)).toEqual({
      'src/nested/a.txt': { status: 'M ' },
      'z.txt': { status: '??' },
    });
    expect(
      selectDesktopFileExplorerRows.select(store.state, ws, true).map((row) => row.node.name),
    ).toEqual(['nested', 'a.txt', 'z.txt']);
    expect(selectDesktopFileExplorerRows.select(store.state, ws, true)[0].directoryHasChanges).toBe(
      true,
    );
    expect(state().gitStatus).toEqual({});
    store.dispatch(setGitStatus(ws, { ...status, files: [] }));
    expect(selectDesktopFileExplorerRows.select(store.state, ws, true)).toEqual([]);
    expect(request.mock.calls.every(([method]) => method === 'file.list')).toBe(true);
  });

  it('follows the focused primary-root file tab, excluding other roots and non-file tabs', () => {
    store.dispatch(resetLayout(ws));
    const panelId = selectDesktopLayout.select(store.state, ws).focusedPanelId!;
    store.dispatch(
      openTab(ws, { type: 'file', filePath: 'src/a.txt', title: 'a', closable: true }, panelId),
    );
    expect(selectDesktopFileExplorerSelectedPath.select(store.state, ws)).toBe(`${root}/src/a.txt`);
    const split = splitPanel(ws, panelId, 'horizontal');
    store.dispatch(split);
    store.dispatch(
      openTab(
        ws,
        { type: 'file', filePath: 'b.txt', title: 'b', closable: true },
        split.payload.newPanelId,
      ),
    );
    store.dispatch(focusPanel(ws, split.payload.newPanelId));
    expect(selectDesktopFileExplorerSelectedPath.select(store.state, ws)).toBe(`${root}/b.txt`);
    store.dispatch(
      openTab(
        ws,
        {
          type: 'file',
          filePath: 'b.txt',
          title: 'secondary',
          closable: true,
          data: { gitRootId: 'secondary' },
        },
        split.payload.newPanelId,
      ),
    );
    expect(selectDesktopFileExplorerSelectedPath.select(store.state, ws)).toBeNull();
    store.dispatch(
      openTab(
        ws,
        { type: 'note', noteId: 'note', title: 'note', closable: true },
        split.payload.newPanelId,
      ),
    );
    expect(selectDesktopFileExplorerSelectedPath.select(store.state, ws)).toBeNull();
    store.dispatch(focusPanel(ws, panelId));
    expect(selectDesktopFileExplorerSelectedPath.select(store.state, ws)).toBe(`${root}/src/a.txt`);
  });
});

describe('desktop tree callback and resource lifetime', () => {
  function observe(context = selectFileExplorerContext.select(store.state, ws)!) {
    const retire = vi.fn();
    stopObservers.push(
      store.runSaga(function* () {
        yield* observeDesktopFileTreeRetirement(ws, context, retire);
      }),
    );
    return retire;
  }

  it.each(['root', 'role', 'workspace', 'authority'] as const)(
    'retires %s A→B→A synchronously before a render or late response',
    async (kind) => {
      start('desktop');
      await initialize();
      store.dispatch(openWorkspaceTab(ws));
      const retire = observe();
      expect(retire).not.toHaveBeenCalled();
      const pending = deferred<unknown>();
      request.mockReturnValueOnce(pending.promise);
      store.dispatch(toggleDirectoryRequested(ws, `${root}/src`));
      const guard = request.mock.calls.at(-1)![2].onDispatch;
      if (kind === 'authority') {
        const principal = store.state.principal;
        store.dispatch(principalContextChanged('other'));
        expect(retire).toHaveBeenCalledTimes(1);
        store.dispatch(principalContextChanged(principal.context));
        store.dispatch(
          principalReceived(
            { context: principal.context!, invalidation: 0, presentationVersion: 0 },
            principal.snapshot!,
          ),
        );
      } else if (kind === 'workspace') {
        store.dispatch(workspaceUnmounted(ws));
        expect(retire).toHaveBeenCalledTimes(1);
        store.dispatch(workspaceMounted(ws));
      } else {
        store.dispatch(
          setWorkspaceEntity({
            id: ws,
            myRole: kind === 'role' ? 'collaborator' : 'owner',
            worktreePath: kind === 'root' ? '/replacement' : root,
          } as Workspace),
        );
        expect(retire).toHaveBeenCalledTimes(1);
        store.dispatch(
          setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: root } as Workspace),
        );
      }
      expect(() => guard()).toThrow('retired');
      expect(state().rootPath).toBeNull();
      await initialize();
      pending.resolve([file('late.txt')]);
      await pending.promise;
      expect(getItem(state().nodes, `${root}/src/late.txt`)).toBeUndefined();
      expect(retire).toHaveBeenCalledTimes(1);
    },
  );

  it('revokes old callbacks on parking but preserves expansion and keeps watching resource changes', async () => {
    start('desktop');
    await initialize();
    await expand();
    store.dispatch(openWorkspaceTab(ws));
    const retire = observe();
    const before = state();
    store.dispatch(openWorkspaceTab('other-workspace'));
    expect(retire).toHaveBeenCalledTimes(1);
    expect(state()).toBe(before);
    store.dispatch(openWorkspaceTab(ws));
    await initialize();
    expect(state()).toBe(before);
    expect(retire).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(3);
    store.dispatch(openWorkspaceTab('other-workspace'));
    store.dispatch(
      setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/replacement' } as Workspace),
    );
    expect(state().rootPath).toBeNull();
    expect(retire).toHaveBeenCalledTimes(1);
  });

  it('starts quietly when already parked, then watches subsequent activation and departure', () => {
    store.dispatch(openWorkspaceTab('other'));
    const retire = observe();
    expect(retire).not.toHaveBeenCalled();
    store.dispatch(openWorkspaceTab(ws));
    expect(retire).not.toHaveBeenCalled();
    store.dispatch(openWorkspaceTab('other'));
    expect(retire).toHaveBeenCalledTimes(1);
  });

  it('keeps initial no-demand idle, admits the mounted lease, and rejects its retired first reply', async () => {
    start('desktop');
    store.dispatch(workspaceUnmounted(ws));
    store.dispatch(openWorkspaceTab('other'));
    const retire = observe();
    expect(selectFileExplorerContext.select(store.state, ws)).not.toBeNull();
    expect(retire).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();

    store.dispatch(openWorkspaceTab(ws));
    expect(retire).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    store.dispatch(workspaceMounted(ws));
    expect(retire).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();

    const pending = deferred<unknown>();
    request.mockReturnValueOnce(pending.promise);
    store.dispatch(initializeFileExplorer(ws, { workspacePath: root }));
    expect(wireCalls()).toEqual([['file.list', { workspaceId: ws, path: '' }]]);
    expect(state().isLoading).toBe(true);
    const guard = request.mock.calls[0][2].onDispatch;

    store.dispatch(workspaceUnmounted(ws));
    expect(retire).toHaveBeenCalledTimes(1);
    expect(() => guard()).toThrow('retired');
    expect(state().rootPath).toBeNull();
    pending.resolve([file('retired.txt')]);
    await pending.promise;
    await Promise.resolve();
    expect(getItem(state().nodes, `${root}/retired.txt`)).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);

    store.dispatch(workspaceMounted(ws));
    const remountedRetire = observe();
    await initialize();
    expect(getItem(state().nodes, `${root}/z.txt`)).toBeDefined();
    expect(request).toHaveBeenCalledTimes(2);
    expect(retire).toHaveBeenCalledTimes(1);
    expect(remountedRetire).not.toHaveBeenCalled();
  });

  it('cleans up its selector channel when the owner stops', async () => {
    start('desktop');
    await initialize();
    store.dispatch(openWorkspaceTab(ws));
    const retire = observe();
    stopObservers.pop()!();
    store.dispatch(openWorkspaceTab('other'));
    store.dispatch(
      setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/replacement' } as Workspace),
    );
    expect(retire).not.toHaveBeenCalled();
    expect(state().rootPath).toBe(root);
  });

  it('rejects a context captured before the observer starts', () => {
    store.dispatch(openWorkspaceTab(ws));
    const retire = observe('stale-context');
    expect(retire).toHaveBeenCalledTimes(1);
  });
});
