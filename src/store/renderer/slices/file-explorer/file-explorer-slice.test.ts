import type { FileGitStatus, FileNode } from '$shared/types';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';
import {
  addExpandedPath,
  emptyFileExplorerWorkspaceState,
  fileExplorerReducer,
  initialState,
  refreshDirectoryRequested,
  removeAgentFileEditsEntries,
  setChildrenAtPathAction,
  setFileExplorerError,
  setFileExplorerLoading,
  setFileExplorerWorkspacePath,
  setGitStatusMap,
  setRootNode,
  updateAgentFileEditsEntries,
} from './file-explorer-slice';

const WS_ID = 'ws-1';
const WS_PATH = '/a/repo';

const MODIFIED: FileGitStatus = { status: ' M', additions: 2, deletions: 1 };
const ADDED: FileGitStatus = { status: 'A ', additions: 5, deletions: 0 };

describe('fileExplorerReducer — initialization error', () => {
  it('stores a serializable error and clears it when retry loading starts', () => {
    const failed = fileExplorerReducer(
      initialState,
      setFileExplorerError(WS_ID, 'Unable to load files.'),
    );
    expect(failed.byWorkspaceId[WS_ID].error).toBe('Unable to load files.');

    const retrying = fileExplorerReducer(failed, setFileExplorerLoading(WS_ID, true));
    expect(retrying.byWorkspaceId[WS_ID].error).toBeNull();
    expect(retrying.byWorkspaceId[WS_ID].isLoading).toBe(true);
  });
});

function directory(path: string, children?: FileNode[]): FileNode {
  return {
    name: path.split('/').pop() || '',
    path,
    type: 'directory',
    ...(children ? { children } : {}),
  };
}

function file(path: string): FileNode {
  return {
    name: path.split('/').pop() || '',
    path,
    type: 'file',
  };
}

function seeded(): ReturnType<typeof fileExplorerReducer> {
  let state = fileExplorerReducer(initialState, setFileExplorerWorkspacePath(WS_ID, WS_PATH));
  state = fileExplorerReducer(
    state,
    setGitStatusMap(WS_ID, { 'src/lib/foo.ts': MODIFIED, 'README.md': ADDED }),
  );
  return state;
}

describe('fileExplorerReducer — normalized tree state', () => {
  it('starts with a serializable empty normalized tree', () => {
    expect(emptyFileExplorerWorkspaceState.rootPath).toBeNull();
    expect(emptyFileExplorerWorkspaceState.nodes).toEqual({
      idField: 'path',
      ids: [],
      map: {},
      refsCount: {},
    });
    expect(Object.hasOwn(emptyFileExplorerWorkspaceState, 'environmentConfig')).toBe(false);
    expect(JSON.parse(JSON.stringify(emptyFileExplorerWorkspaceState))).toEqual(
      emptyFileExplorerWorkspaceState,
    );
  });

  it('normalizes a root FileNode tree into a path-keyed Collection', () => {
    const root = directory(WS_PATH, [
      directory(`${WS_PATH}/src`, [file(`${WS_PATH}/src/index.ts`)]),
      file(`${WS_PATH}/README.md`),
    ]);

    const state = fileExplorerReducer(initialState, setRootNode(WS_ID, root));
    const ws = state.byWorkspaceId[WS_ID];

    expect(ws.rootPath).toBe(WS_PATH);
    expect(ws.nodes.ids).toEqual([
      WS_PATH,
      `${WS_PATH}/src`,
      `${WS_PATH}/src/index.ts`,
      `${WS_PATH}/README.md`,
    ]);
    expect(getItem(ws.nodes, WS_PATH)?.children).toEqual([
      `${WS_PATH}/src`,
      `${WS_PATH}/README.md`,
    ]);
    expect(getItem(ws.nodes, `${WS_PATH}/src`)?.children).toEqual([`${WS_PATH}/src/index.ts`]);
  });

  it('replaces an existing root tree and removes old root descendants', () => {
    const initialRoot = directory(WS_PATH, [
      directory(`${WS_PATH}/src`, [file(`${WS_PATH}/src/old.ts`)]),
    ]);
    const replacementPath = '/replacement/repo';
    const replacementRoot = directory(replacementPath, [
      directory(`${replacementPath}/app`, [file(`${replacementPath}/app/new.ts`)]),
    ]);

    const state = fileExplorerReducer(initialState, setRootNode(WS_ID, initialRoot));
    const next = fileExplorerReducer(state, setRootNode(WS_ID, replacementRoot));
    const ws = next.byWorkspaceId[WS_ID];

    expect(ws.rootPath).toBe(replacementPath);
    expect(ws.nodes.ids).toEqual([
      replacementPath,
      `${replacementPath}/app`,
      `${replacementPath}/app/new.ts`,
    ]);
    expect(getItem(ws.nodes, WS_PATH)).toBeUndefined();
    expect(getItem(ws.nodes, `${WS_PATH}/src`)).toBeUndefined();
    expect(getItem(ws.nodes, `${WS_PATH}/src/old.ts`)).toBeUndefined();
    expect(getItem(ws.nodes, replacementPath)?.children).toEqual([`${replacementPath}/app`]);
    expect(getItem(ws.nodes, `${replacementPath}/app`)?.children).toEqual([
      `${replacementPath}/app/new.ts`,
    ]);
    expect(getItem(ws.nodes, `${replacementPath}/app/new.ts`)?.children).toEqual([]);
    expect(ws.treeVersion).toBe(state.byWorkspaceId[WS_ID].treeVersion + 1);
  });

  it('preserves expanded paths when a replacement tree omits them', () => {
    const initialRoot = directory(WS_PATH, [directory(`${WS_PATH}/src`)]);
    const replacementRoot = directory(WS_PATH, [file(`${WS_PATH}/README.md`)]);

    let state = fileExplorerReducer(initialState, setRootNode(WS_ID, initialRoot));
    state = fileExplorerReducer(state, addExpandedPath(WS_ID, WS_PATH));
    state = fileExplorerReducer(state, addExpandedPath(WS_ID, `${WS_PATH}/src`));

    const next = fileExplorerReducer(state, setRootNode(WS_ID, replacementRoot));
    const ws = next.byWorkspaceId[WS_ID];

    expect(ws.expandedPaths).toEqual([WS_PATH, `${WS_PATH}/src`]);
    expect(getItem(ws.nodes, `${WS_PATH}/src`)).toBeUndefined();
  });

  it('replaces directory children while preserving sibling node references', () => {
    const root = directory(WS_PATH, [directory(`${WS_PATH}/src`), file(`${WS_PATH}/README.md`)]);
    const state = fileExplorerReducer(initialState, setRootNode(WS_ID, root));
    const readmeBefore = getItem(state.byWorkspaceId[WS_ID].nodes, `${WS_PATH}/README.md`);

    const next = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src`, [file(`${WS_PATH}/src/index.ts`)]),
    );
    const ws = next.byWorkspaceId[WS_ID];

    expect(getItem(ws.nodes, `${WS_PATH}/src`)?.children).toEqual([`${WS_PATH}/src/index.ts`]);
    expect(getItem(ws.nodes, `${WS_PATH}/src/index.ts`)).toMatchObject({
      path: `${WS_PATH}/src/index.ts`,
      type: 'file',
      children: [],
    });
    expect(getItem(ws.nodes, `${WS_PATH}/README.md`)).toBe(readmeBefore);
    expect(ws.treeVersion).toBe(state.byWorkspaceId[WS_ID].treeVersion + 1);
  });

  it('returns the same state reference when replacing children is a no-op', () => {
    const root = directory(WS_PATH, [file(`${WS_PATH}/README.md`)]);
    const state = fileExplorerReducer(initialState, setRootNode(WS_ID, root));

    const next = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, WS_PATH, [file(`${WS_PATH}/README.md`)]),
    );

    expect(next).toBe(state);
  });

  it('ignores child replacement for paths absent from the normalized tree', () => {
    const root = directory(WS_PATH, [file(`${WS_PATH}/README.md`)]);
    const state = fileExplorerReducer(initialState, setRootNode(WS_ID, root));

    const next = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src`, [file(`${WS_PATH}/src/index.ts`)]),
    );

    expect(next).toBe(state);
    expect(getItem(next.byWorkspaceId[WS_ID].nodes, `${WS_PATH}/src/index.ts`)).toBeUndefined();
  });

  it('removes stale descendants when a directory refresh changes child paths', () => {
    let state = fileExplorerReducer(
      initialState,
      setRootNode(WS_ID, directory(WS_PATH, [directory(`${WS_PATH}/src`)])),
    );
    state = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src`, [directory(`${WS_PATH}/src/lib`)]),
    );
    state = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src/lib`, [file(`${WS_PATH}/src/lib/old.ts`)]),
    );

    const next = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src`, [file(`${WS_PATH}/src/new.ts`)]),
    );
    const ws = next.byWorkspaceId[WS_ID];

    expect(getItem(ws.nodes, `${WS_PATH}/src`)?.children).toEqual([`${WS_PATH}/src/new.ts`]);
    expect(getItem(ws.nodes, `${WS_PATH}/src/new.ts`)).toBeDefined();
    expect(getItem(ws.nodes, `${WS_PATH}/src/lib`)).toBeUndefined();
    expect(getItem(ws.nodes, `${WS_PATH}/src/lib/old.ts`)).toBeUndefined();
  });

  it('clears normalized nodes when the workspace path changes', () => {
    const state = fileExplorerReducer(
      initialState,
      setRootNode(WS_ID, directory(WS_PATH, [file(`${WS_PATH}/README.md`)])),
    );

    const next = fileExplorerReducer(state, setFileExplorerWorkspacePath(WS_ID, '/other/repo'));
    const ws = next.byWorkspaceId[WS_ID];

    expect(ws.workspacePath).toBe('/other/repo');
    expect(ws.rootPath).toBeNull();
    expect(ws.nodes.ids).toEqual([]);
  });
});

describe('fileExplorerReducer — updateAgentFileEditsEntries / removeAgentFileEditsEntries', () => {
  function seededEdits() {
    let state = fileExplorerReducer(initialState, setFileExplorerWorkspacePath(WS_ID, WS_PATH));
    state = fileExplorerReducer(
      state,
      updateAgentFileEditsEntries(WS_ID, {
        'src/a.ts': ['agent-1'],
        'src/b.ts': ['agent-2'],
      }),
    );
    return state;
  }

  it('no-op when every array shallowEquals existing', () => {
    const state = seededEdits();
    const next = fileExplorerReducer(
      state,
      updateAgentFileEditsEntries(WS_ID, {
        'src/a.ts': ['agent-1'],
        'src/b.ts': ['agent-2'],
      }),
    );
    expect(next).toBe(state);
  });

  it('updates only when the array content differs', () => {
    const state = seededEdits();
    const prevB = state.byWorkspaceId[WS_ID].agentFileEdits['src/b.ts'];
    const next = fileExplorerReducer(
      state,
      updateAgentFileEditsEntries(WS_ID, { 'src/a.ts': ['agent-1', 'agent-9'] }),
    );
    expect(next).not.toBe(state);
    expect(next.byWorkspaceId[WS_ID].agentFileEdits['src/a.ts']).toEqual(['agent-1', 'agent-9']);
    expect(next.byWorkspaceId[WS_ID].agentFileEdits['src/b.ts']).toBe(prevB);
  });

  it('removeAgentFileEditsEntries is a no-op when path absent', () => {
    const state = seededEdits();
    const next = fileExplorerReducer(state, removeAgentFileEditsEntries(WS_ID, ['nope']));
    expect(next).toBe(state);
  });
});

describe('fileExplorerReducer — folder-first sorting', () => {
  it('sorts root children: directories first (alphabetical) then files (alphabetical)', () => {
    const interleaved = directory(WS_PATH, [
      file(`${WS_PATH}/zeta.txt`),
      directory(`${WS_PATH}/Beta`),
      file(`${WS_PATH}/alpha.md`),
      directory(`${WS_PATH}/alpha-dir`),
      file(`${WS_PATH}/Bravo.txt`),
    ]);

    const state = fileExplorerReducer(initialState, setRootNode(WS_ID, interleaved));
    const ws = state.byWorkspaceId[WS_ID];

    expect(getItem(ws.nodes, WS_PATH)?.children).toEqual([
      `${WS_PATH}/alpha-dir`,
      `${WS_PATH}/Beta`,
      `${WS_PATH}/alpha.md`,
      `${WS_PATH}/Bravo.txt`,
      `${WS_PATH}/zeta.txt`,
    ]);
  });

  it('sorts at every nested depth in setRootNode', () => {
    const interleaved = directory(WS_PATH, [
      file(`${WS_PATH}/z.txt`),
      directory(`${WS_PATH}/src`, [
        file(`${WS_PATH}/src/index.ts`),
        directory(`${WS_PATH}/src/utils`, [
          file(`${WS_PATH}/src/utils/b.ts`),
          directory(`${WS_PATH}/src/utils/inner`),
          file(`${WS_PATH}/src/utils/a.ts`),
        ]),
        directory(`${WS_PATH}/src/lib`),
      ]),
    ]);

    const state = fileExplorerReducer(initialState, setRootNode(WS_ID, interleaved));
    const ws = state.byWorkspaceId[WS_ID];

    expect(getItem(ws.nodes, WS_PATH)?.children).toEqual([`${WS_PATH}/src`, `${WS_PATH}/z.txt`]);
    expect(getItem(ws.nodes, `${WS_PATH}/src`)?.children).toEqual([
      `${WS_PATH}/src/lib`,
      `${WS_PATH}/src/utils`,
      `${WS_PATH}/src/index.ts`,
    ]);
    expect(getItem(ws.nodes, `${WS_PATH}/src/utils`)?.children).toEqual([
      `${WS_PATH}/src/utils/inner`,
      `${WS_PATH}/src/utils/a.ts`,
      `${WS_PATH}/src/utils/b.ts`,
    ]);
  });

  it('sorts lazily-loaded children via setChildrenAtPathAction at root and nested depth', () => {
    const root = directory(WS_PATH, [directory(`${WS_PATH}/src`)]);
    let state = fileExplorerReducer(initialState, setRootNode(WS_ID, root));

    state = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src`, [
        file(`${WS_PATH}/src/zeta.ts`),
        directory(`${WS_PATH}/src/Utils`, [
          file(`${WS_PATH}/src/Utils/b.ts`),
          directory(`${WS_PATH}/src/Utils/inner`),
          file(`${WS_PATH}/src/Utils/a.ts`),
        ]),
        file(`${WS_PATH}/src/alpha.ts`),
        directory(`${WS_PATH}/src/api`),
      ]),
    );

    const ws = state.byWorkspaceId[WS_ID];
    expect(getItem(ws.nodes, `${WS_PATH}/src`)?.children).toEqual([
      `${WS_PATH}/src/api`,
      `${WS_PATH}/src/Utils`,
      `${WS_PATH}/src/alpha.ts`,
      `${WS_PATH}/src/zeta.ts`,
    ]);
    expect(getItem(ws.nodes, `${WS_PATH}/src/Utils`)?.children).toEqual([
      `${WS_PATH}/src/Utils/inner`,
      `${WS_PATH}/src/Utils/a.ts`,
      `${WS_PATH}/src/Utils/b.ts`,
    ]);
  });

  it('is idempotent — re-applying the same already-sorted children is a no-op', () => {
    const root = directory(WS_PATH, [directory(`${WS_PATH}/src`)]);
    let state = fileExplorerReducer(initialState, setRootNode(WS_ID, root));
    state = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src`, [
        directory(`${WS_PATH}/src/a-dir`),
        file(`${WS_PATH}/src/b.ts`),
      ]),
    );

    const next = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src`, [
        directory(`${WS_PATH}/src/a-dir`),
        file(`${WS_PATH}/src/b.ts`),
      ]),
    );
    expect(next).toBe(state);

    const reordered = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src`, [
        file(`${WS_PATH}/src/b.ts`),
        directory(`${WS_PATH}/src/a-dir`),
      ]),
    );
    expect(reordered).toBe(state);
  });
});

describe('refreshDirectoryRequested', () => {
  it('is a pure saga-trigger action — reducer does not mutate state for it', () => {
    const seededState = seeded();
    const next = fileExplorerReducer(
      seededState,
      refreshDirectoryRequested(WS_ID, '/a/repo/src/new.ts'),
    );
    expect(next).toBe(seededState);
  });
});
