import { shallowEqual } from 'fast-equals';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import type { FileGitStatus } from '$shared/types';
import { emptyFileExplorerWorkspaceState } from './file-explorer-slice';
import type {
  FileExplorerState,
  FileExplorerSearch,
  FileExplorerTreeNode,
  FileExplorerWorkspaceState,
  FlattenedFileNode,
} from './file-explorer-types';
import { flattenVisibleNodes } from './file-explorer-utils';

export function getFileSearch(
  state: FileExplorerState,
  wsId: string,
  consumerId: string,
  context?: string,
): FileExplorerSearch | undefined {
  const search = getItem(state.searches, consumerId);
  return search?.workspaceId === wsId && (context === undefined || search.context === context)
    ? search
    : undefined;
}

export function projectFileExplorerState(
  state: FileExplorerState,
  wsId: string,
): FileExplorerWorkspaceState {
  return state.byWorkspaceId[wsId] ?? emptyFileExplorerWorkspaceState;
}

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
 * compactedExpandedPaths) are unchanged. The Store-created readable shallow-retains
 * the outer array when every row retains its identity.
 */
export function projectFlattenedNodes(
  ws: FileExplorerWorkspaceState,
  compactChains = true,
): FlattenedFileNode[] {
  if (!ws.rootPath) return [];
  const rootNode = getItem(ws.nodes, ws.rootPath);
  if (!rootNode) return [];
  const expandedSet = new Set(ws.expandedPaths);
  const loadingSet = new Set(ws.loadingPaths);
  const flattened = flattenVisibleNodes(
    ws.nodes,
    rootNode.children,
    expandedSet,
    loadingSet,
    0,
    '',
    [],
    [],
    compactChains,
  );
  const { agentFileEdits, workspacePath, gitStatus } = ws;

  // Precompute the set of directory paths that contain at least one changed
  // file. Walking up each changed-file path adds every ancestor directory
  // once, so the per-node directory rollup check below is O(1).
  const changedDirs = new Set<string>();
  for (const filePath of Object.keys(gitStatus)) {
    const parts = filePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      changedDirs.add(parts.slice(0, i).join('/'));
    }
  }

  return flattened.map((flatNode) => {
    let relativePath = flatNode.node.path;
    if (workspacePath) {
      const stripped = stripWorkspacePrefix(flatNode.node.path, workspacePath);
      if (stripped !== flatNode.node.path) relativePath = stripped;
    }
    const isFile = flatNode.node.type === 'file';
    const edits = agentFileEdits[relativePath];
    const fileGitStatus = isFile ? gitStatus[relativePath] : undefined;
    const dirHasChanges = !isFile && changedDirs.has(relativePath);

    const nextInputs: FlattenedNodeCacheEntry['inputs'] = {
      isExpanded: flatNode.isExpanded,
      isLoading: flatNode.isLoading,
      agentEdits: edits && edits.length > 0 ? edits : undefined,
      gitStatus: fileGitStatus,
      directoryHasChanges: dirHasChanges,
      displayPath: flatNode.displayPath,
      compactedExpandedPathsKey: flatNode.compactedExpandedPaths?.join('\u0000'),
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
}
