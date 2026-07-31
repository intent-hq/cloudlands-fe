import type { Task } from 'redux-saga';
import { call, cancel, cancelled, put, spawn, take, type SagaGenerator } from 'typed-redux-saga';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { getAgentFileEdits, propagateAgentEditsToParents } from '$lib/utils/agent-file-edits';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import type { FileGitStatus, FileNode } from '$shared/types';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectFileExplorerState } from '../file-explorer-selectors';
import {
  addExpandedPath,
  addLoadingPath,
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
} from '../file-explorer-slice';

const logger = createLogger('FileExplorerSaga');

type RunningTask = { wsId: string; task?: Task; token: symbol };
type TaskWorker = () => SagaGenerator<void>;
type EditSlot = { wsId: string; task?: Task; pending: boolean };

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
    completed = true;
  } finally {
    if (completed && !(yield* cancelled())) {
      yield* put(setFileExplorerLoading(wsId, false));
      yield* put(setFileExplorerInitialized(wsId, true));
    }
  }
  yield* call(loadAgentFileEdits, wsId);
}

function* hydrateExplorer(wsId: string) {
  const existing = yield* selectFileExplorerState.effect(wsId);
  if (existing.isInitialized || existing.isLoading) return;
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

function* runEditRefresh(slots: Map<string, EditSlot>, slot: EditSlot): SagaGenerator<void> {
  try {
    yield* call(loadAgentFileEdits, slot.wsId);
  } finally {
    if (slots.get(slot.wsId) !== slot) return;
    slot.task = undefined;
    if (!slot.pending) {
      slots.delete(slot.wsId);
      return;
    }
    slot.pending = false;
    const task = yield* spawn(runEditRefresh, slots, slot);
    if (slots.get(slot.wsId) === slot) slot.task = task;
  }
}

function* queueEditRefresh(slots: Map<string, EditSlot>, wsId: string) {
  if (!wsId) return;
  const existing = slots.get(wsId);
  if (existing?.task) {
    existing.pending = true;
    return;
  }
  const slot: EditSlot = { wsId, pending: false };
  slots.set(wsId, slot);
  const task = yield* spawn(runEditRefresh, slots, slot);
  if (slots.get(wsId) === slot) slot.task = task;
}

function* startTask(
  tasks: Map<string, RunningTask>,
  key: string,
  wsId: string,
  latest: boolean,
  worker: TaskWorker,
) {
  const existing = tasks.get(key);
  if (existing) {
    if (!latest) return;
    tasks.delete(key);
    if (existing.task) yield* cancel(existing.task);
  }
  const token = Symbol(key);
  tasks.set(key, { wsId, token });
  const task = yield* spawn(function* () {
    try {
      yield* worker();
    } finally {
      if (tasks.get(key)?.token === token) tasks.delete(key);
    }
  });
  if (tasks.get(key)?.token === token) tasks.set(key, { wsId, task, token });
}

export function* fileExplorerSaga() {
  const tasks = new Map<string, RunningTask>();
  const editSlots = new Map<string, EditSlot>();
  try {
    while (true) {
      const action: { type: string; payload: unknown } = yield* take([
        initializeFileExplorer,
        toggleDirectoryRequested,
        expandToPathRequested,
        expandAllRequested,
        refreshFileExplorer,
        hydrateFileExplorerRequested,
        refreshDirectoryRequested,
        refreshAgentFileEditsRequested,
        syncGitStatusFromStoresRequested,
        workspaceDeleted,
        workspaceUnmounted,
      ]);
      const [wsId] = action.payload as [string];
      if (action.type === initializeFileExplorer.type) {
        const request = action as ReturnType<typeof initializeFileExplorer>;
        yield* call(startTask, tasks, `initialize:${wsId}`, wsId, false, function* () {
          yield* call(initializeExplorer, request);
        });
      } else if (action.type === toggleDirectoryRequested.type) {
        const request = action as ReturnType<typeof toggleDirectoryRequested>;
        const [, path] = request.payload;
        yield* call(startTask, tasks, `directory:${wsId}:${path}`, wsId, false, function* () {
          yield* call(toggleDirectory, request);
        });
      } else if (action.type === expandToPathRequested.type) {
        const request = action as ReturnType<typeof expandToPathRequested>;
        yield* call(startTask, tasks, `expand-to:${wsId}`, wsId, true, function* () {
          yield* call(expandToPath, request);
        });
      } else if (action.type === expandAllRequested.type) {
        const request = action as ReturnType<typeof expandAllRequested>;
        yield* call(startTask, tasks, `expand-all:${wsId}`, wsId, true, function* () {
          yield* call(expandAll, request);
        });
      } else if (action.type === refreshFileExplorer.type) {
        yield* call(startTask, tasks, `refresh:${wsId}`, wsId, false, function* () {
          yield* call(refreshTree, wsId);
        });
      } else if (action.type === hydrateFileExplorerRequested.type) {
        yield* call(startTask, tasks, `hydrate:${wsId}`, wsId, false, function* () {
          yield* call(hydrateExplorer, wsId);
        });
      } else if (action.type === refreshDirectoryRequested.type) {
        const request = action as ReturnType<typeof refreshDirectoryRequested>;
        const [, path] = request.payload;
        yield* call(
          startTask,
          tasks,
          `directory-refresh:${wsId}:${path}`,
          wsId,
          false,
          function* () {
            yield* call(refreshDirectory, request);
          },
        );
      } else if (
        action.type === refreshAgentFileEditsRequested.type ||
        action.type === syncGitStatusFromStoresRequested.type
      ) {
        yield* call(queueEditRefresh, editSlots, wsId);
      } else {
        for (const [key, running] of tasks) {
          if (running.wsId !== wsId) continue;
          tasks.delete(key);
          if (running.task) yield* cancel(running.task);
        }
        const edits = editSlots.get(wsId);
        if (edits) {
          editSlots.delete(wsId);
          edits.pending = false;
          if (edits.task) yield* cancel(edits.task);
        }
      }
    }
  } finally {
    for (const running of tasks.values()) if (running.task) yield* cancel(running.task);
    for (const slot of editSlots.values()) if (slot.task) yield* cancel(slot.task);
    tasks.clear();
    editSlots.clear();
  }
}
