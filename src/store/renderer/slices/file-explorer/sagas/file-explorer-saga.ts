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
import {
  call,
  delay,
  fork,
  put,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from "typed-redux-saga";
import { deepEqual } from "fast-equals";
import type { FileNode, FileGitStatus, EnvironmentConfig } from "$shared/types";
import { GitFileStatus } from "$shared/types";
import {
  WorkspaceId as WorkspaceIdFn,
  isValidWorkspaceId,
} from "$shared/types/branded-ids";
import { invoke } from "$lib/electron-bridge";
import { Logger } from "$shared/logger";
import { gitClient } from "$features/git/git.client";
import {
  getAgentFileEdits,
  propagateAgentEditsToParents,
} from "$lib/utils/agent-file-edits";
import {
  selectCurrentStagedWorkingChanges as selectFtCurrentStagedChanges,
  selectCurrentUnstagedWorkingChanges as selectFtCurrentUnstagedChanges,
  selectWorkspaceFileChanges,
} from "../../changes/changes-selectors";
import {
  selectActiveWorkspaceId,
  selectWorkspaceEnvironmentConfig,
} from "../../workspace/workspace-selectors";
import {
  setGitStatus,
  setGitDiffs,
} from "../../git/git-slice";
import { selectGitStatus } from "../../git/git-selectors";

import {
  initializeFileExplorer,
  setWorkspacePathRequested,
  toggleDirectoryRequested,
  expandToPathRequested,
  expandAllRequested,
  refreshFileExplorer,
  refreshDirectoryRequested,
  refreshGitStatusRequested,
  refreshAgentFileEditsRequested,
  syncGitStatusFromStoresRequested,
  debouncedFileTrackingSync,
  debouncedAgentFileEditsRefresh,
  setFileExplorerLoading,
  setFileExplorerInitialized,
  setRootNode,
  setChildrenAtPathAction,
  setGitignorePatterns,
  setGitStatusMap,
  updateGitStatusEntries,
  removeGitStatusEntries,
  updateAgentFileEditsEntries,
  removeAgentFileEditsEntries,
  addExpandedPath,
  removeExpandedPath,
  addLoadingPath,
  removeLoadingPath,
  setBulkOperation,
  incrementTreeVersion,
  setFileExplorerWorkspacePath,
  setFileExplorerFileCount,
  setRemoteConnectionIdAction,
  setIsRemoteInitializedAction,
  setIsStoreActive,
  clearFileExplorerForWorkspace,
} from "../file-explorer-slice";
import {
  selectCurrentFileExplorerEnvironmentConfigTrigger,
  selectEffectiveFileExplorerWorkspacePath,
  selectFileExplorerState,
  type FileExplorerEnvironmentConfigTrigger,
} from "../file-explorer-selectors";
import { getItem } from "ag-redux-toolkit/utils/collections/collection-utils";
import {
  shouldHide,
  checkGitignored,
  sortNodes,
  countFilesInTree,
  extractWorkspaceId,
} from "../file-explorer-utils";
import type { FileExplorerTreeNode, FileExplorerWorkspaceState } from "../file-explorer-types";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import {
  takeEveryFromElectronChannel,
  takeEveryFromWindowEvent,
} from "$store/renderer/utils/ipc-channel";
import {
  debounceSaga,
  debounceWithKeySaga,
} from "ag-redux-toolkit/utils/sagas/debounce-saga";
import { takeLatestFromSelector } from "ag-redux-toolkit/utils/sagas/selector-channel-effects";
import type { StoreAction } from "ag-redux-toolkit/types";

const logger = new Logger("FileExplorerSaga");

type AgentFileEditsRefreshState = {
  inProgress: boolean;
  dirty: boolean;
};

// ---------------------------------------------------------------------------
// Module-level transient state (not Redux domain data)
// ---------------------------------------------------------------------------

const agentFileEditsRefreshByWorkspace = new Map<string, AgentFileEditsRefreshState>();
const pendingAgentFileEditsRefreshWorkspaceIds = new Set<string>();

export function resetAgentFileEditsRefreshState(): void {
  agentFileEditsRefreshByWorkspace.clear();
  pendingAgentFileEditsRefreshWorkspaceIds.clear();
}

function getAgentFileEditsRefreshState(wsId: string): AgentFileEditsRefreshState {
  let state = agentFileEditsRefreshByWorkspace.get(wsId);
  if (!state) {
    state = { inProgress: false, dirty: false };
    agentFileEditsRefreshByWorkspace.set(wsId, state);
  }
  return state;
}

function isRelevantEnvironmentConfigChange(
  previousConfig: EnvironmentConfig | undefined,
  currentConfig: EnvironmentConfig | undefined,
): boolean {
  if (deepEqual(previousConfig, currentConfig)) return false;
  return previousConfig?.type === "remote" || currentConfig?.type === "remote";
}

function getTreeNode(
  ws: FileExplorerWorkspaceState,
  path: string,
): FileExplorerTreeNode | null {
  return getItem(ws.nodes, path) ?? null;
}

function hasLoadedDirectoryChildren(
  ws: FileExplorerWorkspaceState,
  path: string,
): boolean {
  const node = getTreeNode(ws, path);
  return node?.type === "directory" && node.children.length > 0;
}

// ---------------------------------------------------------------------------
// Directory loading
// ---------------------------------------------------------------------------

function* loadDirectoryCore(
  wsId: string,
  dirPath: string,
): SagaGenerator<FileNode[]> {
  const ws = yield* selectFileExplorerState.effect(wsId);
  const { workspacePath, gitignorePatterns, remoteConnectionId } = ws;
  const environmentConfig = yield* selectWorkspaceEnvironmentConfig.effect(wsId);

  if (environmentConfig?.type === "remote") {
    return yield* call(loadDirectoryCoreRemote, wsId, dirPath, workspacePath, remoteConnectionId, gitignorePatterns);
  }
  return yield* call(loadDirectoryCoreLocal, dirPath, workspacePath, gitignorePatterns);
}



async function loadDirectoryCoreLocal(
  dirPath: string,
  workspacePath: string,
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
      const ignored = checkGitignored(fullPath, workspacePath, gitignorePatterns);

      nodes.push({
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory ? "directory" : "file",
        size: entry.size,
        modified: entry.modified,
        children: entry.isDirectory ? [] : undefined,
        ...(ignored && { isGitignored: true }),
      });
    }

    return sortNodes(nodes);
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
      const ignored = checkGitignored(fullPath, workspacePath, gitignorePatterns);
      const modifiedDate = entry.modified instanceof Date ? entry.modified : new Date(entry.modified);

      nodes.push({
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory ? "directory" : "file",
        size: entry.size,
        modified: modifiedDate.toISOString(),
        children: entry.isDirectory ? [] : undefined,
        ...(ignored && { isGitignored: true }),
      });
    }
    return sortNodes(nodes);
  } catch (err) {
    logger.error("Failed to load remote directory:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Git status loading
// ---------------------------------------------------------------------------

/**
 * Apply a freshly computed git-status snapshot by diffing against the
 * currently stored map. Dispatches the narrow update/remove actions so
 * unchanged rows retain object identity and treeVersion is not bumped.
 */
export function* applyGitStatusSnapshot(
  wsId: string,
  snapshot: Record<string, FileGitStatus>,
): SagaGenerator<void> {
  const ws = yield* selectFileExplorerState.effect(wsId);
  const previous = ws.gitStatus;
  const stalePaths: string[] = [];
  for (const key of Object.keys(previous)) {
    if (!(key in snapshot)) stalePaths.push(key);
  }
  if (stalePaths.length > 0) {
    yield* put(removeGitStatusEntries(wsId, stalePaths));
  }
  if (Object.keys(snapshot).length > 0) {
    yield* put(updateGitStatusEntries(wsId, snapshot));
  }
}

function* loadGitStatusSaga(wsId: string): SagaGenerator<void> {
  const ws = yield* selectFileExplorerState.effect(wsId);
  if (!ws.workspacePath) {
    yield* put(setGitStatusMap(wsId, {}));
    return;
  }

  try {
    if (isValidWorkspaceId(wsId)) {
      const activeWsId = yield* selectActiveWorkspaceId.effect();
      if (activeWsId !== wsId) {
        logger.debug("[Git Status] Store on different workspace, skipping");
        return;
      }

      const statusResult = yield* call(() => gitClient.getStatus(WorkspaceIdFn(wsId)));
      if (statusResult.ok) {
        yield* put(setGitStatus(wsId, statusResult.data));
      }

      const newGitStatus: Record<string, FileGitStatus> = {};
      const unstagedChanges = yield* selectFtCurrentUnstagedChanges.effect();
      const stagedChanges = yield* selectFtCurrentStagedChanges.effect();
      const allChanges = [...unstagedChanges, ...stagedChanges];

      for (const change of allChanges) {
        const stats = change.stats || { additions: 0, deletions: 0 };
        const statusCode = change.stage === "staged" ? "M " : " M";
        newGitStatus[change.file] = { status: statusCode, additions: stats.additions, deletions: stats.deletions };
      }

      const currentGitStatus = yield* selectGitStatus.effect(wsId);
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

      yield* call(applyGitStatusSnapshot, wsId, newGitStatus);
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
      const fileChanges = yield* selectWorkspaceFileChanges.effect(effectiveWsId);
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
      yield* call(applyGitStatusSnapshot, wsId, newGitStatus);
    }
  } catch (error) {
    logger.error("Failed to load git status:", error);
  }
}


// ---------------------------------------------------------------------------
// Gitignore loading
// ---------------------------------------------------------------------------

function* loadGitignorePatterns(wsId: string): SagaGenerator<void> {
  const ws = yield* selectFileExplorerState.effect(wsId);
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
  const ws = yield* selectFileExplorerState.effect(wsId);
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
    // Diff against prior state so unchanged entries keep their array identity
    // (per-row selector memoization depends on ===-stability of agentEdits refs).
    const freshState = yield* selectFileExplorerState.effect(wsId);
    const previous = freshState.agentFileEdits;
    const stalePaths: string[] = [];
    for (const key of Object.keys(previous)) {
      if (!(key in editsRecord)) stalePaths.push(key);
    }
    if (stalePaths.length > 0) {
      yield* put(removeAgentFileEditsEntries(wsId, stalePaths));
    }
    if (Object.keys(editsRecord).length > 0) {
      yield* put(updateAgentFileEditsEntries(wsId, editsRecord));
    }
  } catch (error) {
    logger.error("Failed to load agent file edits:", error);
  }
}

export function* refreshAgentFileEditsForWorkspace(wsId: string): SagaGenerator<void> {
  if (!wsId) return;
  const refreshState = getAgentFileEditsRefreshState(wsId);
  if (refreshState.inProgress) {
    refreshState.dirty = true;
    return;
  }

  refreshState.inProgress = true;
  try {
    yield* call(loadAgentFileEditsSaga, wsId);
  } finally {
    const shouldReplay = refreshState.dirty;
    refreshState.inProgress = false;
    refreshState.dirty = false;
    if (shouldReplay) {
      yield* delay(0);
      yield* call(refreshAgentFileEditsForWorkspace, wsId);
    } else {
      agentFileEditsRefreshByWorkspace.delete(wsId);
    }
  }
}

// ---------------------------------------------------------------------------
// Initialize file explorer
// ---------------------------------------------------------------------------

function* initializeFileExplorerSaga(
  action: ReturnType<typeof initializeFileExplorer>,
): SagaGenerator<void> {
  const [wsId, options] = action.payload;
  const { workspacePath } = options;
  const environmentConfig = yield* selectWorkspaceEnvironmentConfig.effect(wsId);

  yield* put(setFileExplorerWorkspacePath(wsId, workspacePath));

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
    const rootFileNode: FileNode = {
      name: workspacePath.split("/").pop() || "",
      path: workspacePath,
      type: "directory",
      children,
    };
    // Load agent file edits — selector derives per-node agentEdits from this record
    yield* call(refreshAgentFileEditsForWorkspace, wsId);
    yield* put(setRootNode(wsId, rootFileNode));
    yield* put(addExpandedPath(wsId, workspacePath));
    yield* put(setFileExplorerFileCount(wsId, countFilesInTree(rootFileNode)));
  }

  yield* put(setFileExplorerLoading(wsId, false));
  yield* put(setFileExplorerInitialized(wsId, true));
}


// ---------------------------------------------------------------------------
// Remote FS initialization
// ---------------------------------------------------------------------------

function* initRemoteFS(
  wsId: string,
): SagaGenerator<void> {
  const ws = yield* selectFileExplorerState.effect(wsId);
  const effectiveEnvironmentConfig = yield* selectWorkspaceEnvironmentConfig.effect(wsId);
  if (!effectiveEnvironmentConfig || effectiveEnvironmentConfig.type !== "remote") return;
  if (ws.isRemoteInitialized) return;

  try {
    const response = yield* call(() =>
      invoke<{ success: boolean; data?: { connectionId: string } }>("remote-fs:init", {
        host: effectiveEnvironmentConfig.ssh?.host ?? "",
        port: effectiveEnvironmentConfig.ssh?.port ?? 22,
        auth: {
          user: effectiveEnvironmentConfig.ssh?.user ?? "",
          password: effectiveEnvironmentConfig.ssh?.password,
          key_path: effectiveEnvironmentConfig.ssh?.key_path,
          use_agent: effectiveEnvironmentConfig.ssh?.use_agent,
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

export function* handleToggleDirectory(
  action: ReturnType<typeof toggleDirectoryRequested>,
): SagaGenerator<void> {
  const [wsId, nodePath] = action.payload;
  const ws = yield* selectFileExplorerState.effect(wsId);

  if (ws.expandedPaths.includes(nodePath)) {
    // Collapse
    yield* put(removeExpandedPath(wsId, nodePath));
    return;
  }

  // Expand – load children if needed
  yield* put(addExpandedPath(wsId, nodePath));

  if (!hasLoadedDirectoryChildren(ws, nodePath)) {
    yield* put(addLoadingPath(wsId, nodePath));
    const children = yield* call(loadDirectoryCore, wsId, nodePath);
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
  const ws = yield* selectFileExplorerState.effect(wsId);
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
        if (!hasLoadedDirectoryChildren(ws, currentPath)) {
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
  const ws = yield* selectFileExplorerState.effect(wsId);
  if (!ws.rootPath) return;
  const rootTreeNode = getTreeNode(ws, ws.rootPath);
  if (!rootTreeNode) return;

  const depthLimit = maxDepth ?? 3;
  yield* put(setBulkOperation(wsId, true));

  function* expandLoadedFileNode(node: FileNode, depth: number): SagaGenerator<void> {
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
          yield* call(expandLoadedFileNode, child, depth + 1);
        }
      }
    } else {
      for (const child of node.children) {
        if (child.type === "directory") {
          yield* call(expandLoadedFileNode, child, depth + 1);
        }
      }
    }
  }

  function* expandNormalizedNode(node: FileExplorerTreeNode, depth: number): SagaGenerator<void> {
    if (depth >= depthLimit) return;
    if (node.type !== "directory") return;

    if (!ws.expandedPaths.includes(node.path)) {
      yield* put(addExpandedPath(wsId, node.path));
    }
    if (node.children.length === 0) {
      const children = yield* call(loadDirectoryCore, wsId, node.path);
      yield* put(setChildrenAtPathAction(wsId, node.path, children));
      for (const child of children) {
        if (child.type === "directory") {
          yield* call(expandLoadedFileNode, child, depth + 1);
        }
      }
      return;
    }

    for (const childPath of node.children) {
      const child = getTreeNode(ws, childPath);
      if (child?.type === "directory") {
        yield* call(expandNormalizedNode, child, depth + 1);
      }
    }
  }

  yield* call(expandNormalizedNode, rootTreeNode, 0);
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
  const ws = yield* selectFileExplorerState.effect(wsId);
  if (!ws.workspacePath) return;

  yield* put(setFileExplorerLoading(wsId, true));

  // Reload gitignore, git status
  yield* call(loadGitignorePatterns, wsId);
  yield* call(loadGitStatusSaga, wsId);

  // Reload root
  const children = yield* call(loadDirectoryCore, wsId, ws.workspacePath);
  const rootFileNode: FileNode = {
    name: ws.workspacePath.split("/").pop() || "",
    path: ws.workspacePath,
    type: "directory",
    children,
  };

  yield* call(refreshAgentFileEditsForWorkspace, wsId);
  yield* put(setRootNode(wsId, rootFileNode));
  yield* put(setFileExplorerFileCount(wsId, countFilesInTree(rootFileNode)));
  yield* put(setFileExplorerLoading(wsId, false));
}

export function* handleRootNodeReplaced(
  action: ReturnType<typeof setRootNode>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  const ws = yield* selectFileExplorerState.effect(wsId);
  const expandedPaths = [...ws.expandedPaths]
    .filter((path) => path !== ws.workspacePath)
    .sort((a, b) => a.split("/").length - b.split("/").length);
  if (expandedPaths.length === 0) return;

  for (const path of expandedPaths) {
    try {
      const children = yield* call(loadDirectoryCore, wsId, path);
      yield* put(setChildrenAtPathAction(wsId, path, children));
    } catch (error) {
      logger.error("Failed to reload expanded directory after root replacement:", error, { wsId, path });
    }
  }
}

// ---------------------------------------------------------------------------
// Targeted directory refresh (create/delete of a single file)
// ---------------------------------------------------------------------------

/**
 * Compute the parent directory of a file path.
 * - Trailing "/" → treat the path itself as the directory.
 * - Equal to the workspace root → the directory IS the workspace root.
 * - Otherwise strip the final segment.
 * Returns null when the path has no usable separator.
 */
function computeParentDir(filePath: string, workspacePath: string): string | null {
  if (!filePath) return null;
  if (filePath === workspacePath) return workspacePath;
  if (filePath.endsWith("/")) {
    const trimmed = filePath.slice(0, -1);
    return trimmed || null;
  }
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  return filePath.slice(0, lastSlash);
}

export function* handleRefreshDirectory(
  action: ReturnType<typeof refreshDirectoryRequested>,
): SagaGenerator<void> {
  const [wsId, filePath] = action.payload;
  const ws = yield* selectFileExplorerState.effect(wsId);
  if (!ws.workspacePath) return;

  const parentDir = computeParentDir(filePath, ws.workspacePath);
  if (!parentDir) return;

  // Guard: events for paths outside the workspace are ignored defensively.
  if (parentDir !== ws.workspacePath && !parentDir.startsWith(ws.workspacePath + "/")) {
    return;
  }

  // If the directory is not currently loaded in the tree, lazy-expand will
  // populate it when the user opens it. No-op here.
  const node = getTreeNode(ws, parentDir);
  if (node?.type !== "directory") return;

  const children = yield* call(loadDirectoryCore, wsId, parentDir);
  yield* put(setChildrenAtPathAction(wsId, parentDir, children));

  // Keep git-status badges in sync surgically via the Wave 2 machinery
  // (applyGitStatusSnapshot under the hood). Avoids the full-tree path.
  yield* put(refreshGitStatusRequested(wsId));
}

// ---------------------------------------------------------------------------
// Refresh git status only
// ---------------------------------------------------------------------------

export function* handleRefreshGitStatus(
  action: ReturnType<typeof refreshGitStatusRequested>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  yield* call(loadGitStatusSaga, wsId);
  // Per-row selector memoization picks up only the changed rows — no treeVersion bump.
}

export function* handleRefreshAgentFileEdits(
  action: ReturnType<typeof refreshAgentFileEditsRequested>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  yield* call(refreshAgentFileEditsForWorkspace, wsId);
}

// ---------------------------------------------------------------------------
// Sync git status from other stores
// ---------------------------------------------------------------------------

export function* handleSyncGitStatusFromStores(
  action: ReturnType<typeof syncGitStatusFromStoresRequested>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  yield* call(loadGitStatusSaga, wsId);
  yield* call(refreshAgentFileEditsForWorkspace, wsId);
  // Per-row selector memoization picks up only the changed rows — no treeVersion bump.
}

// ---------------------------------------------------------------------------
// Set workspace path (re-initialize)
// ---------------------------------------------------------------------------

function* handleSetWorkspacePath(
  action: ReturnType<typeof setWorkspacePathRequested>,
): SagaGenerator<void> {
  const [wsId, path] = action.payload;
  yield* put(setFileExplorerWorkspacePath(wsId, path));
  // Re-initialize with the new path
  yield* put(initializeFileExplorer(wsId, { workspacePath: path }));
}

export function* handleWorkspaceEnvironmentConfigChange({
  payload,
  prevPayload,
}: {
  payload: FileExplorerEnvironmentConfigTrigger;
  prevPayload?: FileExplorerEnvironmentConfigTrigger | null;
}): SagaGenerator<void> {
  if (!prevPayload || !payload.wsId || payload.wsId !== prevPayload.wsId) return;

  const wsId = payload.wsId;
  const activeWsId = yield* selectActiveWorkspaceId.effect();
  if (activeWsId !== wsId) return;

  const currentEnvironmentConfig = payload.workspaceEnvironmentConfig
  if (!isRelevantEnvironmentConfigChange(prevPayload.workspaceEnvironmentConfig, currentEnvironmentConfig)) return;

  const workspacePath = yield* selectEffectiveFileExplorerWorkspacePath.effect(wsId);
  if (!workspacePath) return;

  yield* put(setRemoteConnectionIdAction(wsId, null));
  yield* put(setIsRemoteInitializedAction(wsId, false));
  yield* put(initializeFileExplorer(wsId, { workspacePath, workspaceId: wsId }));
}

function* watchWorkspaceEnvironmentConfigForFileExplorer(): SagaGenerator<void> {
  // Canonical trigger: the file-explorer saga watches the current workspace's
  // environmentConfig selector and owns remote-runtime reset + reinitialization.
  yield* takeLatestFromSelector(
    selectCurrentFileExplorerEnvironmentConfigTrigger,
    handleWorkspaceEnvironmentConfigChange,
  );
}

// ---------------------------------------------------------------------------
// Workspace lifecycle — mount/unmount
// ---------------------------------------------------------------------------

function* watchWorkspaceMountedForStore(): SagaGenerator<void> {
  yield* takeEvery(workspaceMounted, function* (action) {
    const [wsId] = action.payload;
    yield* put(setIsStoreActive(wsId, true));
    yield* call(replayPendingAgentFileEditsRefreshForWorkspace, wsId);
  });
}

function* watchWorkspaceUnmountedForStore(): SagaGenerator<void> {
  yield* takeEvery(workspaceUnmounted, function* (action) {
    const [wsId] = action.payload;
    yield* put(setIsStoreActive(wsId, false));
    pendingAgentFileEditsRefreshWorkspaceIds.delete(wsId);
    yield* put(clearFileExplorerForWorkspace(wsId));
  });
}

// ---------------------------------------------------------------------------
// IPC listeners
// ---------------------------------------------------------------------------

type WorkspaceChangesEvent = { workspaceId?: string };
type FileTrackingChangesEvent = { workspaceId?: string };
type AgentFileChangedEvent = { workspaceId?: string };

function agentFileEditsRefreshAction(wsId: string) {
  return debouncedAgentFileEditsRefresh(refreshAgentFileEditsRequested(wsId));
}

function getAgentFileEditsDebounceKey(action: StoreAction<any>): string {
  const [wsId] = action.payload ?? [];
  return typeof wsId === "string" && wsId.length > 0 ? `${action.type}:${wsId}` : action.type;
}

export function* replayPendingAgentFileEditsRefreshForWorkspace(
  wsId: string,
): SagaGenerator<void> {
  if (!pendingAgentFileEditsRefreshWorkspaceIds.has(wsId)) return;
  const activeWsId = yield* selectActiveWorkspaceId.effect();
  if (activeWsId !== wsId) return;
  pendingAgentFileEditsRefreshWorkspaceIds.delete(wsId);
  yield* put(agentFileEditsRefreshAction(wsId));
}

export function* handleWorkspaceChangesEvent(data: WorkspaceChangesEvent): SagaGenerator<void> {
  const eventWsId = data?.workspaceId;
  if (!eventWsId) return;
  const activeWsId = yield* selectActiveWorkspaceId.effect();
  if (eventWsId !== activeWsId) return;
  yield* put(syncGitStatusFromStoresRequested(eventWsId));
}

function* watchWorkspaceChangesIPC() {
  yield* takeEveryFromElectronChannel<WorkspaceChangesEvent>(
    "workspace-changes",
    handleWorkspaceChangesEvent,
  );
}

export function* handleFileTrackingChangesEvent(data: FileTrackingChangesEvent): SagaGenerator<void> {
  const eventWsId = data?.workspaceId;
  const activeWsId = yield* selectActiveWorkspaceId.effect();
  // Match legacy gating: allow events without a workspaceId, or scoped to the
  // active workspace. Fall back to active workspace id when none provided.
  if (eventWsId && eventWsId !== activeWsId) return;
  const targetWsId = eventWsId || activeWsId;
  if (!targetWsId) return;
  // Route through the wrapper action so repeated events inside the debounce
  // window collapse to a single sync.
  yield* put(debouncedFileTrackingSync(syncGitStatusFromStoresRequested(targetWsId)));
}

function* watchFileTrackingChangesIPC() {
  yield* takeEveryFromElectronChannel<FileTrackingChangesEvent>(
    "file-tracking:changes-updated",
    handleFileTrackingChangesEvent,
  );
}

export function* handleAgentFileChangedEvent(data: AgentFileChangedEvent): SagaGenerator<void> {
  const eventWsId = data?.workspaceId;
  const activeWsId = yield* selectActiveWorkspaceId.effect();
  if (eventWsId && eventWsId !== activeWsId) {
    pendingAgentFileEditsRefreshWorkspaceIds.add(eventWsId);
    return;
  }
  const targetWsId = eventWsId || activeWsId;
  if (!targetWsId) return;
  yield* put(agentFileEditsRefreshAction(targetWsId));
}

function* watchAgentFileChangedIPC() {
  yield* takeEveryFromElectronChannel<AgentFileChangedEvent>(
    "file-tracking:agent-file-changed",
    handleAgentFileChangedEvent,
  );
}

export function* handleFileTrackingListenerReadyEvent(
  data: AgentFileChangedEvent,
): SagaGenerator<void> {
  const eventWsId = data?.workspaceId;
  if (!eventWsId) return;
  const activeWsId = yield* selectActiveWorkspaceId.effect();
  if (eventWsId !== activeWsId) {
    pendingAgentFileEditsRefreshWorkspaceIds.add(eventWsId);
    return;
  }
  yield* put(agentFileEditsRefreshAction(eventWsId));
}

function* watchFileTrackingListenerReadyIPC() {
  yield* takeEveryFromElectronChannel<AgentFileChangedEvent>(
    "file-tracking:listener-ready",
    handleFileTrackingListenerReadyEvent,
  );
}

// ---------------------------------------------------------------------------
// Window event listener — file:changed
// ---------------------------------------------------------------------------

type FileChangedDetail = {
  workspaceId?: string;
  type?: "change" | "create" | "add" | "delete" | string;
  filePath?: string;
  files?: string[];
};

const FILE_CHANGED_REFRESH_DELAY_MS = 300;

/**
 * Pick the first concrete file path from a file:changed event payload.
 * Emitters vary: some use `files: string[]` (saves, diagram creates), others
 * use `filePath: string` (create/delete/undo from tabs and the file tree).
 */
function extractFilePath(detail: FileChangedDetail): string | undefined {
  if (detail.files && detail.files.length > 0) return detail.files[0];
  return detail.filePath;
}

export function* handleFileChangedWindowEvent(detail: FileChangedDetail): SagaGenerator<void> {
  const eventWsId = detail?.workspaceId;
  if (!eventWsId) return;
  const activeWsId = yield* selectActiveWorkspaceId.effect();
  if (eventWsId !== activeWsId) return;

  const changeType = detail?.type;
  if (changeType === "create" || changeType === "add" || changeType === "delete") {
    yield* delay(FILE_CHANGED_REFRESH_DELAY_MS);
    const filePath = extractFilePath(detail);
    if (filePath) {
      yield* put(refreshDirectoryRequested(eventWsId, filePath));
    } else {
      // Defensive fallback: emitter didn't include a path, fall back to the
      // full-tree reload so the change doesn't get dropped.
      yield* put(refreshFileExplorer(eventWsId));
    }
    yield* put(agentFileEditsRefreshAction(eventWsId));
  } else if (changeType === "change") {
    yield* put(refreshGitStatusRequested(eventWsId));
    yield* put(agentFileEditsRefreshAction(eventWsId));
  }
}

function* watchFileChangedWindowEvent() {
  yield* takeEveryFromWindowEvent<FileChangedDetail>(
    "file:changed",
    handleFileChangedWindowEvent,
  );
}

// ---------------------------------------------------------------------------
// IPC listener — file:changed (main-process WorkspaceEvent)
// ---------------------------------------------------------------------------

/**
 * Shape of `file:changed` events sent from the main process via
 * `broadcastEvent` (see `src/store/main/slices/workspace-events/sagas/broadcast-saga.ts`).
 * These are full `FileChangedEvent` payloads keyed off `data.action`, distinct
 * from the window CustomEvent shape emitted by Svelte components.
 */
type MainProcessFileChangedEvent = {
  workspaceId?: string;
  data?: {
    path?: string;
    relativePath?: string;
    action?: "create" | "modify" | "delete" | "rename" | string;
    oldPath?: string;
  };
};

function normalizeMainProcessFileChanged(
  event: MainProcessFileChangedEvent,
): FileChangedDetail | null {
  const action = event?.data?.action;
  if (!action) return null;
  // Map the main-process action vocabulary onto the window-event type vocabulary
  // so the shared handler handles both flows identically. 'rename' has no direct
  // analogue — refresh the new path's parent directory, same as 'create'.
  const type =
    action === "modify"
      ? "change"
      : action === "rename"
        ? "create"
        : action;
  return {
    workspaceId: event.workspaceId,
    type,
    filePath: event?.data?.path,
  };
}

export function* handleFileChangedIPCEvent(
  event: MainProcessFileChangedEvent,
): SagaGenerator<void> {
  const detail = normalizeMainProcessFileChanged(event);
  if (!detail) return;
  // Delegate to the shared handler so the workspace-id gate, 300ms debounce,
  // refreshDirectoryRequested path, and full-refresh fallback all apply.
  yield* call(handleFileChangedWindowEvent, detail);
}

function* watchFileChangedIPC() {
  yield* takeEveryFromElectronChannel<MainProcessFileChangedEvent>(
    "file:changed",
    handleFileChangedIPCEvent,
  );
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* fileExplorerSaga(): SagaGenerator<void> {
  resetAgentFileEditsRefreshState();

  yield* fork(watchWorkspaceMountedForStore);
  yield* fork(watchWorkspaceUnmountedForStore);
  yield* fork(watchWorkspaceChangesIPC);
  yield* fork(watchFileTrackingChangesIPC);
  yield* fork(watchAgentFileChangedIPC);
  yield* fork(watchFileTrackingListenerReadyIPC);
  yield* fork(watchFileChangedWindowEvent);
  yield* fork(watchFileChangedIPC);
  yield* fork(watchWorkspaceEnvironmentConfigForFileExplorer);
  yield* fork(debounceSaga, debouncedFileTrackingSync, 300);
  yield* fork(
    debounceWithKeySaga,
    debouncedAgentFileEditsRefresh,
    300,
    getAgentFileEditsDebounceKey,
  );
  yield* takeLatest(initializeFileExplorer, initializeFileExplorerSaga);
  yield* takeLatest(setRootNode, handleRootNodeReplaced);
  yield* takeEvery(toggleDirectoryRequested, handleToggleDirectory);
  yield* takeLatest(expandToPathRequested, handleExpandToPath);
  yield* takeLatest(expandAllRequested, handleExpandAll);
  yield* takeLatest(refreshFileExplorer, handleRefresh);
  yield* takeEvery(refreshDirectoryRequested, handleRefreshDirectory);
  yield* takeLatest(refreshGitStatusRequested, handleRefreshGitStatus);
  yield* takeEvery(refreshAgentFileEditsRequested, handleRefreshAgentFileEdits);
  yield* takeLatest(syncGitStatusFromStoresRequested, handleSyncGitStatusFromStores);
  yield* takeLatest(setWorkspacePathRequested, handleSetWorkspacePath);
}