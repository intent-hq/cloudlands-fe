import {
  call,
  cancelled,
  put,
  race,
  take,
  takeLatest,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { getAgentFileEdits, propagateAgentEditsToParents } from '$lib/utils/agent-file-edits';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import type { FileGitStatus, FileNode } from '$shared/types';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { takeLatestByContext } from '../../../utils/context-saga-effects';
import { selectFileExplorerState } from '../file-explorer-selectors';
import {
  addExpandedPath,
  addLoadingPath,
  expandAllRequested,
  expandToPathRequested,
  hydrateFileExplorerRequested,
  incrementTreeVersion,
  initializeFileExplorer,
  refreshDirectoryRequested,
  refreshFileExplorer,
  removeAgentFileEditsEntries,
  removeExpandedPath,
  removeLoadingPath,
  setBulkOperation,
  setChildrenAtPathAction,
  setFileExplorerFileCount,
  setFileExplorerError,
  setFileExplorerInitialized,
  setFileExplorerLoading,
  setFileExplorerWorkspacePath,
  setGitStatusMap,
  setRootNode,
  syncGitStatusFromStoresRequested,
  toggleDirectoryRequested,
  updateAgentFileEditsEntries,
} from '../file-explorer-slice';

const logger = createLogger('FileExplorerSaga');

type ObservedAction = { type: string; payload?: unknown };
type EditRefreshAction = ReturnType<typeof syncGitStatusFromStoresRequested>;

function isWorkspaceCleanup(action: ObservedAction, wsId: string): boolean {
  return (
    action.type === workspaceUnmounted.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === wsId
  );
}

function mapFileNode(node: FileNode, path: string, anchorChildren: boolean): FileNode {
  const mapped: FileNode = { name: node.name, path, type: node.type };
  if (node.size !== undefined) mapped.size = node.size;
  if (node.modified !== undefined) mapped.modified = node.modified;
  if (node.isGitignored !== undefined) mapped.isGitignored = node.isGitignored;
  if (node.type === 'directory') {
    mapped.children = (node.children ?? []).map((child) =>
      mapFileNode(child, anchorChildren ? `${path}/${child.name}` : child.path, anchorChildren),
    );
  }
  return mapped;
}

function mapGitStatus(status: Record<string, FileGitStatus>): Record<string, FileGitStatus> {
  const mapped: Record<string, FileGitStatus> = {};
  for (const [path, entry] of Object.entries(status)) {
    mapped[path] = {
      status: entry.status,
      ...(entry.additions === undefined ? {} : { additions: entry.additions }),
      ...(entry.deletions === undefined ? {} : { deletions: entry.deletions }),
    };
  }
  return mapped;
}

function onlyDirectoryChild(children: readonly FileNode[]): FileNode | null {
  if (children.length !== 1) return null;
  return children[0].type === 'directory' ? children[0] : null;
}

function countFiles(node: FileNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((count, child) => count + countFiles(child), 0);
}

function collectDirectoryPaths(node: FileNode, result: string[] = []): string[] {
  if (node.type !== 'directory') return result;
  result.push(node.path);
  for (const child of node.children ?? []) collectDirectoryPaths(child, result);
  return result;
}

function computeParentDir(filePath: string, workspacePath: string): string | null {
  if (!filePath || !workspacePath || filePath === workspacePath) return null;
  if (!filePath.startsWith(`${workspacePath}/`)) return null;
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  const parent = filePath.slice(0, lastSlash);
  return parent === workspacePath || parent.startsWith(`${workspacePath}/`) ? parent : null;
}

function* loadDirectoryChildren(wsId: string, dirPath: string): SagaGenerator<FileNode[]> {
  const ws = yield* selectFileExplorerState.effect(wsId);
  const relativePath = stripWorkspacePrefix(dirPath, ws.workspacePath);
  yield* put(addLoadingPath(wsId, dirPath));
  try {
    const response: Awaited<ReturnType<typeof appClient.files.listDirectory>> = yield* call(
      [appClient.files, appClient.files.listDirectory],
      wsId,
      relativePath,
    );
    const children = response.map((node) => mapFileNode(node, `${dirPath}/${node.name}`, true));
    yield* put(setChildrenAtPathAction(wsId, dirPath, children));
    return children;
  } catch (error) {
    logger.error('Failed to load directory children', error);
    return [];
  } finally {
    const latest = yield* selectFileExplorerState.effect(wsId);
    if (latest.loadingPaths.includes(dirPath)) yield* put(removeLoadingPath(wsId, dirPath));
  }
}

function* loadAgentFileEdits(wsId: string) {
  try {
    const edits: Map<string, string[]> = yield* call(getAgentFileEdits, wsId);
    const record: Record<string, string[]> = {};
    for (const [path, agents] of edits) record[path] = [...agents];
    const ws = yield* selectFileExplorerState.effect(wsId);
    if (ws.workspacePath) {
      const propagated = propagateAgentEditsToParents(edits, ws.workspacePath, ws.workspacePath);
      for (const [path, agents] of propagated) {
        if (!record[path]) record[path] = [...agents];
      }
    }
    const stale = Object.keys(ws.agentFileEdits).filter((path) => !(path in record));
    if (stale.length > 0) yield* put(removeAgentFileEditsEntries(wsId, stale));
    if (Object.keys(record).length > 0) yield* put(updateAgentFileEditsEntries(wsId, record));
  } catch (error) {
    logger.error('Failed to load agent file edits', error);
  }
}

function* initializeExplorer(action: ReturnType<typeof initializeFileExplorer>) {
  const [wsId, options] = action.payload;
  if (!wsId || !options.workspacePath) return;
  const existing = yield* selectFileExplorerState.effect(wsId);
  if (existing.isLoading) return;
  if (
    existing.isInitialized &&
    existing.workspacePath === options.workspacePath &&
    existing.rootPath
  )
    return;
  yield* put(setFileExplorerWorkspacePath(wsId, options.workspacePath));
  yield* put(setFileExplorerLoading(wsId, true));
  let completed = false;
  try {
    const response: Awaited<ReturnType<typeof appClient.files.explorerTree>> = yield* call(
      [appClient.files, appClient.files.explorerTree],
      wsId,
    );
    if (response) {
      const root: FileNode = {
        name: options.workspacePath.split('/').pop() || options.workspacePath,
        path: options.workspacePath,
        type: 'directory',
        children: (response.children ?? []).map((child) =>
          mapFileNode(child, `${options.workspacePath}/${child.name}`, true),
        ),
      };
      yield* put(setRootNode(wsId, root));
      yield* put(addExpandedPath(wsId, options.workspacePath));
    }
    completed = true;
  } catch (error) {
    logger.error('Failed to initialize file explorer', error);
    yield* put(setFileExplorerError(wsId, error instanceof Error ? error.message : String(error)));
    completed = true;
  } finally {
    if (completed && !(yield* cancelled())) {
      yield* put(setFileExplorerLoading(wsId, false));
      yield* put(setFileExplorerInitialized(wsId, true));
    }
  }
  yield* call(loadAgentFileEdits, wsId);
}

function* hydrateExplorer(wsId: string, force = false) {
  const existing = yield* selectFileExplorerState.effect(wsId);
  if (!force && (existing.isInitialized || existing.isLoading)) return;
  yield* put(setFileExplorerLoading(wsId, true));
  let completed = false;
  try {
    const response: Awaited<ReturnType<typeof appClient.files.explorerTree>> = yield* call(
      [appClient.files, appClient.files.explorerTree],
      wsId,
    );
    if (response) {
      const tree = mapFileNode(response, response.path, false);
      yield* put(setFileExplorerWorkspacePath(wsId, tree.path));
      yield* put(setRootNode(wsId, tree));
      const gitStatus: Awaited<ReturnType<typeof appClient.files.gitStatusMap>> = yield* call(
        [appClient.files, appClient.files.gitStatusMap],
        wsId,
      );
      yield* put(setGitStatusMap(wsId, mapGitStatus(gitStatus)));
      for (const path of collectDirectoryPaths(tree)) yield* put(addExpandedPath(wsId, path));
      yield* put(setFileExplorerFileCount(wsId, countFiles(tree)));
    }
    completed = true;
  } catch (error) {
    logger.error('Failed to hydrate file explorer for workspace', error);
    yield* put(setFileExplorerError(wsId, error instanceof Error ? error.message : String(error)));
    completed = true;
  } finally {
    if (completed && !(yield* cancelled())) {
      yield* put(setFileExplorerLoading(wsId, false));
      yield* put(setFileExplorerInitialized(wsId, true));
    }
  }
}

function* toggleDirectory(action: ReturnType<typeof toggleDirectoryRequested>) {
  const [wsId, nodePath] = action.payload;
  const ws = yield* selectFileExplorerState.effect(wsId);
  if (ws.expandedPaths.includes(nodePath)) {
    yield* put(removeExpandedPath(wsId, nodePath));
    return;
  }
  yield* put(addExpandedPath(wsId, nodePath));
  const visited = new Set<string>([nodePath]);
  let current = nodePath;
  while (true) {
    const children = yield* call(loadDirectoryChildren, wsId, current);
    const next = onlyDirectoryChild(children);
    if (!next || visited.has(next.path)) return;
    current = next.path;
    visited.add(current);
    const fresh = yield* selectFileExplorerState.effect(wsId);
    if (!fresh.expandedPaths.includes(current)) yield* put(addExpandedPath(wsId, current));
  }
}

function* expandToPath(action: ReturnType<typeof expandToPathRequested>) {
  const [wsId, targetPath] = action.payload;
  const ws = yield* selectFileExplorerState.effect(wsId);
  if (!ws.workspacePath) return;
  const parts = stripWorkspacePrefix(targetPath, ws.workspacePath).split('/').filter(Boolean);
  let current = ws.workspacePath;
  yield* put(setBulkOperation(wsId, true));
  let completed = false;
  try {
    for (let index = 0; index < parts.length; index += 1) {
      current = `${current}/${parts[index]}`;
      if (index === parts.length - 1 && !targetPath.endsWith('/')) continue;
      const fresh = yield* selectFileExplorerState.effect(wsId);
      if (!fresh.expandedPaths.includes(current)) yield* put(addExpandedPath(wsId, current));
      const node = getItem(fresh.nodes, current);
      if (!node || node.type !== 'directory' || node.children.length === 0) {
        yield* call(loadDirectoryChildren, wsId, current);
      }
    }
    completed = true;
  } finally {
    if (completed && !(yield* cancelled())) {
      yield* put(setBulkOperation(wsId, false));
      yield* put(incrementTreeVersion(wsId));
    }
  }
}

function* expandNode(
  wsId: string,
  path: string,
  depth: number,
  limit: number,
): SagaGenerator<void> {
  if (depth >= limit) return;
  const ws = yield* selectFileExplorerState.effect(wsId);
  const node = getItem(ws.nodes, path);
  if (!node || node.type !== 'directory') return;
  if (!ws.expandedPaths.includes(path)) yield* put(addExpandedPath(wsId, path));
  let childPaths = node.children;
  if (childPaths.length === 0) {
    const children = yield* call(loadDirectoryChildren, wsId, path);
    childPaths = children.filter((child) => child.type === 'directory').map((child) => child.path);
  }
  for (const childPath of childPaths) yield* call(expandNode, wsId, childPath, depth + 1, limit);
}

function* expandAll(action: ReturnType<typeof expandAllRequested>) {
  const [wsId, maxDepth] = action.payload;
  const ws = yield* selectFileExplorerState.effect(wsId);
  if (!ws.rootPath || !getItem(ws.nodes, ws.rootPath)) return;
  yield* put(setBulkOperation(wsId, true));
  let completed = false;
  try {
    yield* call(expandNode, wsId, ws.rootPath, 0, maxDepth ?? 3);
    completed = true;
  } finally {
    if (completed && !(yield* cancelled())) {
      yield* put(setBulkOperation(wsId, false));
      yield* put(incrementTreeVersion(wsId));
    }
  }
}

function* refreshTree(wsId: string) {
  const ws = yield* selectFileExplorerState.effect(wsId);
  if (!ws.rootPath) return;
  yield* put(setFileExplorerLoading(wsId, true));
  let completed = false;
  try {
    const targets = [ws.rootPath, ...ws.expandedPaths.filter((path) => path !== ws.rootPath)];
    for (const path of new Set(targets)) {
      const fresh = yield* selectFileExplorerState.effect(wsId);
      const node = getItem(fresh.nodes, path);
      if (node?.type === 'directory') yield* call(loadDirectoryChildren, wsId, path);
    }
    completed = true;
  } finally {
    if (completed && !(yield* cancelled())) yield* put(setFileExplorerLoading(wsId, false));
  }
  yield* call(loadAgentFileEdits, wsId);
}

function* refreshDirectory(action: ReturnType<typeof refreshDirectoryRequested>) {
  const [wsId, filePath] = action.payload;
  const ws = yield* selectFileExplorerState.effect(wsId);
  const parent = computeParentDir(filePath, ws.workspacePath);
  if (!parent || getItem(ws.nodes, parent)?.type !== 'directory') return;
  yield* call(loadDirectoryChildren, wsId, parent);
}

function* initializeExplorerWorker(action: ReturnType<typeof initializeFileExplorer>) {
  const [wsId] = action.payload;
  if (!wsId) return;
  yield* race({
    initialize: call(initializeExplorer, action),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, wsId)),
  });
}

function* toggleDirectoryWorker(action: ReturnType<typeof toggleDirectoryRequested>) {
  const [wsId] = action.payload;
  if (!wsId) return;
  yield* race({
    toggle: call(toggleDirectory, action),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, wsId)),
  });
}

function* expandToPathWorker(action: ReturnType<typeof expandToPathRequested>) {
  const [wsId] = action.payload;
  if (!wsId) return;
  yield* race({
    expand: call(expandToPath, action),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, wsId)),
  });
}

function* expandAllWorker(action: ReturnType<typeof expandAllRequested>) {
  const [wsId] = action.payload;
  if (!wsId) return;
  yield* race({
    expand: call(expandAll, action),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, wsId)),
  });
}

function* refreshExplorerWorker(action: ReturnType<typeof refreshFileExplorer>) {
  const [wsId] = action.payload;
  if (!wsId) return;
  yield* race({
    refresh: call(refreshTree, wsId),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, wsId)),
  });
}

function* hydrateExplorerWorker(action: ReturnType<typeof hydrateFileExplorerRequested>) {
  const [wsId, force] = action.payload;
  if (!wsId) return;
  yield* race({
    hydrate: call(hydrateExplorer, wsId, force),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, wsId)),
  });
}

function* refreshDirectoryWorker(action: ReturnType<typeof refreshDirectoryRequested>) {
  const [wsId] = action.payload;
  if (!wsId) return;
  yield* race({
    refresh: call(refreshDirectory, action),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, wsId)),
  });
}

function* refreshAgentEditsWorker(action: EditRefreshAction) {
  const [wsId] = action.payload;
  if (!wsId) return;
  yield* race({
    refresh: call(loadAgentFileEdits, wsId),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, wsId)),
  });
}

export function* fileExplorerSaga() {
  yield* takeLeading(initializeFileExplorer, initializeExplorerWorker);
  yield* takeLeading(toggleDirectoryRequested, toggleDirectoryWorker);
  yield* takeLatest(expandToPathRequested, expandToPathWorker);
  yield* takeLatest(expandAllRequested, expandAllWorker);
  yield* takeLeading(refreshFileExplorer, refreshExplorerWorker);
  yield* takeLatestByContext(
    hydrateFileExplorerRequested,
    (action) => ({
      context: action.payload[0],
      force: action.payload[1],
      generation: action.payload[2] ?? 0,
    }),
    hydrateExplorerWorker,
  );
  yield* takeLeading(refreshDirectoryRequested, refreshDirectoryWorker);
  yield* takeLeading([syncGitStatusFromStoresRequested], refreshAgentEditsWorker);
}
