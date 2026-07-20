/**
 * File-explorer read service — the sanctioned post-saga directory-listing mechanism.
 *
 * The `initializeFileExplorer` / `toggleDirectoryRequested` / `expandToPathRequested`
 * / `expandAllRequested` / `refreshFileExplorer` / `refreshDirectoryRequested`
 * triggers lost their handler when the saga runtime was removed (they used to live
 * in `sagas/file-explorer-saga.ts`). This restores the read path WITHOUT re-adding
 * a saga and WITHOUT changing any call site: `createFileExplorerReadMiddleware()`
 * observes every dispatched action and, on those triggers, lists the relevant
 * directories via the `appClient.files` seam (`file.tree` for the root,
 * `file.list` per directory) and dispatches `setRootNode` / `setChildrenAtPathAction`.
 *
 * It also restores the agent file-edit badge pipeline (the old saga's
 * `loadAgentFileEditsSaga`): on init / refresh / `refreshAgentFileEditsRequested`
 * / `syncGitStatusFromStoresRequested` it pulls agent-authored `file:changed` /
 * `file:created` events from the daemon via `getAgentFileEdits` (which reads
 * `appClient.events.query` — `event.query`, PROTOCOL §5.10), propagates them to
 * parent directories, and dispatches `updateAgentFileEditsEntries` /
 * `removeAgentFileEditsEntries` so file-tree badges render.
 *
 * READ-ONLY: this module never invokes a file mutation (no write/delete/mkdir).
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam, the
 * configured store, the slice actions/empty-state, pure path/collection utils, and
 * the logger (NOT selectors — importing them would evaluate `store.createSelector`
 * while the store module is still mid-initialization through the middleware chain).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import type { FileNode } from "$shared/types";
import { getItem } from "$lib/store-shim/utils/collections/collection-utils";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { stripWorkspacePrefix } from "$lib/utils/file-utils";
import {
  getAgentFileEdits,
  propagateAgentEditsToParents,
} from "$lib/utils/agent-file-edits";
import {
  addExpandedPath,
  addLoadingPath,
  emptyFileExplorerWorkspaceState,
  expandAllRequested,
  expandToPathRequested,
  hydrateFileExplorerRequested,
  incrementTreeVersion,
  initializeFileExplorer,
  refreshAgentFileEditsRequested,
  refreshDirectoryRequested,
  refreshFileExplorer,
  removeAgentFileEditsEntries,
  removeExpandedPath,
  removeLoadingPath,
  setBulkOperation,
  setChildrenAtPathAction,
  setFileExplorerFileCount,
  setFileExplorerInitialized,
  setFileExplorerLoading,
  setFileExplorerWorkspacePath,
  setGitStatusMap,
  setRootNode,
  syncGitStatusFromStoresRequested,
  toggleDirectoryRequested,
  updateAgentFileEditsEntries,
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

// ---------------------------------------------------------------------------
// Agent file-edit badges (ports the old saga's loadAgentFileEditsSaga /
// refreshAgentFileEditsForWorkspace)
// ---------------------------------------------------------------------------

/**
 * Per-workspace coalescing for in-flight badge refreshes: a refresh requested
 * while one is running marks it dirty, and exactly one replay runs afterwards
 * so the final state always reflects the latest daemon events.
 */
const agentFileEditsRefreshByWorkspace = new Map<
  string,
  { inProgress: boolean; dirty: boolean }
>();

/** Test-only — clear the coalescing state between suites. */
export function __resetAgentFileEditsRefreshStateForTests(): void {
  agentFileEditsRefreshByWorkspace.clear();
}

/**
 * Pull agent-authored file events from the daemon (`getAgentFileEdits` →
 * `appClient.events.query`, PROTOCOL §5.10), propagate them to parent
 * directories, and merge them into `ws.agentFileEdits`. Stale entries are
 * removed first so badges clear when the daemon no longer reports a file;
 * unchanged entries keep their array identity via the reducer's merge
 * semantics (per-row selector memoization depends on it).
 */
async function loadAgentFileEdits(wsId: string): Promise<void> {
  try {
    const editsMap = await getAgentFileEdits(wsId);
    const editsRecord: Record<string, string[]> = {};
    for (const [file, agents] of editsMap.entries()) {
      editsRecord[file] = agents;
    }
    const { workspacePath } = getWs(wsId);
    if (workspacePath) {
      const propagated = propagateAgentEditsToParents(editsMap, workspacePath, workspacePath);
      for (const [file, agents] of propagated.entries()) {
        if (!editsRecord[file]) {
          editsRecord[file] = agents;
        }
      }
    }
    const previous = getWs(wsId).agentFileEdits;
    const stalePaths = Object.keys(previous).filter((key) => !(key in editsRecord));
    if (stalePaths.length > 0) {
      appStore.dispatch(removeAgentFileEditsEntries(wsId, stalePaths));
    }
    if (Object.keys(editsRecord).length > 0) {
      appStore.dispatch(updateAgentFileEditsEntries(wsId, editsRecord));
    }
  } catch (error) {
    logger.error("Failed to load agent file edits", error);
  }
}

/** Refresh agent file-edit badges for a workspace, coalescing concurrent calls. */
export async function refreshAgentFileEditsForWorkspace(wsId: string): Promise<void> {
  if (!wsId) return;
  let refreshState = agentFileEditsRefreshByWorkspace.get(wsId);
  if (!refreshState) {
    refreshState = { inProgress: false, dirty: false };
    agentFileEditsRefreshByWorkspace.set(wsId, refreshState);
  }
  if (refreshState.inProgress) {
    refreshState.dirty = true;
    return;
  }
  refreshState.inProgress = true;
  try {
    await loadAgentFileEdits(wsId);
  } finally {
    const shouldReplay = refreshState.dirty;
    refreshState.inProgress = false;
    refreshState.dirty = false;
    if (shouldReplay) {
      await refreshAgentFileEditsForWorkspace(wsId);
    } else {
      agentFileEditsRefreshByWorkspace.delete(wsId);
    }
  }
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

/** Recursively expand a directory and its sub-directories up to `depthLimit`. */
async function expandNode(wsId: string, dirPath: string, depth: number, depthLimit: number): Promise<void> {
  if (depth >= depthLimit) return;
  const ws = getWs(wsId);
  const node = getItem(ws.nodes, dirPath);
  if (!node || node.type !== "directory") return;
  if (!ws.expandedPaths.includes(dirPath)) {
    appStore.dispatch(addExpandedPath(wsId, dirPath));
  }
  let childDirPaths: string[];
  if (node.children.length === 0) {
    const loaded = await loadDirectoryChildren(wsId, dirPath);
    childDirPaths = loaded.filter((c) => c.type === "directory").map((c) => c.path);
  } else {
    childDirPaths = node.children.filter((p) => getItem(ws.nodes, p)?.type === "directory");
  }
  for (const childPath of childDirPaths) {
    await expandNode(wsId, childPath, depth + 1, depthLimit);
  }
}

/** Expand the whole tree (depth-limited) starting from the root. */
export async function expandAll(wsId: string, maxDepth?: number): Promise<void> {
  const ws = getWs(wsId);
  if (!ws.rootPath) return;
  const root = getItem(ws.nodes, ws.rootPath);
  if (!root) return;
  appStore.dispatch(setBulkOperation(wsId, true));
  try {
    await expandNode(wsId, root.path, 0, maxDepth ?? 3);
  } finally {
    appStore.dispatch(setBulkOperation(wsId, false));
    appStore.dispatch(incrementTreeVersion(wsId));
  }
}

/**
 * Re-list the root and every currently-expanded directory through the seam. When
 * no root tree exists (`initializeFileExplorerTree` hasn't run for this workspace
 * yet) there is nothing to refresh, so this is a no-op rather than a silent failure.
 */
export async function refreshFileExplorerTree(wsId: string): Promise<void> {
  const ws = getWs(wsId);
  if (!ws.rootPath) return;
  appStore.dispatch(setFileExplorerLoading(wsId, true));
  try {
    const targets = [ws.rootPath, ...ws.expandedPaths.filter((p) => p !== ws.rootPath)];
    const seen = new Set<string>();
    for (const dirPath of targets) {
      if (seen.has(dirPath)) continue;
      seen.add(dirPath);
      const node = getItem(getWs(wsId).nodes, dirPath);
      if (!node || node.type !== "directory") continue;
      await loadDirectoryChildren(wsId, dirPath);
    }
  } finally {
    appStore.dispatch(setFileExplorerLoading(wsId, false));
  }
  await refreshAgentFileEditsForWorkspace(wsId);
}

/**
 * Compute the parent directory of an absolute path WITHIN the workspace. Returns
 * `null` when the path is outside the workspace or when there is no parent within
 * the workspace tree (a defensive guard matching the original saga behavior).
 */
function computeParentDir(filePath: string, workspacePath: string): string | null {
  if (!filePath || !workspacePath) return null;
  if (filePath === workspacePath) return null;
  if (filePath !== workspacePath && !filePath.startsWith(workspacePath + "/")) return null;
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  const parent = filePath.slice(0, lastSlash);
  if (parent !== workspacePath && !parent.startsWith(workspacePath + "/")) return null;
  return parent;
}

/**
 * Re-list a single directory in response to a file create/delete event. The caller
 * passes the PATH of the file that was created or deleted; the parent directory
 * is computed here. If the parent isn't in the loaded tree yet (lazy expansion
 * hasn't reached it), this is a no-op — the children will be fetched the next
 * time the user expands that directory.
 */
export async function handleRefreshDirectory(wsId: string, filePath: string): Promise<void> {
  const ws = getWs(wsId);
  if (!ws.workspacePath) return;
  const parentDir = computeParentDir(filePath, ws.workspacePath);
  if (!parentDir) return;
  const node = getItem(ws.nodes, parentDir);
  if (!node || node.type !== "directory") return;
  await loadDirectoryChildren(wsId, parentDir);
}

/**
 * Initialize the file explorer for a workspace: fetch the root tree via the seam
 * (`file.tree` PROTOCOL §5.9), re-anchor entries at the absolute workspace path
 * (the seam's synthetic root has an empty path), and dispatch the root node so
 * the Files tab renders. Idempotent: if the workspace is already initialized for
 * the same `workspacePath` it bails out, and a concurrent in-flight init is not
 * re-entered. Errors are logged and fold to "no root" (the tree stays empty)
 * rather than throwing into the store.
 */
export async function initializeFileExplorerTree(
  wsId: string,
  options: { workspacePath: string; workspaceId?: string },
): Promise<void> {
  const { workspacePath } = options;
  if (!workspacePath) return;

  const existing = getWs(wsId);
  if (existing.isLoading) return;
  if (existing.isInitialized && existing.workspacePath === workspacePath && existing.rootPath) {
    return;
  }

  appStore.dispatch(setFileExplorerWorkspacePath(wsId, workspacePath));
  appStore.dispatch(setFileExplorerLoading(wsId, true));

  try {
    const root = await appClient.files.explorerTree(wsId);
    if (root) {
      const rawChildren = root.children ?? [];
      const anchoredChildren: FileNode[] = rawChildren.map((child) => ({
        ...child,
        path: `${workspacePath}/${child.name}`,
        ...(child.type === "directory" ? { children: child.children ?? [] } : {}),
      }));
      const rootFileNode: FileNode = {
        name: workspacePath.split("/").pop() || workspacePath,
        path: workspacePath,
        type: "directory",
        children: anchoredChildren,
      };
      appStore.dispatch(setRootNode(wsId, rootFileNode));
      if (!getWs(wsId).expandedPaths.includes(workspacePath)) {
        appStore.dispatch(addExpandedPath(wsId, workspacePath));
      }
    } else {
      logger.warn("explorerTree returned null; file tree remains empty");
    }
  } catch (error) {
    logger.error("Failed to initialize file explorer", error);
  } finally {
    appStore.dispatch(setFileExplorerLoading(wsId, false));
    appStore.dispatch(setFileExplorerInitialized(wsId, true));
  }
  await refreshAgentFileEditsForWorkspace(wsId);
}

/** Count file (non-directory) nodes in a file tree, mirroring the seeder. */
function countFiles(node: FileNode): number {
  if (node.type === "file") return 1;
  let count = 0;
  for (const child of node.children ?? []) {
    count += countFiles(child);
  }
  return count;
}

/** Collect every directory node path so the seeded tree renders fully expanded. */
function collectDirectoryPaths(node: FileNode, result: string[] = []): string[] {
  if (node.type !== "directory") return result;
  result.push(node.path);
  for (const child of node.children ?? []) {
    collectDirectoryPaths(child, result);
  }
  return result;
}

/**
 * Hydrate the file explorer for a workspace first-opened after boot, mirroring
 * the boot `files-git-seeder` file-explorer section: fetch the root tree via
 * `appClient.files.explorerTree`, dispatch the tree's own path as
 * `workspacePath`, seed git status, expand every directory, and mark the
 * workspace initialized. Guarded by the per-workspace `isInitialized` flag so a
 * re-mount of a boot-seeded workspace is a no-op. Errors leave the tree in
 * whatever state was already there.
 */
export async function hydrateFileExplorerFromWorkspace(wsId: string): Promise<void> {
  const existing = appStore.state.fileExplorer.byWorkspaceId[wsId] ?? emptyFileExplorerWorkspaceState;
  if (existing.isInitialized || existing.isLoading) return;
  appStore.dispatch(setFileExplorerLoading(wsId, true));
  try {
    const tree = await appClient.files.explorerTree(wsId);
    if (tree) {
      appStore.dispatch(setFileExplorerWorkspacePath(wsId, tree.path));
      appStore.dispatch(setRootNode(wsId, tree));
      const gitStatusMap = await appClient.files.gitStatusMap(wsId);
      appStore.dispatch(setGitStatusMap(wsId, gitStatusMap));
      for (const dirPath of collectDirectoryPaths(tree)) {
        appStore.dispatch(addExpandedPath(wsId, dirPath));
      }
      appStore.dispatch(setFileExplorerFileCount(wsId, countFiles(tree)));
    }
  } catch (error) {
    logger.error("Failed to hydrate file explorer for workspace", error);
  } finally {
    appStore.dispatch(setFileExplorerLoading(wsId, false));
    appStore.dispatch(setFileExplorerInitialized(wsId, true));
  }
}

/**
 * Middleware that gives the file-explorer directory-listing triggers a real
 * handler: after each action passes through the (no-op) reducer, it kicks off the
 * matching seam-backed load. Fire-and-forget — dispatch stays synchronous and
 * never throws.
 */
export function createFileExplorerReadMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && Array.isArray(action.payload)) {
      const [wsId] = action.payload as [unknown];
      if (typeof wsId === "string" && wsId.length > 0) {
        switch (action.type) {
          case initializeFileExplorer.type: {
            const options = action.payload[1];
            if (options && typeof options === "object") {
              const opts = options as { workspacePath?: unknown; workspaceId?: unknown };
              if (typeof opts.workspacePath === "string" && opts.workspacePath.length > 0) {
                void initializeFileExplorerTree(wsId, {
                  workspacePath: opts.workspacePath,
                  workspaceId:
                    typeof opts.workspaceId === "string" ? opts.workspaceId : undefined,
                });
              }
            }
            break;
          }
          case toggleDirectoryRequested.type: {
            const nodePath = action.payload[1];
            if (typeof nodePath === "string" && nodePath.length > 0) void toggleDirectory(wsId, nodePath);
            break;
          }
          case expandToPathRequested.type: {
            const targetPath = action.payload[1];
            if (typeof targetPath === "string" && targetPath.length > 0) void expandToPath(wsId, targetPath);
            break;
          }
          case expandAllRequested.type: {
            const maxDepth = action.payload[1];
            void expandAll(wsId, typeof maxDepth === "number" ? maxDepth : undefined);
            break;
          }
          case refreshFileExplorer.type: {
            void refreshFileExplorerTree(wsId);
            break;
          }
          case hydrateFileExplorerRequested.type: {
            void hydrateFileExplorerFromWorkspace(wsId);
            break;
          }
          case refreshDirectoryRequested.type: {
            const filePath = action.payload[1];
            if (typeof filePath === "string" && filePath.length > 0) {
              void handleRefreshDirectory(wsId, filePath);
            }
            break;
          }
          case refreshAgentFileEditsRequested.type:
          case syncGitStatusFromStoresRequested.type: {
            void refreshAgentFileEditsForWorkspace(wsId);
            break;
          }
        }
      }
    }
    return result;
  };
}
