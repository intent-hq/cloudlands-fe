import { store } from '../../store';
import type { EnvironmentConfig, FileGitStatus } from '$shared/types';
import type {
  FileExplorerTreeNode,
  FileExplorerWorkspaceState,
  FlattenedFileNode,
} from './file-explorer-types';
import { projectFileExplorerState, projectFlattenedNodes } from './file-explorer-projections';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import {
  selectWorkspaceById,
  selectWorkspaceEnvironmentConfig,
} from '../workspace/workspace-selectors';

// ---------------------------------------------------------------------------
// Per-workspace state selector
// ---------------------------------------------------------------------------

export const selectFileExplorerState = store.createSelector<
  [wsId: string],
  FileExplorerWorkspaceState
>((state, wsId) => {
  return projectFileExplorerState(state.fileExplorer, wsId);
});

export const selectFileExplorerSearch = store.createSelector(
  (state, wsId: string, consumerId: string) => {
    const search = getItem(state.fileExplorer.searches, consumerId);
    return search?.workspaceId === wsId ? search : undefined;
  },
);

// ---------------------------------------------------------------------------
// Individual field selectors
// ---------------------------------------------------------------------------

export const selectFileExplorerRootNode = store.createSelector<
  [wsId: string],
  FileExplorerTreeNode | null
>((state, wsId) => {
  const ws = selectFileExplorerState.select(state, wsId);
  return ws.rootPath ? (getItem(ws.nodes, ws.rootPath) ?? null) : null;
});

export const selectFileExplorerNodeMap = store.createSelector<
  [wsId: string],
  Record<string, FileExplorerTreeNode>
>((state, wsId) => selectFileExplorerState.select(state, wsId).nodes.map);

export const selectFileExplorerIsLoading = store.createSelector<[wsId: string], boolean>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).isLoading,
);

export const selectFileExplorerIsInitialized = store.createSelector<[wsId: string], boolean>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).isInitialized,
);

export const selectFileExplorerError = store.createSelector<[wsId: string], string | null>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).error,
);

export const selectFileExplorerFileCount = store.createSelector<[wsId: string], number>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).fileCount,
);

export const selectFileExplorerGitStatus = store.createSelector<
  [wsId: string],
  Record<string, FileGitStatus>
>((state, wsId) => selectFileExplorerState.select(state, wsId).gitStatus);

export const selectEffectiveFileExplorerWorkspacePath = store.createSelector<
  [wsId: string],
  string
>((state, wsId) => {
  const workspace = selectWorkspaceById.select(state, wsId);
  return workspace?.worktreePath || workspace?.repositoryPath || workspace?.path || '';
});

export interface FileExplorerInitializationInputs {
  workspacePath: string;
  currentWorkspacePath: string;
  isLoading: boolean;
  isInitialized: boolean;
}

export const selectFileExplorerInitializationInputs = store.createSelector<
  [wsId: string],
  FileExplorerInitializationInputs
>((state, wsId) => {
  const currentState = selectFileExplorerState.select(state, wsId);
  return {
    workspacePath: selectEffectiveFileExplorerWorkspacePath.select(state, wsId),
    currentWorkspacePath: currentState.workspacePath,
    isLoading: currentState.isLoading,
    isInitialized: currentState.isInitialized,
  };
});

export interface FileExplorerEnvironmentConfigTrigger {
  wsId: string | null;
  workspacePath: string;
  workspaceEnvironmentConfig: EnvironmentConfig | undefined;
}

export const selectFileExplorerEnvironmentConfigTrigger = store.createSelector<
  [wsId: string | null],
  FileExplorerEnvironmentConfigTrigger
>((state, wsId) => {
  if (!wsId) {
    return {
      wsId: null,
      workspacePath: '',
      workspaceEnvironmentConfig: undefined,
    };
  }

  return {
    wsId,
    workspacePath: selectEffectiveFileExplorerWorkspacePath.select(state, wsId),
    workspaceEnvironmentConfig: selectWorkspaceEnvironmentConfig.select(state, wsId),
  };
});

// ---------------------------------------------------------------------------
// Derived selectors
// ---------------------------------------------------------------------------

export const selectIsPathExpanded = store.createSelector<[wsId: string, path: string], boolean>(
  (state, wsId, path) => selectFileExplorerState.select(state, wsId).expandedPaths.includes(path),
);

export const selectIsPathLoading = store.createSelector<[wsId: string, path: string], boolean>(
  (state, wsId, path) => selectFileExplorerState.select(state, wsId).loadingPaths.includes(path),
);

export const selectHasExpandedDirectories = store.createSelector<[wsId: string], boolean>(
  (state, wsId) => {
    const ws = selectFileExplorerState.select(state, wsId);
    return ws.expandedPaths.some((p) => p !== ws.workspacePath);
  },
);

export const selectShouldInitializeFileExplorerForWorkspace = store.createSelector<
  [wsId: string],
  boolean
>((state, wsId) => {
  const workspacePath = selectEffectiveFileExplorerWorkspacePath.select(state, wsId);
  if (!workspacePath) return false;

  const currentState = selectFileExplorerState.select(state, wsId);
  const workspaceEnvironmentConfig = selectWorkspaceEnvironmentConfig.select(state, wsId);

  if (currentState.workspacePath !== workspacePath) return true;

  if (currentState.isLoading) return false;

  if (!currentState.isInitialized) return true;

  return workspaceEnvironmentConfig?.type === 'remote' && !currentState.isRemoteInitialized;
});

export const selectFlattenedNodes = store.createSelector<[wsId: string], FlattenedFileNode[]>(
  (state, wsId) => projectFlattenedNodes(selectFileExplorerState.select(state, wsId)),
);
