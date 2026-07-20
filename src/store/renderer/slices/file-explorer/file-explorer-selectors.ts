import { store } from "../../store";
import type { EnvironmentConfig, FileGitStatus } from "$shared/types";
import { shallowEqual } from "fast-equals";
import { stripWorkspacePrefix } from "$lib/utils/file-utils";
import { emptyFileExplorerWorkspaceState } from "./file-explorer-slice";
import type {
  FileExplorerTreeNode,
  FileExplorerWorkspaceState,
  FlattenedFileNode,
} from "./file-explorer-types";
import { flattenVisibleNodes } from "./file-explorer-utils";
import { getItem } from "$lib/store-shim/utils/collections/collection-utils";
import {
  selectWorkspaceById,
  selectWorkspaceEnvironmentConfig,
} from "../workspace/workspace-selectors";

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

export const selectFileExplorerRootNode = store.createSelector<
  [wsId: string],
  FileExplorerTreeNode | null
>(
  (state, wsId) => {
    const ws = selectFileExplorerState.select(state, wsId);
    return ws.rootPath ? getItem(ws.nodes, ws.rootPath) ?? null : null;
  },
);

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

export const selectEffectiveFileExplorerWorkspacePath = store.createSelector<[wsId: string], string>(
  (state, wsId) => {
    const workspace = selectWorkspaceById.select(state, wsId);
    return workspace?.worktreePath || workspace?.repositoryPath || workspace?.path || "";
  },
);

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
      workspacePath: "",
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

  return workspaceEnvironmentConfig?.type === "remote" && !currentState.isRemoteInitialized;
});

/**
 * Per-row memoization cache for selectFlattenedNodes. Keyed by the underlying
 * normalized FileExplorerTreeNode reference. The cache is implicitly invalidated
 * whenever a node is replaced by setRootNode or setChildrenAtPathAction (those
 * actions produce a new object for the affected subtree, giving a new WeakMap key).
 *
 * A single shared WeakMap is safe across workspaces — normalized node identities are
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
    compactedExpandedPathsKey: string | undefined;
    depth: number;
  };
  result: FlattenedFileNode;
}

const flattenedNodeCache = new WeakMap<FileExplorerTreeNode, FlattenedNodeCacheEntry>();

/**
 * Computed flattened nodes for virtualized rendering.
 * Depends on normalized nodes, expandedPaths, loadingPaths, agentFileEdits, and gitStatus.
 * Enriches each flattened node with agentEdits, gitStatus (files only), and
 * directoryHasChanges (directories only) derived from the workspace-level records.
 *
 * Each produced FlattenedFileNode has stable object identity across dispatches
 * when its per-row inputs (isExpanded, isLoading, gitStatus[relPath],
 * agentFileEdits[relPath], directoryHasChanges, displayPath,
 * compactedExpandedPaths) are unchanged.
 * Only the outer array identity may change.
 */
export const selectFlattenedNodes = store.createSelector<[wsId: string], FlattenedFileNode[]>(
  (state, wsId) => {
    const ws = selectFileExplorerState.select(state, wsId);
    if (!ws.rootPath) return [];
    const rootNode = getItem(ws.nodes, ws.rootPath);
    if (!rootNode) return [];
    const expandedSet = new Set(ws.expandedPaths);
    const loadingSet = new Set(ws.loadingPaths);
    const flattened = flattenVisibleNodes(ws.nodes, rootNode.children, expandedSet, loadingSet);
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
        compactedExpandedPathsKey: flatNode.compactedExpandedPaths?.join("\u0000"),
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
              ...(flatNode.compactedExpandedPaths
                ? { compactedExpandedPaths: flatNode.compactedExpandedPaths }
                : {}),
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


