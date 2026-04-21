import type { FileNode, FileGitStatus } from "$shared/types";
import { stripWorkspacePrefix } from "$lib/utils/file-utils";
import { createSelector } from "../../utils/create-selector";
import { emptyFileExplorerWorkspaceState } from "./file-explorer-slice";
import type { FileExplorerWorkspaceState, FlattenedFileNode } from "./file-explorer-types";
import { flattenVisibleNodes } from "./file-explorer-utils";

// ---------------------------------------------------------------------------
// Per-workspace state selector
// ---------------------------------------------------------------------------

export const selectFileExplorerState = createSelector<[wsId: string], FileExplorerWorkspaceState>(
  (state, wsId) => {
    return state.fileExplorer.byWorkspaceId[wsId] ?? emptyFileExplorerWorkspaceState;
  },
);

// ---------------------------------------------------------------------------
// Individual field selectors
// ---------------------------------------------------------------------------

export const selectFileExplorerRootNode = createSelector<[wsId: string], FileNode | null>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).rootNode,
);

export const selectFileExplorerIsLoading = createSelector<[wsId: string], boolean>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).isLoading,
);

export const selectFileExplorerIsInitialized = createSelector<[wsId: string], boolean>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).isInitialized,
);

export const selectFileExplorerError = createSelector<[wsId: string], string | null>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).error,
);

export const selectFileExplorerFileCount = createSelector<[wsId: string], number>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).fileCount,
);

export const selectFileExplorerGitStatus = createSelector<
  [wsId: string],
  Record<string, FileGitStatus>
>((state, wsId) => selectFileExplorerState.select(state, wsId).gitStatus);

export const selectFileExplorerWorkspacePath = createSelector<[wsId: string], string>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).workspacePath,
);

export const selectFileExplorerIsBulkOperation = createSelector<[wsId: string], boolean>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).isBulkOperation,
);

export const selectFileExplorerTreeVersion = createSelector<[wsId: string], number>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).treeVersion,
);

export const selectFileExplorerIsStoreActive = createSelector<[wsId: string], boolean>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).isStoreActive,
);

export const selectFileExplorerExpandedPaths = createSelector<[wsId: string], string[]>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).expandedPaths,
);

export const selectFileExplorerLoadingPaths = createSelector<[wsId: string], string[]>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).loadingPaths,
);

export const selectFileExplorerIsRemoteWorkspace = createSelector<[wsId: string], boolean>(
  (state, wsId) =>
    selectFileExplorerState.select(state, wsId).environmentConfig?.type === "remote",
);

// ---------------------------------------------------------------------------
// Derived selectors
// ---------------------------------------------------------------------------

export const selectIsPathExpanded = createSelector<[wsId: string, path: string], boolean>(
  (state, wsId, path) => selectFileExplorerState.select(state, wsId).expandedPaths.includes(path),
);

export const selectIsPathLoading = createSelector<[wsId: string, path: string], boolean>(
  (state, wsId, path) => selectFileExplorerState.select(state, wsId).loadingPaths.includes(path),
);

export const selectHasExpandedDirectories = createSelector<[wsId: string], boolean>(
  (state, wsId) => {
    const ws = selectFileExplorerState.select(state, wsId);
    return ws.expandedPaths.some((p) => p !== ws.workspacePath);
  },
);

/**
 * Computed flattened nodes for virtualized rendering.
 * Depends on rootNode, expandedPaths, loadingPaths, treeVersion, and agentFileEdits.
 * Enriches each flattened node with agentEdits derived from ws.agentFileEdits.
 */
export const selectFlattenedNodes = createSelector<[wsId: string], FlattenedFileNode[]>(
  (state, wsId) => {
    const ws = selectFileExplorerState.select(state, wsId);
    // Read treeVersion to create a dependency for recomputation
    void ws.treeVersion;
    if (!ws.rootNode || !ws.rootNode.children) return [];
    const expandedSet = new Set(ws.expandedPaths);
    const loadingSet = new Set(ws.loadingPaths);
    const flattened = flattenVisibleNodes(ws.rootNode.children, expandedSet, loadingSet);
    const { agentFileEdits, workspacePath } = ws;
    return flattened.map((flatNode) => {
      let relativePath = flatNode.node.path;
      if (workspacePath) {
        const stripped = stripWorkspacePrefix(flatNode.node.path, workspacePath);
        if (stripped !== flatNode.node.path) relativePath = stripped;
      }
      const edits = agentFileEdits[relativePath];
      if (edits && edits.length > 0) {
        return { ...flatNode, agentEdits: edits };
      }
      return flatNode;
    });
  },
);

