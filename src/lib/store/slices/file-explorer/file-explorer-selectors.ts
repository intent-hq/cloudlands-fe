import { store } from "../../store";
import type { FileNode, FileGitStatus } from "$shared/types";
import { shallowEqual } from "fast-equals";
import { stripWorkspacePrefix } from "$lib/utils/file-utils";
import { emptyFileExplorerWorkspaceState } from "./file-explorer-slice";
import type { FileExplorerWorkspaceState, FlattenedFileNode } from "./file-explorer-types";
import { flattenVisibleNodes } from "./file-explorer-utils";

// ---------------------------------------------------------------------------
// Per-workspace state selector
// ---------------------------------------------------------------------------

export const selectFileExplorerState = store.createSelector<[wsId: string], FileExplorerWorkspaceState>(
  (state, wsId) => {
    return state.fileExplorer.byWorkspaceId[wsId] ?? emptyFileExplorerWorkspaceState;
  },
);

// ---------------------------------------------------------------------------
// Individual field selectors
// ---------------------------------------------------------------------------

export const selectFileExplorerRootNode = store.createSelector<[wsId: string], FileNode | null>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).rootNode,
);

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

export const selectFileExplorerWorkspacePath = store.createSelector<[wsId: string], string>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).workspacePath,
);

export const selectFileExplorerIsBulkOperation = store.createSelector<[wsId: string], boolean>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).isBulkOperation,
);

export const selectFileExplorerIsStoreActive = store.createSelector<[wsId: string], boolean>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).isStoreActive,
);

export const selectFileExplorerExpandedPaths = store.createSelector<[wsId: string], string[]>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).expandedPaths,
);

export const selectFileExplorerLoadingPaths = store.createSelector<[wsId: string], string[]>(
  (state, wsId) => selectFileExplorerState.select(state, wsId).loadingPaths,
);

export const selectFileExplorerIsRemoteWorkspace = store.createSelector<[wsId: string], boolean>(
  (state, wsId) =>
    selectFileExplorerState.select(state, wsId).environmentConfig?.type === "remote",
);

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

/**
 * Per-row memoization cache for selectFlattenedNodes. Keyed by the underlying
 * FileNode reference. The cache is implicitly invalidated whenever a FileNode
 * is replaced by setRootNode or setChildrenAtPathAction (those actions produce
 * a new FileNode object for the affected subtree, giving a new WeakMap key).
 *
 * A single shared WeakMap is safe across workspaces — FileNode identities are
 * unique per workspace's tree.
 */
interface FlattenedNodeCacheEntry {
  inputs: {
    isExpanded: boolean;
    isLoading: boolean;
    agentEdits: string[] | undefined;
    gitStatus: FileGitStatus | undefined;
    directoryHasChanges: boolean;
    displayPath: string | undefined;
    depth: number;
  };
  result: FlattenedFileNode;
}

const flattenedNodeCache = new WeakMap<FileNode, FlattenedNodeCacheEntry>();

/**
 * Computed flattened nodes for virtualized rendering.
 * Depends on rootNode, expandedPaths, loadingPaths, agentFileEdits, and gitStatus.
 * Enriches each flattened node with agentEdits, gitStatus (files only), and
 * directoryHasChanges (directories only) derived from the workspace-level records.
 *
 * Each produced FlattenedFileNode has stable object identity across dispatches
 * when its per-row inputs (isExpanded, isLoading, gitStatus[relPath],
 * agentFileEdits[relPath], directoryHasChanges, displayPath) are unchanged.
 * Only the outer array identity may change.
 */
export const selectFlattenedNodes = store.createSelector<[wsId: string], FlattenedFileNode[]>(
  (state, wsId) => {
    const ws = selectFileExplorerState.select(state, wsId);
    if (!ws.rootNode || !ws.rootNode.children) return [];
    const expandedSet = new Set(ws.expandedPaths);
    const loadingSet = new Set(ws.loadingPaths);
    const flattened = flattenVisibleNodes(ws.rootNode.children, expandedSet, loadingSet);
    const { agentFileEdits, workspacePath, gitStatus } = ws;

    // Precompute the set of directory paths that contain at least one changed
    // file. Walking up each changed-file path adds every ancestor directory
    // once, so the per-node directory rollup check below is O(1).
    const changedDirs = new Set<string>();
    for (const filePath of Object.keys(gitStatus)) {
      const parts = filePath.split("/");
      for (let i = 1; i < parts.length; i++) {
        changedDirs.add(parts.slice(0, i).join("/"));
      }
    }

    return flattened.map((flatNode) => {
      let relativePath = flatNode.node.path;
      if (workspacePath) {
        const stripped = stripWorkspacePrefix(flatNode.node.path, workspacePath);
        if (stripped !== flatNode.node.path) relativePath = stripped;
      }
      const isFile = flatNode.node.type === "file";
      const edits = agentFileEdits[relativePath];
      const fileGitStatus = isFile ? gitStatus[relativePath] : undefined;
      const dirHasChanges = !isFile && changedDirs.has(relativePath);

      const nextInputs: FlattenedNodeCacheEntry["inputs"] = {
        isExpanded: flatNode.isExpanded,
        isLoading: flatNode.isLoading,
        agentEdits: edits && edits.length > 0 ? edits : undefined,
        gitStatus: fileGitStatus,
        directoryHasChanges: dirHasChanges,
        displayPath: flatNode.displayPath,
        depth: flatNode.depth,
      };

      const cached = flattenedNodeCache.get(flatNode.node);
      if (cached && shallowEqual(cached.inputs, nextInputs)) {
        return cached.result;
      }

      const enriched: FlattenedFileNode =
        (edits && edits.length > 0) || fileGitStatus !== undefined || dirHasChanges
          ? {
              node: flatNode.node,
              depth: flatNode.depth,
              displayPath: flatNode.displayPath,
              isExpanded: flatNode.isExpanded,
              isLoading: flatNode.isLoading,
              ...(edits && edits.length > 0 ? { agentEdits: edits } : {}),
              ...(fileGitStatus !== undefined ? { gitStatus: fileGitStatus } : {}),
              ...(dirHasChanges ? { directoryHasChanges: true } : {}),
            }
          : flatNode;

      flattenedNodeCache.set(flatNode.node, { inputs: nextInputs, result: enriched });
      return enriched;
    });
  },
);


