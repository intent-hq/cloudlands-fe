import type { FileNode, FileGitStatus, EnvironmentConfig } from "$shared/types";
import { shallowEqual } from "fast-equals";
import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import { createReducer } from "svelte-redux-toolkit/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import type { FileExplorerWorkspaceState, FileExplorerState } from "./file-explorer-types";
import { setChildrenAtPath } from "./file-explorer-utils";
import type { StoreAction } from "svelte-redux-toolkit/types";

export type { FileExplorerWorkspaceState, FileExplorerState };

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export const emptyFileExplorerWorkspaceState: FileExplorerWorkspaceState = {
  workspacePath: "",
  rootNode: null,
  isLoading: false,
  isInitialized: false,
  error: null,
  fileCount: 0,
  gitStatus: {},
  expandedPaths: [],
  loadingPaths: [],
  agentFileEdits: {},
  isBulkOperation: false,
  treeVersion: 0,
  gitignorePatterns: [],
  environmentConfig: undefined,
  remoteConnectionId: null,
  isRemoteInitialized: false,
  isStoreActive: true,
};

export const initialState: FileExplorerState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyFileExplorerWorkspaceState);

// ---------------------------------------------------------------------------
// Saga-trigger actions
// ---------------------------------------------------------------------------

export const initializeFileExplorer = createAction<
  [wsId: string, options: { workspacePath: string; workspaceId?: string; environmentConfig?: EnvironmentConfig }]
>("fileExplorer/initializeFileExplorer");

export const setWorkspacePathRequested = createAction<[wsId: string, path: string]>(
  "fileExplorer/setWorkspacePathRequested",
);

export const toggleDirectoryRequested = createAction<[wsId: string, nodePath: string]>(
  "fileExplorer/toggleDirectoryRequested",
);

export const expandToPathRequested = createAction<[wsId: string, targetPath: string]>(
  "fileExplorer/expandToPathRequested",
);

export const expandAllRequested = createAction<[wsId: string, maxDepth?: number]>(
  "fileExplorer/expandAllRequested",
);

export const refreshFileExplorer = createAction<[wsId: string]>(
  "fileExplorer/refreshFileExplorer",
);

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
  "fileExplorer/refreshDirectoryRequested",
);

export const refreshGitStatusRequested = createAction<[wsId: string]>(
  "fileExplorer/refreshGitStatusRequested",
);

export const syncGitStatusFromStoresRequested = createAction<[wsId: string]>(
  "fileExplorer/syncGitStatusFromStoresRequested",
);

/**
 * Wrapper action used by the file-explorer saga to debounce rapid
 * file-tracking IPC events. Dispatch as
 * `debouncedFileTrackingSync(syncGitStatusFromStoresRequested(wsId))` — the
 * inner action is fired after the debounce window elapses.
 */
export const debouncedFileTrackingSync = createAction<[inner: StoreAction<any>]>(
  "fileExplorer/debouncedFileTrackingSync",
);

// ---------------------------------------------------------------------------
// Reducer actions
// ---------------------------------------------------------------------------

export const setFileExplorerLoading = createAction<[wsId: string, isLoading: boolean]>(
  "fileExplorer/setLoading",
);

export const setFileExplorerError = createAction<[wsId: string, error: string | null]>(
  "fileExplorer/setError",
);

export const setFileExplorerInitialized = createAction<[wsId: string, isInitialized: boolean]>(
  "fileExplorer/setInitialized",
);

export const setRootNode = createAction<[wsId: string, rootNode: FileNode | null]>(
  "fileExplorer/setRootNode",
);

export const setChildrenAtPathAction = createAction<
  [wsId: string, parentPath: string, children: FileNode[]]
>("fileExplorer/setChildrenAtPath");

export const setGitignorePatterns = createAction<[wsId: string, patterns: string[]]>(
  "fileExplorer/setGitignorePatterns",
);

export const setGitStatusMap = createAction<[wsId: string, gitStatus: Record<string, FileGitStatus>]>(
  "fileExplorer/setGitStatusMap",
);

export const setAgentFileEditsAction = createAction<
  [wsId: string, edits: Record<string, string[]>]
>("fileExplorer/setAgentFileEdits");

/**
 * Shallow-merge per-entry git-status updates into ws.gitStatus.
 * - No-op (returns identical state ref) when every provided key's value deep-equals existing.
 * - Does NOT increment treeVersion — selectors recompute off the gitStatus reference.
 * - Keys absent from `entries` are NOT deleted; use removeGitStatusEntries for that.
 */
export const updateGitStatusEntries = createAction<
  [wsId: string, entries: Record<string, FileGitStatus>]
>("fileExplorer/updateGitStatusEntries");

/**
 * Remove the listed paths from ws.gitStatus.
 * No-op (returns identical state ref) when none of the paths exist.
 * Does NOT increment treeVersion.
 */
export const removeGitStatusEntries = createAction<[wsId: string, paths: string[]]>(
  "fileExplorer/removeGitStatusEntries",
);

/**
 * Shallow-merge per-entry agent-file-edits updates into ws.agentFileEdits.
 * Same no-op semantics as updateGitStatusEntries.
 */
export const updateAgentFileEditsEntries = createAction<
  [wsId: string, entries: Record<string, string[]>]
>("fileExplorer/updateAgentFileEditsEntries");

/**
 * Remove the listed paths from ws.agentFileEdits.
 * Same no-op semantics as removeGitStatusEntries.
 */
export const removeAgentFileEditsEntries = createAction<[wsId: string, paths: string[]]>(
  "fileExplorer/removeAgentFileEditsEntries",
);

export const addExpandedPath = createAction<[wsId: string, path: string]>(
  "fileExplorer/addExpandedPath",
);

export const removeExpandedPath = createAction<[wsId: string, path: string]>(
  "fileExplorer/removeExpandedPath",
);

export const clearExpandedPathsExceptRoot = createAction<[wsId: string]>(
  "fileExplorer/clearExpandedPathsExceptRoot",
);

export const addLoadingPath = createAction<[wsId: string, path: string]>(
  "fileExplorer/addLoadingPath",
);

export const removeLoadingPath = createAction<[wsId: string, path: string]>(
  "fileExplorer/removeLoadingPath",
);

export const setBulkOperation = createAction<[wsId: string, isBulk: boolean]>(
  "fileExplorer/setBulkOperation",
);

export const incrementTreeVersion = createAction<[wsId: string]>(
  "fileExplorer/incrementTreeVersion",
);



export const setFileExplorerWorkspacePath = createAction<[wsId: string, path: string]>(
  "fileExplorer/setWorkspacePath",
);

export const setFileExplorerFileCount = createAction<[wsId: string, count: number]>(
  "fileExplorer/setFileCount",
);

export const setEnvironmentConfigAction = createAction<
  [wsId: string, config: EnvironmentConfig | undefined]
>("fileExplorer/setEnvironmentConfig");

export const setRemoteConnectionIdAction = createAction<[wsId: string, id: string | null]>(
  "fileExplorer/setRemoteConnectionId",
);

export const setIsRemoteInitializedAction = createAction<[wsId: string, value: boolean]>(
  "fileExplorer/setIsRemoteInitialized",
);

export const setIsStoreActive = createAction<[wsId: string, value: boolean]>(
  "fileExplorer/setIsStoreActive",
);

export const clearFileExplorerForWorkspace = createAction<[wsId: string]>(
  "fileExplorer/clearForWorkspace",
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

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const fileExplorerReducer = createReducer<FileExplorerState>(initialState)
  .with(clearFileExplorerForWorkspace, (state, { payload: [wsId] }) =>
    clearWorkspaceState(state, wsId),
  )
  .with(setFileExplorerLoading, (state, { payload: [wsId, isLoading] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.isLoading === isLoading) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      isLoading,
      ...(isLoading ? { error: null } : {}),
    });
  })
  .with(setFileExplorerError, (state, { payload: [wsId, error] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, error });
  })
  .with(setFileExplorerInitialized, (state, { payload: [wsId, isInitialized] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, isInitialized });
  })
  .with(setRootNode, (state, { payload: [wsId, rootNode] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, rootNode, treeVersion: ws.treeVersion + 1 });
  })
  .with(setChildrenAtPathAction, (state, { payload: [wsId, parentPath, children] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!ws.rootNode) return state;
    const newRoot = setChildrenAtPath(ws.rootNode, parentPath, children);
    return setWorkspaceState(state, wsId, {
      ...ws,
      rootNode: newRoot,
      treeVersion: ws.treeVersion + 1,
    });
  })
  .with(setGitignorePatterns, (state, { payload: [wsId, patterns] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, gitignorePatterns: patterns });
  })
  .with(setGitStatusMap, (state, { payload: [wsId, gitStatus] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, gitStatus });
  })
  .with(setAgentFileEditsAction, (state, { payload: [wsId, edits] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, agentFileEdits: edits });
  })
  .with(updateGitStatusEntries, (state, { payload: [wsId, entries] }) => {
    const ws = getWorkspaceState(state, wsId);
    const gitStatus = mergeRecordEntries(ws.gitStatus, entries, shallowEqual);
    if (gitStatus === ws.gitStatus) return state;
    return setWorkspaceState(state, wsId, { ...ws, gitStatus });
  })
  .with(removeGitStatusEntries, (state, { payload: [wsId, paths] }) => {
    const ws = getWorkspaceState(state, wsId);
    const gitStatus = removeRecordKeys(ws.gitStatus, paths);
    if (gitStatus === ws.gitStatus) return state;
    return setWorkspaceState(state, wsId, { ...ws, gitStatus });
  })
  .with(updateAgentFileEditsEntries, (state, { payload: [wsId, entries] }) => {
    const ws = getWorkspaceState(state, wsId);
    const agentFileEdits = mergeRecordEntries(ws.agentFileEdits, entries, shallowEqual);
    if (agentFileEdits === ws.agentFileEdits) return state;
    return setWorkspaceState(state, wsId, { ...ws, agentFileEdits });
  })
  .with(removeAgentFileEditsEntries, (state, { payload: [wsId, paths] }) => {
    const ws = getWorkspaceState(state, wsId);
    const agentFileEdits = removeRecordKeys(ws.agentFileEdits, paths);
    if (agentFileEdits === ws.agentFileEdits) return state;
    return setWorkspaceState(state, wsId, { ...ws, agentFileEdits });
  })
  .with(addExpandedPath, (state, { payload: [wsId, path] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.expandedPaths.includes(path)) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      expandedPaths: [...ws.expandedPaths, path],
      treeVersion: ws.treeVersion + 1,
    });
  })
  .with(removeExpandedPath, (state, { payload: [wsId, path] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!ws.expandedPaths.includes(path)) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      expandedPaths: ws.expandedPaths.filter((p) => p !== path),
      treeVersion: ws.treeVersion + 1,
    });
  })
  .with(clearExpandedPathsExceptRoot, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    const rootPath = ws.workspacePath;
    return setWorkspaceState(state, wsId, {
      ...ws,
      expandedPaths: rootPath ? [rootPath] : [],
      treeVersion: ws.treeVersion + 1,
    });
  })
  .with(addLoadingPath, (state, { payload: [wsId, path] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.loadingPaths.includes(path)) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      loadingPaths: [...ws.loadingPaths, path],
      treeVersion: ws.treeVersion + 1,
    });
  })
  .with(removeLoadingPath, (state, { payload: [wsId, path] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      loadingPaths: ws.loadingPaths.filter((p) => p !== path),
      treeVersion: ws.treeVersion + 1,
    });
  })
  .with(setBulkOperation, (state, { payload: [wsId, isBulk] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, isBulkOperation: isBulk });
  })
  .with(incrementTreeVersion, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, treeVersion: ws.treeVersion + 1 });
  })
  .with(setFileExplorerWorkspacePath, (state, { payload: [wsId, path] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.workspacePath === path) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      workspacePath: path,
      rootNode: null,
      expandedPaths: [],
      loadingPaths: [],
      error: null,
      treeVersion: ws.treeVersion + 1,
    });
  })
  .with(setFileExplorerFileCount, (state, { payload: [wsId, count] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, fileCount: count });
  })
  .with(setEnvironmentConfigAction, (state, { payload: [wsId, config] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      environmentConfig: config,
      isRemoteInitialized: false,
      remoteConnectionId: null,
    });
  })
  .with(setRemoteConnectionIdAction, (state, { payload: [wsId, id] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, remoteConnectionId: id });
  })
  .with(setIsRemoteInitializedAction, (state, { payload: [wsId, value] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, isRemoteInitialized: value });
  })
  .with(setIsStoreActive, (state, { payload: [wsId, value] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, isStoreActive: value });
  });