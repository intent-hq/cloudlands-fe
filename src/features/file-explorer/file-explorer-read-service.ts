/**
 * File-explorer read service — the sanctioned post-saga directory-listing mechanism.
 *
 * The `toggleDirectoryRequested` / `expandToPathRequested` / `expandAllRequested`
 * / `refreshFileExplorer` triggers lost their handler when the saga runtime was
 * removed (they used to live in `sagas/file-explorer-saga.ts`), so expanding a
 * directory or hitting refresh became a no-op and children never loaded. This
 * restores the read path WITHOUT re-adding a saga and WITHOUT changing any call
 * site: `createFileExplorerReadMiddleware()` observes every dispatched action and,
 * on those triggers, lists the relevant directories via the `appClient.files`
 * seam (`file.list` per directory) and dispatches `setChildrenAtPathAction`.
 *
 * READ-ONLY: this module never invokes a file mutation (no write/delete/mkdir).
 *
 * BE gap: the daemon exposes no `file.tree` endpoint, so `explorerTree` resolves
 * to `null` and the ROOT tree never initializes (see `live-files-client.ts`).
 * Every handler here is gated on an existing root (`rootPath`/`workspacePath`);
 * with no root there is nothing to expand or refresh. This service lists deeper
 * levels on demand but does NOT fabricate the root tree.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam, the
 * configured store, the slice actions/empty-state, pure path/collection utils, and
 * the logger (NOT selectors — importing them would evaluate `store.createSelector`
 * while the store module is still mid-initialization through the middleware chain).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import type { FileNode } from "$shared/types";
import { getItem } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { stripWorkspacePrefix } from "$lib/utils/file-utils";
import {
  addExpandedPath,
  addLoadingPath,
  emptyFileExplorerWorkspaceState,
  expandAllRequested,
  expandToPathRequested,
  incrementTreeVersion,
  refreshFileExplorer,
  removeExpandedPath,
  removeLoadingPath,
  setBulkOperation,
  setChildrenAtPathAction,
  setFileExplorerLoading,
  toggleDirectoryRequested,
} from "$store/renderer/slices/file-explorer/file-explorer-slice";
import type { FileExplorerWorkspaceState } from "$store/renderer/slices/file-explorer/file-explorer-types";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("FileExplorerReadService");

/** Read the current (post-reducer) workspace state, or the empty default. */
function getWs(wsId: string): FileExplorerWorkspaceState {
  return appStore.state.fileExplorer.byWorkspaceId[wsId] ?? emptyFileExplorerWorkspaceState;
}

/** The single directory child of a listing, used to auto-chain single-child dirs. */
function onlyDirectoryChild(children: readonly FileNode[]): FileNode | null {
  if (children.length !== 1) return null;
  return children[0].type === "directory" ? children[0] : null;
}

/**
 * List one directory's immediate children through the seam and merge them into
 * the tree. The seam takes a workspace-relative path; children are re-anchored to
 * the parent's absolute path so collection identity stays consistent regardless
 * of the path shape the daemon returns. Resolves the (absolute) children.
 */
async function loadDirectoryChildren(wsId: string, dirPath: string): Promise<FileNode[]> {
  const relPath = stripWorkspacePrefix(dirPath, getWs(wsId).workspacePath);
  appStore.dispatch(addLoadingPath(wsId, dirPath));
  try {
    const raw = await appClient.files.listDirectory(wsId, relPath);
    const children = raw.map((node) => ({
      ...node,
      path: `${dirPath}/${node.name}`,
      ...(node.type === "directory" ? { children: node.children ?? [] } : {}),
    }));
    appStore.dispatch(setChildrenAtPathAction(wsId, dirPath, children));
    return children;
  } catch (error) {
    logger.error("Failed to load directory children", error);
    return [];
  } finally {
    appStore.dispatch(removeLoadingPath(wsId, dirPath));
  }
}

/** Collapse if already expanded; otherwise expand and (re)load children. */
export async function toggleDirectory(wsId: string, nodePath: string): Promise<void> {
  if (getWs(wsId).expandedPaths.includes(nodePath)) {
    appStore.dispatch(removeExpandedPath(wsId, nodePath));
    return;
  }
  appStore.dispatch(addExpandedPath(wsId, nodePath));

  const visited = new Set<string>([nodePath]);
  let current = nodePath;
  while (true) {
    const children = await loadDirectoryChildren(wsId, current);
    const next = onlyDirectoryChild(children);
    if (!next || visited.has(next.path)) return;
    current = next.path;
    visited.add(current);
    if (!getWs(wsId).expandedPaths.includes(current)) {
      appStore.dispatch(addExpandedPath(wsId, current));
    }
  }
}

/** Expand every ancestor directory of `targetPath`, loading children as needed. */
export async function expandToPath(wsId: string, targetPath: string): Promise<void> {
  const ws = getWs(wsId);
  if (!ws.workspacePath) return;
  const parts = stripWorkspacePrefix(targetPath, ws.workspacePath).split("/").filter(Boolean);
  let current = ws.workspacePath;
  appStore.dispatch(setBulkOperation(wsId, true));
  try {
    for (let i = 0; i < parts.length; i++) {
      current = `${current}/${parts[i]}`;
      const isFile = i === parts.length - 1 && !targetPath.endsWith("/");
      if (isFile) continue;
      const fresh = getWs(wsId);
      if (fresh.expandedPaths.includes(current)) continue;
      appStore.dispatch(addExpandedPath(wsId, current));
      const node = getItem(fresh.nodes, current);
      if (!node || node.type !== "directory" || node.children.length === 0) {
        await loadDirectoryChildren(wsId, current);
      }
    }
  } finally {
    appStore.dispatch(setBulkOperation(wsId, false));
    appStore.dispatch(incrementTreeVersion(wsId));
  }
}
