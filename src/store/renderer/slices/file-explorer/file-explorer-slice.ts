import type { FileNode, FileGitStatus } from '$shared/types';
import { shallowEqual } from 'fast-equals';
import {
  createCollection,
  getItem,
  getItems,
  removeItem,
  upsertItem,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import type {
  FileExplorerWorkspaceState,
  FileExplorerState,
  FileExplorerTreeNode,
  FileExplorerSearch,
} from './file-explorer-types';
import { sortNodesRecursive } from './file-explorer-utils';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';

export type { FileExplorerWorkspaceState, FileExplorerState };

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export const emptyFileExplorerWorkspaceState: FileExplorerWorkspaceState = {
  workspacePath: '',
  rootPath: null,
  nodes: createCollection<FileExplorerTreeNode, 'path'>('path'),
  isLoading: false,
  isInitialized: false,
  error: null,
  fileCount: 0,
  gitStatus: {},
  expandedPaths: [],
  loadingPaths: [],
  directoryRequests: {},
  directoryErrors: {},
  agentFileEdits: {},
  isBulkOperation: false,
  treeVersion: 0,
  gitignorePatterns: [],
  remoteConnectionId: null,
  isRemoteInitialized: false,
  isStoreActive: true,
};

export const initialState: FileExplorerState = {
  byWorkspaceId: {},
  searches: createCollection<FileExplorerSearch, 'consumerId'>('consumerId'),
};

const { getWorkspaceState, setWorkspaceState } = createWorkspaceScopedHelpers(
  emptyFileExplorerWorkspaceState,
);

// ---------------------------------------------------------------------------
// Saga-trigger actions
// ---------------------------------------------------------------------------

export const initializeFileExplorer = createAction<
  [wsId: string, options: { workspacePath: string; workspaceId?: string }]
>('fileExplorer/initializeFileExplorer');

export const retireFileExplorer = createAction<[wsId: string]>('fileExplorer/retireFileExplorer');

export const toggleDirectoryRequested = createAction<[wsId: string, nodePath: string]>(
  'fileExplorer/toggleDirectoryRequested',
);

export const expandToPathRequested = createAction<[wsId: string, targetPath: string]>(
  'fileExplorer/expandToPathRequested',
);

export const expandAllRequested = createAction<[wsId: string, maxDepth?: number]>(
  'fileExplorer/expandAllRequested',
);

export const refreshFileExplorer = createAction<[wsId: string]>('fileExplorer/refreshFileExplorer');

/**
 * Fan-out trigger dispatched by the workspaceMounted fan-out
 * (`lifecycle-ipc-read-service`) so a workspace first-opened after boot
 * hydrates its file tree via `appClient.files.explorerTree` — mirroring the
 * file-explorer read saga. Saga-only trigger with no
 * reducer entry (see AGENTS.md §8); the handler lives in
 * `file-explorer-read-service` and is guarded by the per-workspace
 * `isInitialized` flag so boot-seeded workspaces are unaffected.
 */
export const hydrateFileExplorerRequested = createAction<
  [wsId: string, force?: boolean, generation?: number]
>('fileExplorer/hydrateFileExplorerRequested');

/**
 * Trigger a targeted reload of a single directory's children in response to a
 * file create/delete event. The caller passes the PATH of the file that was
 * created or deleted; the saga computes the parent directory itself.
 *
 * Pure saga-trigger action — no reducer entry. The saga reloads one directory
 * and dispatches setChildrenAtPathAction so rows outside that directory keep
 * object identity.
 */
export const refreshDirectoryRequested = createAction<[wsId: string, filePath: string]>(
  'fileExplorer/refreshDirectoryRequested',
);

export const syncGitStatusFromStoresRequested = createAction<[wsId: string]>(
  'fileExplorer/syncGitStatusFromStoresRequested',
);

export const fileSearchOpened = createAction<[wsId: string, consumerId: string, context: string]>(
  'fileExplorer/fileSearchOpened',
);
export const fileSearchRequested = createAction<
  [wsId: string, consumerId: string, requestId: string, query: string, context?: string]
>('fileExplorer/fileSearchRequested');
export const fileSearchReleased = createAction<[wsId: string, consumerId: string]>(
  'fileExplorer/fileSearchReleased',
);
export const fileSearchLoading = createAction<
  [wsId: string, consumerId: string, requestId: string]
>('fileExplorer/fileSearchLoading');
export const fileSearchSettled = createAction<
  [
    wsId: string,
    consumerId: string,
    requestId: string,
    paths: string[],
    error: string | null,
    truncated?: boolean,
  ]
>('fileExplorer/fileSearchSettled');

// ---------------------------------------------------------------------------
// Reducer actions
// ---------------------------------------------------------------------------

export const setFileExplorerLoading =
  createAction<[wsId: string, isLoading: boolean]>('fileExplorer/setLoading');

export const setFileExplorerError =
  createAction<[wsId: string, error: string | null]>('fileExplorer/setError');

export const setFileExplorerInitialized = createAction<[wsId: string, isInitialized: boolean]>(
  'fileExplorer/setInitialized',
);

export const setRootNode = createAction<[wsId: string, rootNode: FileNode | null]>(
  'fileExplorer/setRootNode',
);

export const setChildrenAtPathAction = createAction<
  [wsId: string, parentPath: string, children: FileNode[], requestId?: string]
>('fileExplorer/setChildrenAtPath');

export const directoryReadStarted = createAction<[wsId: string, path: string, requestId: string]>(
  'fileExplorer/directoryReadStarted',
);
export const directoryReadSettled = createAction<
  [wsId: string, path: string, requestId: string, error: string | null]
>('fileExplorer/directoryReadSettled');

export const setGitStatusMap = createAction<
  [wsId: string, gitStatus: Record<string, FileGitStatus>]
>('fileExplorer/setGitStatusMap');

/**
 * Shallow-merge per-entry agent-file-edits updates into ws.agentFileEdits.
 * Same no-op semantics as updateGitStatusEntries.
 */
export const updateAgentFileEditsEntries = createAction<
  [wsId: string, entries: Record<string, string[]>]
>('fileExplorer/updateAgentFileEditsEntries');

/**
 * Remove the listed paths from ws.agentFileEdits.
 * Same no-op semantics as removeGitStatusEntries.
 */
export const removeAgentFileEditsEntries = createAction<[wsId: string, paths: string[]]>(
  'fileExplorer/removeAgentFileEditsEntries',
);

export const addExpandedPath = createAction<[wsId: string, path: string]>(
  'fileExplorer/addExpandedPath',
);

export const removeExpandedPath = createAction<[wsId: string, path: string]>(
  'fileExplorer/removeExpandedPath',
);

export const clearExpandedPathsExceptRoot = createAction<[wsId: string]>(
  'fileExplorer/clearExpandedPathsExceptRoot',
);

export const addLoadingPath = createAction<[wsId: string, path: string]>(
  'fileExplorer/addLoadingPath',
);

export const removeLoadingPath = createAction<[wsId: string, path: string]>(
  'fileExplorer/removeLoadingPath',
);

export const setBulkOperation = createAction<[wsId: string, isBulk: boolean]>(
  'fileExplorer/setBulkOperation',
);

export const incrementTreeVersion = createAction<[wsId: string]>(
  'fileExplorer/incrementTreeVersion',
);

export const setFileExplorerWorkspacePath = createAction<[wsId: string, path: string]>(
  'fileExplorer/setWorkspacePath',
);

export const setFileExplorerFileCount = createAction<[wsId: string, count: number]>(
  'fileExplorer/setFileCount',
);

// ---------------------------------------------------------------------------
// Reducer helpers
// ---------------------------------------------------------------------------

// Local helpers — immutable merge/remove on Record<string, V> with
// identity-stable no-op semantics. If nothing changes, the same reference
// is returned; otherwise a new object with the changes applied.
function mergeRecordEntries<V>(
  record: Record<string, V>,
  entries: Record<string, V>,
  equals: (a: V, b: V) => boolean,
): Record<string, V> {
  const keys = Object.keys(entries);
  if (keys.length === 0) return record;
  let draft: Record<string, V> | null = null;
  for (const key of keys) {
    const incoming = entries[key];
    const existing = record[key];
    if (existing !== undefined && equals(existing, incoming)) continue;
    if (!draft) draft = { ...record };
    draft[key] = incoming;
  }
  return draft ?? record;
}

function removeRecordKeys<V>(
  record: Record<string, V>,
  keys: readonly string[],
): Record<string, V> {
  if (keys.length === 0) return record;
  let draft: Record<string, V> | null = null;
  for (const k of keys) {
    if (!(k in record)) continue;
    if (!draft) draft = { ...record };
    delete draft[k];
  }
  return draft ?? record;
}

function createEmptyNodesCollection(): Collection<FileExplorerTreeNode, 'path'> {
  return createCollection<FileExplorerTreeNode, 'path'>('path');
}

function toTreeNode(node: FileNode): FileExplorerTreeNode {
  const { children, ...metadata } = node;
  return {
    ...metadata,
    children: children?.map((child) => child.path) ?? [],
  };
}

function collectNormalizedNodes(
  node: FileNode,
  result: FileExplorerTreeNode[] = [],
): FileExplorerTreeNode[] {
  result.push(toTreeNode(node));
  for (const child of node.children ?? []) {
    collectNormalizedNodes(child, result);
  }
  return result;
}

function sortedRoot(rootNode: FileNode): FileNode {
  return rootNode.children
    ? { ...rootNode, children: sortNodesRecursive(rootNode.children) }
    : rootNode;
}

function normalizeTree(rootNode: FileNode | null): {
  rootPath: string | null;
  nodes: Collection<FileExplorerTreeNode, 'path'>;
} {
  if (!rootNode) {
    return { rootPath: null, nodes: createEmptyNodesCollection() };
  }
  return {
    rootPath: rootNode.path,
    nodes: createCollection<FileExplorerTreeNode, 'path'>(
      'path',
      collectNormalizedNodes(sortedRoot(rootNode)),
    ),
  };
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function treeNodesEqual(left: FileExplorerTreeNode, right: FileExplorerTreeNode): boolean {
  const { children: leftChildren, ...leftMetadata } = left;
  const { children: rightChildren, ...rightMetadata } = right;
  return shallowEqual(leftMetadata, rightMetadata) && sameStringArray(leftChildren, rightChildren);
}

function collectSubtreePaths(
  nodes: Collection<FileExplorerTreeNode, 'path'>,
  paths: readonly string[],
  result: string[] = [],
): string[] {
  for (const path of paths) {
    const node = getItem(nodes, path);
    if (!node) continue;
    result.push(path);
    collectSubtreePaths(nodes, node.children, result);
  }
  return result;
}

function replaceChildrenInCollection(
  nodes: Collection<FileExplorerTreeNode, 'path'>,
  parentPath: string,
  children: FileNode[],
): Collection<FileExplorerTreeNode, 'path'> {
  const parent = getItem(nodes, parentPath);
  if (!parent) return nodes;

  const sortedChildren = sortNodesRecursive(children);
  const childPaths = sortedChildren.map((child) => child.path);
  const incomingNodes = sortedChildren.flatMap((child) => collectNormalizedNodes(child));
  const incomingPaths = new Set(incomingNodes.map((node) => node.path));
  const stalePaths = collectSubtreePaths(nodes, parent.children).filter(
    (path) => !incomingPaths.has(path),
  );

  const updatedParent: FileExplorerTreeNode = { ...parent, children: childPaths };
  const hasIncomingChanges = incomingNodes.some((node) => {
    const existing = getItem(nodes, node.path);
    return !existing || !treeNodesEqual(existing, node);
  });

  if (
    stalePaths.length === 0 &&
    sameStringArray(parent.children, childPaths) &&
    !hasIncomingChanges
  ) {
    return nodes;
  }

  const stalePathSet = new Set(stalePaths);
  const finalItems: FileExplorerTreeNode[] = [];
  for (const node of getItems(nodes)) {
    if (node.path === parentPath) {
      finalItems.push(updatedParent);
      continue;
    }
    if (stalePathSet.has(node.path) || incomingPaths.has(node.path)) continue;
    finalItems.push(node);
  }
  finalItems.push(...incomingNodes);

  return createCollection<FileExplorerTreeNode, 'path'>('path', finalItems);
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const fileExplorerReducer = createReducer<FileExplorerState>(initialState);
fileExplorerReducer.with(retireFileExplorer, (state, { payload: [wsId] }) => {
  if (!(wsId in state.byWorkspaceId)) return state;
  const byWorkspaceId = { ...state.byWorkspaceId };
  delete byWorkspaceId[wsId];
  return { ...state, byWorkspaceId };
});
fileExplorerReducer.with(
  fileSearchOpened,
  (state, { payload: [workspaceId, consumerId, context] }) => ({
    ...state,
    searches: upsertItem(state.searches, {
      workspaceId,
      consumerId,
      context,
      requestId: '',
      query: '',
      paths: [],
      settled: true,
      truncated: null,
      loading: false,
      error: null,
    }),
  }),
);
fileExplorerReducer.with(
  fileSearchRequested,
  (state, { payload: [workspaceId, consumerId, requestId, query, context] }) => {
    const previous = getItem(state.searches, consumerId);
    if (
      context !== undefined &&
      (previous?.workspaceId !== workspaceId || previous.context !== context)
    )
      return state;
    return {
      ...state,
      searches: upsertItem(state.searches, {
        workspaceId,
        consumerId,
        requestId,
        query,
        context: context ?? null,
        settled: !query,
        truncated: null,
        paths:
          query && previous?.workspaceId === workspaceId && previous.context === (context ?? null)
            ? previous.paths
            : [],
        loading: false,
        error: null,
      }),
    };
  },
);
fileExplorerReducer.with(fileSearchLoading, (state, { payload: [wsId, consumerId, requestId] }) => {
  const search = getItem(state.searches, consumerId);
  if (!search || search.workspaceId !== wsId || search.requestId !== requestId || search.loading)
    return state;
  return { ...state, searches: upsertItem(state.searches, { ...search, loading: true }) };
});
fileExplorerReducer.with(
  fileSearchSettled,
  (state, { payload: [wsId, consumerId, requestId, paths, error, truncated] }) => {
    const search = getItem(state.searches, consumerId);
    if (!search || search.workspaceId !== wsId || search.requestId !== requestId) return state;
    return {
      ...state,
      searches: upsertItem(state.searches, {
        ...search,
        paths,
        error,
        loading: false,
        settled: true,
        truncated: truncated ?? null,
      }),
    };
  },
);
fileExplorerReducer.with(fileSearchReleased, (state, { payload: [wsId, consumerId] }) => {
  if (getItem(state.searches, consumerId)?.workspaceId !== wsId) return state;
  return { ...state, searches: removeItem(state.searches, consumerId) };
});
fileExplorerReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) => {
  let searches = state.searches;
  for (const search of getItems(searches)) {
    if (search.workspaceId === wsId) searches = removeItem(searches, search.consumerId);
  }
  return searches === state.searches ? state : { ...state, searches };
});
fileExplorerReducer.with(setFileExplorerLoading, (state, { payload: [wsId, isLoading] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.isLoading === isLoading) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    isLoading,
    ...(isLoading ? { error: null } : {}),
  });
});
fileExplorerReducer.with(setFileExplorerError, (state, { payload: [wsId, error] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.error === error) return state;
  return setWorkspaceState(state, wsId, { ...ws, error });
});
fileExplorerReducer.with(
  setFileExplorerInitialized,
  (state, { payload: [wsId, isInitialized] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, isInitialized });
  },
);
fileExplorerReducer.with(setRootNode, (state, { payload: [wsId, rootNode] }) => {
  const ws = getWorkspaceState(state, wsId);
  const normalizedTree = normalizeTree(rootNode);
  if (normalizedTree.rootPath === null && ws.rootPath === null && ws.nodes.ids.length === 0) {
    return state;
  }
  return setWorkspaceState(state, wsId, {
    ...ws,
    ...normalizedTree,
    directoryRequests: {},
    directoryErrors: {},
    loadingPaths: [],
    treeVersion: ws.treeVersion + 1,
  });
});
fileExplorerReducer.with(
  setChildrenAtPathAction,
  (state, { payload: [wsId, parentPath, children, requestId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!ws.rootPath || (requestId !== undefined && ws.directoryRequests[parentPath] !== requestId))
      return state;
    const nodes = replaceChildrenInCollection(ws.nodes, parentPath, children);
    if (nodes === ws.nodes) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      nodes,
      loadingPaths: ws.loadingPaths.filter((path) => !!getItem(nodes, path)),
      directoryRequests: removeRecordKeys(
        ws.directoryRequests,
        Object.keys(ws.directoryRequests).filter((path) => !getItem(nodes, path)),
      ),
      directoryErrors: removeRecordKeys(
        ws.directoryErrors,
        Object.keys(ws.directoryErrors).filter((path) => !getItem(nodes, path)),
      ),
      treeVersion: ws.treeVersion + 1,
    });
  },
);
fileExplorerReducer.with(directoryReadStarted, (state, { payload: [wsId, path, requestId] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (getItem(ws.nodes, path)?.type !== 'directory') return state;
  if (ws.directoryRequests[path] === requestId && !(path in ws.directoryErrors)) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    directoryRequests: { ...ws.directoryRequests, [path]: requestId },
    directoryErrors: removeRecordKeys(ws.directoryErrors, [path]),
  });
});
fileExplorerReducer.with(
  directoryReadSettled,
  (state, { payload: [wsId, path, requestId, error] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.directoryRequests[path] !== requestId) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      directoryRequests: removeRecordKeys(ws.directoryRequests, [path]),
      directoryErrors:
        error === null
          ? removeRecordKeys(ws.directoryErrors, [path])
          : { ...ws.directoryErrors, [path]: error },
    });
  },
);
fileExplorerReducer.with(setGitStatusMap, (state, { payload: [wsId, gitStatus] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, gitStatus });
});
fileExplorerReducer.with(updateAgentFileEditsEntries, (state, { payload: [wsId, entries] }) => {
  const ws = getWorkspaceState(state, wsId);
  const agentFileEdits = mergeRecordEntries(ws.agentFileEdits, entries, shallowEqual);
  if (agentFileEdits === ws.agentFileEdits) return state;
  return setWorkspaceState(state, wsId, { ...ws, agentFileEdits });
});
fileExplorerReducer.with(removeAgentFileEditsEntries, (state, { payload: [wsId, paths] }) => {
  const ws = getWorkspaceState(state, wsId);
  const agentFileEdits = removeRecordKeys(ws.agentFileEdits, paths);
  if (agentFileEdits === ws.agentFileEdits) return state;
  return setWorkspaceState(state, wsId, { ...ws, agentFileEdits });
});
fileExplorerReducer.with(addExpandedPath, (state, { payload: [wsId, path] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.expandedPaths.includes(path)) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    expandedPaths: [...ws.expandedPaths, path],
    treeVersion: ws.treeVersion + 1,
  });
});
fileExplorerReducer.with(removeExpandedPath, (state, { payload: [wsId, path] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (!ws.expandedPaths.includes(path)) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    expandedPaths: ws.expandedPaths.filter((p) => p !== path),
    treeVersion: ws.treeVersion + 1,
  });
});
fileExplorerReducer.with(clearExpandedPathsExceptRoot, (state, { payload: [wsId] }) => {
  const ws = getWorkspaceState(state, wsId);
  const rootPath = ws.workspacePath;
  return setWorkspaceState(state, wsId, {
    ...ws,
    expandedPaths: rootPath ? [rootPath] : [],
    treeVersion: ws.treeVersion + 1,
  });
});
fileExplorerReducer.with(addLoadingPath, (state, { payload: [wsId, path] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.loadingPaths.includes(path)) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    loadingPaths: [...ws.loadingPaths, path],
    treeVersion: ws.treeVersion + 1,
  });
});
fileExplorerReducer.with(removeLoadingPath, (state, { payload: [wsId, path] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    loadingPaths: ws.loadingPaths.filter((p) => p !== path),
    treeVersion: ws.treeVersion + 1,
  });
});
fileExplorerReducer.with(setBulkOperation, (state, { payload: [wsId, isBulk] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, isBulkOperation: isBulk });
});
fileExplorerReducer.with(incrementTreeVersion, (state, { payload: [wsId] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, treeVersion: ws.treeVersion + 1 });
});
fileExplorerReducer.with(setFileExplorerWorkspacePath, (state, { payload: [wsId, path] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.workspacePath === path) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    workspacePath: path,
    isLoading: false,
    isInitialized: false,
    rootPath: null,
    nodes: createEmptyNodesCollection(),
    expandedPaths: [],
    loadingPaths: [],
    directoryRequests: {},
    directoryErrors: {},
    error: null,
    treeVersion: ws.treeVersion + 1,
  });
});
fileExplorerReducer.with(setFileExplorerFileCount, (state, { payload: [wsId, count] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, fileCount: count });
});
