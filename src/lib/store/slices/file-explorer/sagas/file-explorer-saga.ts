/**
 * File Explorer Saga
 *
 * Handles all async side effects for the file explorer:
 * - Directory loading (local + remote)
 * - Git status refresh
 * - Gitignore pattern loading
 * - Agent file edits loading
 * - Tree expansion / collapse
 */
import { call, fork, put, select, takeEvery, takeLatest, type SagaGenerator } from "typed-redux-saga";
import type { FileNode, FileGitStatus } from "$shared/types";
import { GitFileStatus } from "$shared/types";
import { WorkspaceId as WorkspaceIdFn, isValidWorkspaceId } from "$shared/types/branded-ids";
import { invoke } from "$lib/electron-bridge";
import { Logger } from "$shared/logger";
import { gitClient } from "$features/git/git.client";
import { getAgentFileEdits, propagateAgentEditsToParents } from "$lib/utils/agent-file-edits";
import {
  selectCurrentStagedWorkingChanges as selectFtCurrentStagedChanges,
  selectCurrentUnstagedWorkingChanges as selectFtCurrentUnstagedChanges,
} from "../../changes/changes-selectors";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import { setGitStatus, setGitDiffs } from "../../git/git-slice";
import { selectGitStatus } from "../../git/git-selectors";
import { selectWorkspaceFileChanges } from "../../changes/changes-selectors";
import {
  initializeFileExplorer,
  setWorkspacePathRequested,
  toggleDirectoryRequested,
  expandToPathRequested,
  expandAllRequested,
  refreshFileExplorer,
  refreshGitStatusRequested,
  syncGitStatusFromStoresRequested,
  setFileExplorerLoading,
  setFileExplorerInitialized,
  setRootNode,
  setChildrenAtPathAction,
  setGitignorePatterns,
  setGitStatusMap,
  setAgentFileEditsAction,
  addExpandedPath,
  removeExpandedPath,
  addLoadingPath,
  removeLoadingPath,
  setBulkOperation,
  incrementTreeVersion,
  setFileExplorerWorkspacePath,
  setFileExplorerFileCount,
  setEnvironmentConfigAction,
  setRemoteConnectionIdAction,
  setIsRemoteInitializedAction,
  applyGitStatusToTreeAction,
} from "../file-explorer-slice";
import { selectFileExplorerState } from "../file-explorer-selectors";
import {
  shouldHide,
  checkGitignored,
  sortNodes,
  enrichDirectoriesWithGitStatus,
  countFilesInTree,
  applyAgentEditsToTree,
  extractWorkspaceId,
  findNodeByPath,
  CACHE_TTL,
} from "../file-explorer-utils";
import type { FileExplorerWorkspaceState } from "../file-explorer-types";
import { workspaceUnmounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";

const logger = new Logger("FileExplorerSaga");

// ---------------------------------------------------------------------------
// Module-level caches (not in Redux state — performance optimization)
// ---------------------------------------------------------------------------

const directoryCache = new Map<string, Map<string, { nodes: FileNode[]; timestamp: number }>>();

function getWsCache(wsId: string) {
  let cache = directoryCache.get(wsId);
  if (!cache) {
    cache = new Map();
    directoryCache.set(wsId, cache);
  }
  return cache;
}

function clearWsCache(wsId: string) {
  directoryCache.get(wsId)?.clear();
}

// ---------------------------------------------------------------------------
// Helper: read workspace state from Redux
// ---------------------------------------------------------------------------

function* getWsState(wsId: string): SagaGenerator<FileExplorerWorkspaceState> {
  return yield* select((state: any) => selectFileExplorerState.select(state, wsId));
}

// ---------------------------------------------------------------------------
// Directory loading
// ---------------------------------------------------------------------------

function* loadDirectoryCore(
  wsId: string,
  dirPath: string,
): SagaGenerator<FileNode[]> {
  const ws = yield* getWsState(wsId);
  const { workspacePath, gitStatus, gitignorePatterns, environmentConfig, remoteConnectionId } = ws;

  if (environmentConfig?.type === "remote") {
    return yield* call(loadDirectoryCoreRemote, wsId, dirPath, workspacePath, remoteConnectionId, gitStatus, gitignorePatterns);
  }
  return yield* call(loadDirectoryCoreLocal, dirPath, workspacePath, gitStatus, gitignorePatterns);
}



async function loadDirectoryCoreLocal(
  dirPath: string,
  workspacePath: string,
  gitStatus: Record<string, FileGitStatus>,
  gitignorePatterns: string[],
): Promise<FileNode[]> {
  try {
    const response = (await invoke("file:readDirWithStats", { path: dirPath })) as {
      success: boolean;
      data?: any[];
      error?: string;
    };
    const nodes: FileNode[] = [];

    if (!response.success || !response.data) {
      if (dirPath === workspacePath && response.error?.includes("not accessible")) {
        logger.warn("[loadDirectoryCoreLocal] Workspace directory not accessible", { dirPath });
      } else {
        logger.error("[loadDirectoryCoreLocal] Failed:", response.error || "No data", { dirPath });
      }
      return nodes;
    }

    for (const entry of response.data) {
      const fullPath = `${dirPath}/${entry.name}`;
      if (shouldHide(fullPath)) continue;
      const relativePath = fullPath.replace(`${workspacePath}/`, "");
      const fileGitStatus = gitStatus[relativePath];
      const ignored = checkGitignored(fullPath, workspacePath, gitignorePatterns);

      nodes.push({
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory ? "directory" : "file",
        size: entry.size,
        modified: entry.modified,
        children: entry.isDirectory ? [] : undefined,
        gitStatus: fileGitStatus,
        ...(ignored && { isGitignored: true }),
      });
    }

    const sorted = sortNodes(nodes);
    return enrichDirectoriesWithGitStatus(sorted, gitStatus, workspacePath);
  } catch (err) {
    logger.error("Failed to load directory:", err);
    return [];
  }
}

async function loadDirectoryCoreRemote(
  _wsId: string,
  dirPath: string,
  workspacePath: string,
  remoteConnectionId: string | null,
  gitStatus: Record<string, FileGitStatus>,
  gitignorePatterns: string[],
): Promise<FileNode[]> {
  if (!remoteConnectionId) {
    logger.error("Remote connection not initialized");
    return [];
  }
  try {
    const response = (await invoke("remote-fs:readdir", {
      workspaceId: remoteConnectionId,
      path: dirPath,
    })) as {
      success: boolean;
      data?: Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean; size: number; modified: Date | string }>;
      error?: string;
    };
    const nodes: FileNode[] = [];
    if (!response.success || !response.data) return nodes;

    for (const entry of response.data) {
      const fullPath = entry.path || `${dirPath}/${entry.name}`;
      if (shouldHide(fullPath)) continue;
      const relativePath = fullPath.replace(`${workspacePath}/`, "");
      const fileGitStatus = gitStatus[relativePath];
      const ignored = checkGitignored(fullPath, workspacePath, gitignorePatterns);
      const modifiedDate = entry.modified instanceof Date ? entry.modified : new Date(entry.modified);

      nodes.push({
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory ? "directory" : "file",
        size: entry.size,
        modified: modifiedDate.toISOString(),
        children: entry.isDirectory ? [] : undefined,
        gitStatus: fileGitStatus,
        ...(ignored && { isGitignored: true }),
      });
    }
    const sorted = sortNodes(nodes);
    return enrichDirectoriesWithGitStatus(sorted, gitStatus, workspacePath);
  } catch (err) {
    logger.error("Failed to load remote directory:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Git status loading
// ---------------------------------------------------------------------------

function* loadGitStatusSaga(wsId: string): SagaGenerator<void> {
  const ws = yield* getWsState(wsId);
  if (!ws.workspacePath) {
    yield* put(setGitStatusMap(wsId, {}));
    return;
  }

  try {
    if (isValidWorkspaceId(wsId)) {
      const activeWsId = yield* select((state: any) => selectActiveWorkspaceId.select(state));
      if (activeWsId !== wsId) {
        logger.debug("[Git Status] Store on different workspace, skipping");
        return;
      }

      const statusResult = yield* call(() => gitClient.getStatus(WorkspaceIdFn(wsId)));
      if (statusResult.ok) {
        yield* put(setGitStatus(wsId, statusResult.data));
      }

      const newGitStatus: Record<string, FileGitStatus> = {};
      const unstagedChanges = yield* select((state: any) => selectFtCurrentUnstagedChanges.select(state));
      const stagedChanges = yield* select((state: any) => selectFtCurrentStagedChanges.select(state));
      const allChanges = [...unstagedChanges, ...stagedChanges];

      for (const change of allChanges) {
        const stats = change.stats || { additions: 0, deletions: 0 };
        const statusCode = change.stage === "staged" ? "M " : " M";
        newGitStatus[change.file] = { status: statusCode, additions: stats.additions, deletions: stats.deletions };
      }

      const currentGitStatus = yield* select((state: any) => selectGitStatus.select(state, wsId));
      if (currentGitStatus?.files) {
        const filesToDiff = currentGitStatus.files
          .filter((f: any) => f.path && !newGitStatus[f.path])
          .map((f: any) => f.path);

        if (filesToDiff.length > 0) {
          const diffResult = yield* call(() => gitClient.getDiff(WorkspaceIdFn(wsId)));
          const diffs = diffResult.ok ? diffResult.data : null;
          if (diffs) {
            yield* put(setGitDiffs(wsId, diffs));
            for (const chunk of diffs) {
              if (filesToDiff.includes(chunk.file)) {
                let additions = 0;
                let deletions = 0;
                for (const hunk of chunk.chunks) {
                  for (const line of hunk.lines) {
                    if (line.type === "Addition") additions++;
                    else if (line.type === "Deletion") deletions++;
                  }
                }
                const file = currentGitStatus.files.find((f: any) => f.path === chunk.file);
                if (file) {
                  let statusCode = " M";
                  if (file.status === GitFileStatus.Added) statusCode = file.staged ? "A " : " A";
                  else if (file.status === GitFileStatus.Deleted) statusCode = file.staged ? "D " : " D";
                  else if (file.status === GitFileStatus.Modified) statusCode = file.staged ? "M " : " M";
                  else if (file.status === GitFileStatus.Untracked) statusCode = "??";
                  newGitStatus[chunk.file] = { status: statusCode, additions, deletions };
                }
              }
            }
          }
        }
      }

      yield* put(setGitStatusMap(wsId, newGitStatus));
      return;
    }

    // Fallback to file:getGitStatus
    const response = yield* call(() =>
      invoke<{ success: boolean; data?: { fileStatuses: Record<string, string>; fileChanges: Record<string, any> } }>(
        "file:getGitStatus",
        { workspacePath: ws.workspacePath },
      ),
    );
    if (response?.success && response.data) {
      const newGitStatus: Record<string, FileGitStatus> = {};
      for (const [filePath, status] of Object.entries(response.data.fileStatuses)) {
        const changes = response.data.fileChanges?.[filePath];
        newGitStatus[filePath] = { status, additions: changes?.additions || 0, deletions: changes?.deletions || 0 };
      }

      const effectiveWsId = wsId || extractWorkspaceId(ws.workspacePath);
      const fileChanges = yield* select((state: any) => selectWorkspaceFileChanges.select(state, effectiveWsId));
      if (fileChanges?.length > 0) {
        for (const change of fileChanges) {
          const existing = newGitStatus[change.path];
          if (existing) {
            existing.additions = Math.max(existing.additions || 0, change.additions || 0);
            existing.deletions = Math.max(existing.deletions || 0, change.deletions || 0);
          } else {
            newGitStatus[change.path] = {
              status: change.action === "create" ? "??" : "M ",
              additions: change.additions,
              deletions: change.deletions,
            };
          }
        }
      }
      yield* put(setGitStatusMap(wsId, newGitStatus));
    }
  } catch (error) {
    logger.error("Failed to load git status:", error);
  }
}


// ---------------------------------------------------------------------------
// Gitignore loading
// ---------------------------------------------------------------------------

function* loadGitignorePatterns(wsId: string): SagaGenerator<void> {
  const ws = yield* getWsState(wsId);
  if (!ws.workspacePath) return;
  try {
    const response = yield* call(() =>
      invoke<{ success: boolean; data?: string[] }>("file:getGitignorePatterns", {
        workspacePath: ws.workspacePath,
      }),
    );
    if (response?.success && response.data) {
      yield* put(setGitignorePatterns(wsId, response.data));
    }
  } catch (error) {
    logger.error("Failed to load gitignore patterns:", error);
  }
}

// ---------------------------------------------------------------------------
// Agent file edits loading
// ---------------------------------------------------------------------------

function* loadAgentFileEditsSaga(wsId: string): SagaGenerator<void> {
  const ws = yield* getWsState(wsId);
  if (!wsId) return;
  try {
    const editsMap = yield* call(() => getAgentFileEdits(wsId));
    const editsRecord: Record<string, string[]> = {};
    for (const [file, agents] of editsMap.entries()) {
      editsRecord[file] = agents;
    }
    // Propagate to parent directories
    if (ws.workspacePath) {
      const propagated = propagateAgentEditsToParents(editsMap, ws.workspacePath, ws.workspacePath);
      for (const [file, agents] of propagated.entries()) {
        if (!editsRecord[file]) {
          editsRecord[file] = agents;
        }
      }
    }
    yield* put(setAgentFileEditsAction(wsId, editsRecord));
  } catch (error) {
    logger.error("Failed to load agent file edits:", error);
  }
}

// ---------------------------------------------------------------------------
// Initialize file explorer
// ---------------------------------------------------------------------------

function* initializeFileExplorerSaga(
  action: ReturnType<typeof initializeFileExplorer>,
): SagaGenerator<void> {
  const [wsId, options] = action.payload;
  const { workspacePath, environmentConfig } = options;

  yield* put(setFileExplorerWorkspacePath(wsId, workspacePath));
  if (environmentConfig) {
    yield* put(setEnvironmentConfigAction(wsId, environmentConfig));
  }

  yield* put(setFileExplorerLoading(wsId, true));

  // Load gitignore patterns first
  yield* call(loadGitignorePatterns, wsId);

  // Load git status
  yield* call(loadGitStatusSaga, wsId);

  // If remote, initialize remote FS
  if (environmentConfig?.type === "remote") {
    yield* call(initRemoteFS, wsId);
  }

  // Load root directory
  const children = yield* call(loadDirectoryCore, wsId, workspacePath);
  if (children.length > 0) {
    const rootNode: FileNode = {
      name: workspacePath.split("/").pop() || "",
      path: workspacePath,
      type: "directory",
      children,
    };
    // Apply agent edits
    yield* call(loadAgentFileEditsSaga, wsId);
    const wsAfterEdits = yield* getWsState(wsId);
    const withEdits = applyAgentEditsToTree(rootNode, wsAfterEdits.agentFileEdits, workspacePath);
    yield* put(setRootNode(wsId, withEdits || rootNode));
    yield* put(addExpandedPath(wsId, workspacePath));
    yield* put(setFileExplorerFileCount(wsId, countFilesInTree(rootNode)));
  }

  yield* put(setFileExplorerLoading(wsId, false));
  yield* put(setFileExplorerInitialized(wsId, true));
}


// ---------------------------------------------------------------------------
// Remote FS initialization
// ---------------------------------------------------------------------------

function* initRemoteFS(wsId: string): SagaGenerator<void> {
  const ws = yield* getWsState(wsId);
  if (!ws.environmentConfig || ws.environmentConfig.type !== "remote") return;
  if (ws.isRemoteInitialized) return;

  try {
    const response = yield* call(() =>
      invoke<{ success: boolean; data?: { connectionId: string } }>("remote-fs:init", {
        host: ws.environmentConfig!.ssh?.host ?? "",
        port: ws.environmentConfig!.ssh?.port ?? 22,
        auth: {
          user: ws.environmentConfig!.ssh?.user ?? "",
          password: ws.environmentConfig!.ssh?.password,
          key_path: ws.environmentConfig!.ssh?.key_path,
          use_agent: ws.environmentConfig!.ssh?.use_agent,
        },
      }),
    );
    if (response?.success && response.data) {
      yield* put(setRemoteConnectionIdAction(wsId, response.data.connectionId));
      yield* put(setIsRemoteInitializedAction(wsId, true));
    }
  } catch (error) {
    logger.error("Failed to initialize remote FS:", error);
  }
}

// ---------------------------------------------------------------------------
// Toggle directory
// ---------------------------------------------------------------------------

function* handleToggleDirectory(
  action: ReturnType<typeof toggleDirectoryRequested>,
): SagaGenerator<void> {
  const [wsId, nodePath] = action.payload;
  const ws = yield* getWsState(wsId);

  if (ws.expandedPaths.includes(nodePath)) {
    // Collapse
    yield* put(removeExpandedPath(wsId, nodePath));
    return;
  }

  // Expand – load children if needed
  yield* put(addExpandedPath(wsId, nodePath));

  const node = ws.rootNode ? findNodeByPath(ws.rootNode, ws.workspacePath, nodePath) : null;
  const hasLoadedChildren = node?.children && node.children.length > 0;

  // Check cache
  const cache = getWsCache(wsId);
  const cached = cache.get(nodePath);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    if (!hasLoadedChildren) {
      yield* put(setChildrenAtPathAction(wsId, nodePath, cached.nodes));
    }
    return;
  }

  if (!hasLoadedChildren) {
    yield* put(addLoadingPath(wsId, nodePath));
    const children = yield* call(loadDirectoryCore, wsId, nodePath);
    cache.set(nodePath, { nodes: children, timestamp: Date.now() });
    yield* put(setChildrenAtPathAction(wsId, nodePath, children));
    yield* put(removeLoadingPath(wsId, nodePath));
  }
}

// ---------------------------------------------------------------------------
// Expand to a specific path
// ---------------------------------------------------------------------------

function* handleExpandToPath(
  action: ReturnType<typeof expandToPathRequested>,
): SagaGenerator<void> {
  const [wsId, targetPath] = action.payload;
  const ws = yield* getWsState(wsId);
  if (!ws.workspacePath) return;

  // Build the list of ancestor directories
  const parts = targetPath.replace(ws.workspacePath, "").split("/").filter(Boolean);
  let currentPath = ws.workspacePath;

  yield* put(setBulkOperation(wsId, true));
  for (let i = 0; i < parts.length; i++) {
    currentPath = `${currentPath}/${parts[i]}`;
    const isFile = i === parts.length - 1 && !targetPath.endsWith("/");
    if (!isFile) {
      if (!ws.expandedPaths.includes(currentPath)) {
        yield* put(addExpandedPath(wsId, currentPath));
        // Load children if needed
        const node = ws.rootNode ? findNodeByPath(ws.rootNode, ws.workspacePath, currentPath) : null;
        if (!node?.children || node.children.length === 0) {
          const children = yield* call(loadDirectoryCore, wsId, currentPath);
          yield* put(setChildrenAtPathAction(wsId, currentPath, children));
        }
      }
    }
  }
  yield* put(setBulkOperation(wsId, false));
  yield* put(incrementTreeVersion(wsId));
}


// ---------------------------------------------------------------------------
// Expand all directories
// ---------------------------------------------------------------------------

function* handleExpandAll(
  action: ReturnType<typeof expandAllRequested>,
): SagaGenerator<void> {
  const [wsId, maxDepth] = action.payload;
  const ws = yield* getWsState(wsId);
  if (!ws.rootNode) return;

  const depthLimit = maxDepth ?? 3;
  yield* put(setBulkOperation(wsId, true));

  function* expandRecursive(node: FileNode, depth: number): SagaGenerator<void> {
    if (depth >= depthLimit) return;
    if (node.type !== "directory") return;

    if (!ws.expandedPaths.includes(node.path)) {
      yield* put(addExpandedPath(wsId, node.path));
    }
    if (!node.children || node.children.length === 0) {
      const children = yield* call(loadDirectoryCore, wsId, node.path);
      yield* put(setChildrenAtPathAction(wsId, node.path, children));
      for (const child of children) {
        if (child.type === "directory") {
          yield* call(expandRecursive, child, depth + 1);
        }
      }
    } else {
      for (const child of node.children) {
        if (child.type === "directory") {
          yield* call(expandRecursive, child, depth + 1);
        }
      }
    }
  }

  yield* call(expandRecursive, ws.rootNode, 0);
  yield* put(setBulkOperation(wsId, false));
  yield* put(incrementTreeVersion(wsId));
}

// ---------------------------------------------------------------------------
// Refresh file explorer
// ---------------------------------------------------------------------------

function* handleRefresh(
  action: ReturnType<typeof refreshFileExplorer>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  const ws = yield* getWsState(wsId);
  if (!ws.workspacePath) return;

  clearWsCache(wsId);
  yield* put(setFileExplorerLoading(wsId, true));

  // Reload gitignore, git status
  yield* call(loadGitignorePatterns, wsId);
  yield* call(loadGitStatusSaga, wsId);

  // Reload root
  const children = yield* call(loadDirectoryCore, wsId, ws.workspacePath);
  const rootNode: FileNode = {
    name: ws.workspacePath.split("/").pop() || "",
    path: ws.workspacePath,
    type: "directory",
    children,
  };

  yield* call(loadAgentFileEditsSaga, wsId);
  const wsAfterEdits = yield* getWsState(wsId);
  const withEdits = applyAgentEditsToTree(rootNode, wsAfterEdits.agentFileEdits, ws.workspacePath);
  yield* put(setRootNode(wsId, withEdits || rootNode));
  yield* put(setFileExplorerFileCount(wsId, countFilesInTree(rootNode)));
  yield* put(setFileExplorerLoading(wsId, false));

  // Re-expand previously expanded directories
  const expandedPaths = ws.expandedPaths.filter((p) => p !== ws.workspacePath);
  for (const path of expandedPaths) {
    const node = findNodeByPath(rootNode, ws.workspacePath, path);
    if (node && node.type === "directory") {
      if (!node.children || node.children.length === 0) {
        const dirChildren = yield* call(loadDirectoryCore, wsId, path);
        yield* put(setChildrenAtPathAction(wsId, path, dirChildren));
      }
    }
  }
  yield* put(incrementTreeVersion(wsId));
}

// ---------------------------------------------------------------------------
// Refresh git status only
// ---------------------------------------------------------------------------

function* handleRefreshGitStatus(
  action: ReturnType<typeof refreshGitStatusRequested>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  yield* call(loadGitStatusSaga, wsId);
  yield* put(applyGitStatusToTreeAction(wsId));
  yield* put(incrementTreeVersion(wsId));
}

// ---------------------------------------------------------------------------
// Sync git status from other stores
// ---------------------------------------------------------------------------

function* handleSyncGitStatusFromStores(
  action: ReturnType<typeof syncGitStatusFromStoresRequested>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  yield* call(loadGitStatusSaga, wsId);
  yield* put(applyGitStatusToTreeAction(wsId));
  yield* call(loadAgentFileEditsSaga, wsId);
  yield* put(incrementTreeVersion(wsId));
}

// ---------------------------------------------------------------------------
// Set workspace path (re-initialize)
// ---------------------------------------------------------------------------

function* handleSetWorkspacePath(
  action: ReturnType<typeof setWorkspacePathRequested>,
): SagaGenerator<void> {
  const [wsId, path] = action.payload;
  yield* put(setFileExplorerWorkspacePath(wsId, path));
  clearWsCache(wsId);
  // Re-initialize with the new path
  yield* put(initializeFileExplorer(wsId, { workspacePath: path }));
}

// ---------------------------------------------------------------------------
// Workspace unmount cleanup
// ---------------------------------------------------------------------------

function* watchWorkspaceUnmountedForCache(): SagaGenerator<void> {
  yield* takeEvery(workspaceUnmounted, function* (action) {
    const [wsId] = action.payload;
    directoryCache.delete(wsId);
  });
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* fileExplorerSaga(): SagaGenerator<void> {
  // Reset module-level cache on (re)start to avoid stale data from previous runs
  directoryCache.clear();

  yield* fork(watchWorkspaceUnmountedForCache);
  yield* takeLatest(initializeFileExplorer.type, initializeFileExplorerSaga);
  yield* takeEvery(toggleDirectoryRequested.type, handleToggleDirectory);
  yield* takeLatest(expandToPathRequested.type, handleExpandToPath);
  yield* takeLatest(expandAllRequested.type, handleExpandAll);
  yield* takeLatest(refreshFileExplorer.type, handleRefresh);
  yield* takeLatest(refreshGitStatusRequested.type, handleRefreshGitStatus);
  yield* takeLatest(syncGitStatusFromStoresRequested.type, handleSyncGitStatusFromStores);
  yield* takeLatest(setWorkspacePathRequested.type, handleSetWorkspacePath);
}