import type { FileNode, FileGitStatus, EnvironmentConfig } from "$shared/types";
import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import type { FileExplorerWorkspaceState, FileExplorerState } from "./file-explorer-types";
import {
  setChildrenAtPath,
  applyGitStatusToTree,
} from "./file-explorer-utils";

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

export const refreshGitStatusRequested = createAction<[wsId: string]>(
  "fileExplorer/refreshGitStatusRequested",
);

export const syncGitStatusFromStoresRequested = createAction<[wsId: string]>(
  "fileExplorer/syncGitStatusFromStoresRequested",
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

export const applyGitStatusToTreeAction = createAction<[wsId: string]>(
  "fileExplorer/applyGitStatusToTree",
);

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
  })
  .with(applyGitStatusToTreeAction, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!ws.rootNode) return state;
    const updatedRoot = applyGitStatusToTree(ws.rootNode, ws.gitStatus, ws.workspacePath);
    if (!updatedRoot) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      rootNode: updatedRoot,
      treeVersion: ws.treeVersion + 1,
    });
  });