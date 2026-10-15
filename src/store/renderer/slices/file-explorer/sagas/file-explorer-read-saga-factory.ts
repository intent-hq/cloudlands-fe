import { call, cancelled, put, race, take, type SagaGenerator } from 'typed-redux-saga';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type { StoreAction } from '@themislib/themis/types';
import type { FileNode } from '$shared/types';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import type { FileExplorerWorkspaceState } from '../file-explorer-types';
import { mapFileNode } from '../file-explorer-utils';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  takeLatestInContext,
  takeLeadingInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import {
  addExpandedPath,
  addLoadingPath,
  expandAllRequested,
  expandToPathRequested,
  incrementTreeVersion,
  initializeFileExplorer,
  refreshDirectoryRequested,
  refreshFileExplorer,
  removeExpandedPath,
  removeLoadingPath,
  setBulkOperation,
  setChildrenAtPathAction,
  setFileExplorerError,
  setFileExplorerInitialized,
  setFileExplorerLoading,
  setFileExplorerWorkspacePath,
  setRootNode,
  toggleDirectoryRequested,
  directoryReadStarted,
  directoryReadSettled,
  retireFileExplorer,
} from '../file-explorer-slice';

type ObservedAction = { type: string; payload?: unknown };
type ReaderGuard = () => boolean;

/** One lazy directory policy, bound by each renderer's owning Store. */
export function createFileExplorerReadSaga({
  files,
  selectFileExplorerState,
  admission,
  compactChains = true,
  bounded = false,
  onLoaded,
  onError,
}: {
  files: {
    explorerTree: (workspaceId: string, isCurrent?: ReaderGuard) => Promise<FileNode | null>;
    listDirectory: (
      workspaceId: string,
      path: string,
      isCurrent?: ReaderGuard,
    ) => Promise<FileNode[]>;
  };
  selectFileExplorerState: { effect: (wsId: string) => SagaGenerator<FileExplorerWorkspaceState> };
  admission?: {
    /** Include backend, principal epoch and absolute root identity in this context. */
    readCurrentContext: (wsId: string) => string | null;
    /** Final synchronous publication after the last admission check. */
    dispatch: (action: StoreAction<unknown>) => unknown;
  };
  compactChains?: boolean;
  /** Do not register automatic ancestor/full-tree expansion in a bounded browser. */
  bounded?: boolean;
  onLoaded?: (wsId: string) => SagaGenerator<void>;
  onError?: (error: unknown) => void;
}) {
  function* publish(action: StoreAction<unknown>, isCurrent: ReaderGuard): SagaGenerator<boolean> {
    if (!admission) {
      if (!isCurrent()) return false;
      yield* put(action);
      return true;
    }
    return yield* call(() => {
      if (!isCurrent()) return false;
      admission.dispatch(action);
      return true;
    });
  }

  function* runGuarded(
    action: { type: string; payload: readonly unknown[] },
    worker: (isCurrent: ReaderGuard) => SagaGenerator<void>,
  ): SagaGenerator<void> {
    const wsId = action.payload[0] as string;
    if (!wsId) return;
    const context = admission?.readCurrentContext(wsId);
    if (context === null) return;
    const ws = yield* selectFileExplorerState.effect(wsId);
    const root =
      action.type === initializeFileExplorer.type
        ? (action.payload[1] as { workspacePath: string }).workspacePath
        : ws.workspacePath;
    const matchesRetirement = (event: ObservedAction) =>
      Array.isArray(event.payload) &&
      event.payload[0] === wsId &&
      (event.type === workspaceUnmounted.type ||
        event.type === retireFileExplorer.type ||
        (event.type === setFileExplorerWorkspacePath.type && event.payload[1] !== root) ||
        (action.type !== refreshFileExplorer.type && event.type === refreshFileExplorer.type));
    let active = true;
    const isCurrent = () => active && admission?.readCurrentContext(wsId) === context;
    try {
      yield* race({
        work: call(worker, isCurrent),
        cleanup: take(matchesRetirement),
      });
    } finally {
      active = false;
    }
  }

  function onlyDirectoryChild(children: readonly FileNode[]): FileNode | null {
    if (children.length !== 1) return null;
    return children[0].type === 'directory' ? children[0] : null;
  }

  function computeParentDir(filePath: string, workspacePath: string): string | null {
    if (!filePath || !workspacePath || filePath === workspacePath) return null;
    if (!filePath.startsWith(`${workspacePath}/`)) return null;
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash <= 0) return null;
    const parent = filePath.slice(0, lastSlash);
    return parent === workspacePath || parent.startsWith(`${workspacePath}/`) ? parent : null;
  }

  let requestSequence = 0;
  const activeReads = new Map<string, string>();

  function* loadDirectoryChildren(
    wsId: string,
    dirPath: string,
    isCurrent: ReaderGuard,
  ): SagaGenerator<FileNode[]> {
    const ws = yield* selectFileExplorerState.effect(wsId);
    if (!isCurrent() || getItem(ws.nodes, dirPath)?.type !== 'directory') return [];
    const relativePath = stripWorkspacePrefix(dirPath, ws.workspacePath);
    const key = JSON.stringify([wsId, dirPath]);
    const requestId = String(++requestSequence);
    activeReads.set(key, requestId);
    const current = () => isCurrent() && activeReads.get(key) === requestId;
    let failure: string | null = null;
    try {
      yield* publish(directoryReadStarted(wsId, dirPath, requestId), current);
      yield* publish(addLoadingPath(wsId, dirPath), current);
      if (dirPath === ws.rootPath) yield* publish(setFileExplorerError(wsId, null), current);
      const response = yield* call(() => {
        if (!current()) return Promise.resolve([]);
        return admission
          ? files.listDirectory(wsId, relativePath, current)
          : files.listDirectory(wsId, relativePath);
      });
      if (!current()) return [];
      const latest = yield* selectFileExplorerState.effect(wsId);
      if (
        latest.workspacePath !== ws.workspacePath ||
        latest.directoryRequests[dirPath] !== requestId
      )
        return [];
      const children = response.map((node) => mapFileNode(node, `${dirPath}/${node.name}`, true));
      if (!(yield* publish(setChildrenAtPathAction(wsId, dirPath, children, requestId), current)))
        return [];
      return children;
    } catch (error) {
      if (current()) {
        onError?.(error);
        failure = error instanceof Error ? error.message : String(error);
      }
      return [];
    } finally {
      const latest = yield* selectFileExplorerState.effect(wsId);
      if (latest.directoryRequests[dirPath] === requestId && current()) {
        if (latest.loadingPaths.includes(dirPath))
          yield* publish(removeLoadingPath(wsId, dirPath), current);
        if (dirPath === ws.rootPath) yield* publish(setFileExplorerError(wsId, failure), current);
        yield* publish(
          directoryReadSettled(wsId, dirPath, requestId, dirPath === ws.rootPath ? null : failure),
          current,
        );
      }
      if (activeReads.get(key) === requestId) activeReads.delete(key);
    }
  }

  function* initializeExplorer(
    action: ReturnType<typeof initializeFileExplorer>,
    isCurrent: ReaderGuard,
    replacesPendingRead = false,
  ) {
    const [wsId, options] = action.payload;
    if (!wsId || !options.workspacePath) return;
    const existing = yield* selectFileExplorerState.effect(wsId);
    if (
      !replacesPendingRead &&
      existing.isLoading &&
      existing.workspacePath === options.workspacePath
    )
      return;
    if (
      existing.isInitialized &&
      existing.workspacePath === options.workspacePath &&
      existing.rootPath
    )
      return;
    yield* publish(setFileExplorerWorkspacePath(wsId, options.workspacePath), isCurrent);
    yield* publish(setFileExplorerLoading(wsId, true), isCurrent);
    let completed = false;
    try {
      const response = yield* call(() => {
        if (!isCurrent()) return Promise.resolve(null);
        return admission ? files.explorerTree(wsId, isCurrent) : files.explorerTree(wsId);
      });
      if (!isCurrent()) return;
      if (response) {
        const root: FileNode = {
          name: options.workspacePath.split('/').pop() || options.workspacePath,
          path: options.workspacePath,
          type: 'directory',
          children: (response.children ?? []).map((child) =>
            mapFileNode(child, `${options.workspacePath}/${child.name}`, true),
          ),
        };
        yield* publish(setRootNode(wsId, root), isCurrent);
        yield* publish(addExpandedPath(wsId, options.workspacePath), isCurrent);
      }
      completed = true;
    } catch (error) {
      onError?.(error);
      yield* publish(
        setFileExplorerError(wsId, error instanceof Error ? error.message : String(error)),
        isCurrent,
      );
      completed = true;
    } finally {
      if (completed && !(yield* cancelled())) {
        yield* publish(setFileExplorerLoading(wsId, false), isCurrent);
        yield* publish(setFileExplorerInitialized(wsId, true), isCurrent);
      }
    }
    if (onLoaded && isCurrent()) yield* call(onLoaded, wsId);
  }

  /** Restore only previously expanded, still-visible descendants after a shallow reload. */
  function* refreshExpandedDescendants(
    wsId: string,
    parentPath: string,
    expandedPaths: readonly string[],
    isCurrent: ReaderGuard,
  ): SagaGenerator<void> {
    const targets = [...new Set(expandedPaths)]
      .filter((path) => path.startsWith(`${parentPath}/`))
      .sort((left, right) => left.split('/').length - right.split('/').length);
    for (const path of targets) {
      if (!isCurrent()) return;
      const fresh = yield* selectFileExplorerState.effect(wsId);
      if (!fresh.rootPath || getItem(fresh.nodes, path)?.type !== 'directory') continue;
      let ancestor = path;
      let visible = true;
      while (ancestor.length >= fresh.rootPath.length) {
        if (
          !fresh.expandedPaths.includes(ancestor) ||
          (ancestor !== path && fresh.directoryErrors[ancestor]) ||
          (ancestor === fresh.rootPath && fresh.error)
        ) {
          visible = false;
          break;
        }
        if (ancestor === fresh.rootPath) break;
        ancestor = ancestor.slice(0, ancestor.lastIndexOf('/'));
      }
      if (visible) yield* call(loadDirectoryChildren, wsId, path, isCurrent);
    }
  }

  function* toggleDirectory(
    action: ReturnType<typeof toggleDirectoryRequested>,
    isCurrent: ReaderGuard,
  ) {
    const [wsId, nodePath] = action.payload;
    const ws = yield* selectFileExplorerState.effect(wsId);
    if (getItem(ws.nodes, nodePath)?.type !== 'directory') return;
    if (ws.expandedPaths.includes(nodePath)) {
      yield* publish(removeExpandedPath(wsId, nodePath), isCurrent);
      return;
    }
    yield* publish(addExpandedPath(wsId, nodePath), isCurrent);
    if (bounded) {
      yield* call(loadDirectoryChildren, wsId, nodePath, isCurrent);
      yield* call(refreshExpandedDescendants, wsId, nodePath, ws.expandedPaths, isCurrent);
      return;
    }
    const visited = new Set<string>([nodePath]);
    let current = nodePath;
    while (true) {
      const children = yield* call(loadDirectoryChildren, wsId, current, isCurrent);
      const next = onlyDirectoryChild(children);
      if (!compactChains || !isCurrent() || !next || visited.has(next.path)) return;
      current = next.path;
      visited.add(current);
      const fresh = yield* selectFileExplorerState.effect(wsId);
      if (!fresh.expandedPaths.includes(current))
        yield* publish(addExpandedPath(wsId, current), isCurrent);
    }
  }

  function* expandToPath(action: ReturnType<typeof expandToPathRequested>, isCurrent: ReaderGuard) {
    const [wsId, targetPath] = action.payload;
    const ws = yield* selectFileExplorerState.effect(wsId);
    if (!ws.workspacePath) return;
    const parts = stripWorkspacePrefix(targetPath, ws.workspacePath).split('/').filter(Boolean);
    let current = ws.workspacePath;
    yield* publish(setBulkOperation(wsId, true), isCurrent);
    let completed = false;
    try {
      for (let index = 0; index < parts.length; index += 1) {
        current = `${current}/${parts[index]}`;
        if (index === parts.length - 1 && !targetPath.endsWith('/')) continue;
        const fresh = yield* selectFileExplorerState.effect(wsId);
        if (!fresh.expandedPaths.includes(current))
          yield* publish(addExpandedPath(wsId, current), isCurrent);
        const node = getItem(fresh.nodes, current);
        if (!node || node.type !== 'directory' || node.children.length === 0) {
          yield* call(loadDirectoryChildren, wsId, current, isCurrent);
        }
      }
      completed = true;
    } finally {
      if (completed && !(yield* cancelled())) {
        yield* publish(setBulkOperation(wsId, false), isCurrent);
        yield* publish(incrementTreeVersion(wsId), isCurrent);
      }
    }
  }

  function* expandNode(
    wsId: string,
    path: string,
    depth: number,
    limit: number,
    isCurrent: ReaderGuard,
  ): SagaGenerator<void> {
    if (depth >= limit) return;
    const ws = yield* selectFileExplorerState.effect(wsId);
    const node = getItem(ws.nodes, path);
    if (!node || node.type !== 'directory') return;
    if (!ws.expandedPaths.includes(path)) yield* publish(addExpandedPath(wsId, path), isCurrent);
    let childPaths = node.children;
    if (childPaths.length === 0) {
      const children = yield* call(loadDirectoryChildren, wsId, path, isCurrent);
      childPaths = children
        .filter((child) => child.type === 'directory')
        .map((child) => child.path);
    }
    for (const childPath of childPaths)
      yield* call(expandNode, wsId, childPath, depth + 1, limit, isCurrent);
  }

  function* expandAll(action: ReturnType<typeof expandAllRequested>, isCurrent: ReaderGuard) {
    const [wsId, maxDepth] = action.payload;
    const ws = yield* selectFileExplorerState.effect(wsId);
    if (!ws.rootPath || !getItem(ws.nodes, ws.rootPath)) return;
    yield* publish(setBulkOperation(wsId, true), isCurrent);
    let completed = false;
    try {
      yield* call(expandNode, wsId, ws.rootPath, 0, maxDepth ?? 3, isCurrent);
      completed = true;
    } finally {
      if (completed && !(yield* cancelled())) {
        yield* publish(setBulkOperation(wsId, false), isCurrent);
        yield* publish(incrementTreeVersion(wsId), isCurrent);
      }
    }
  }

  function* refreshTree(wsId: string, isCurrent: ReaderGuard) {
    const ws = yield* selectFileExplorerState.effect(wsId);
    if (!ws.rootPath) {
      if (ws.workspacePath)
        yield* call(
          initializeExplorer,
          initializeFileExplorer(wsId, { workspacePath: ws.workspacePath }),
          isCurrent,
          // Refresh retires the original initializer; its loading flag is not an active read.
          true,
        );
      return;
    }
    yield* publish(setFileExplorerLoading(wsId, true), isCurrent);
    let completed = false;
    try {
      if (bounded) {
        yield* call(loadDirectoryChildren, wsId, ws.rootPath, isCurrent);
        yield* call(refreshExpandedDescendants, wsId, ws.rootPath, ws.expandedPaths, isCurrent);
      } else {
        const targets = [ws.rootPath, ...ws.expandedPaths.filter((path) => path !== ws.rootPath)];
        for (const path of new Set(targets)) {
          const fresh = yield* selectFileExplorerState.effect(wsId);
          const node = getItem(fresh.nodes, path);
          if (node?.type === 'directory') yield* call(loadDirectoryChildren, wsId, path, isCurrent);
        }
      }
      completed = true;
    } finally {
      if (completed && !(yield* cancelled()))
        yield* publish(setFileExplorerLoading(wsId, false), isCurrent);
    }
    if (onLoaded && isCurrent()) yield* call(onLoaded, wsId);
  }

  function* refreshDirectory(
    action: ReturnType<typeof refreshDirectoryRequested>,
    isCurrent: ReaderGuard,
  ) {
    const [wsId, filePath] = action.payload;
    const ws = yield* selectFileExplorerState.effect(wsId);
    const parent = computeParentDir(filePath, ws.workspacePath);
    if (!parent || getItem(ws.nodes, parent)?.type !== 'directory') return;
    yield* call(loadDirectoryChildren, wsId, parent, isCurrent);
    if (bounded) yield* call(refreshExpandedDescendants, wsId, parent, ws.expandedPaths, isCurrent);
  }

  function* initializeExplorerWorker(action: ReturnType<typeof initializeFileExplorer>) {
    yield* runGuarded(action, function* (isCurrent) {
      yield* call(initializeExplorer, action, isCurrent);
    });
  }

  function* toggleDirectoryWorker(action: ReturnType<typeof toggleDirectoryRequested>) {
    yield* runGuarded(action, function* (isCurrent) {
      yield* call(toggleDirectory, action, isCurrent);
    });
  }

  function* expandToPathWorker(action: ReturnType<typeof expandToPathRequested>) {
    yield* runGuarded(action, function* (isCurrent) {
      yield* call(expandToPath, action, isCurrent);
    });
  }

  function* expandAllWorker(action: ReturnType<typeof expandAllRequested>) {
    yield* runGuarded(action, function* (isCurrent) {
      yield* call(expandAll, action, isCurrent);
    });
  }

  function* refreshExplorerWorker(action: ReturnType<typeof refreshFileExplorer>) {
    yield* runGuarded(action, function* (isCurrent) {
      yield* call(refreshTree, action.payload[0], isCurrent);
    });
  }

  function* refreshDirectoryWorker(action: ReturnType<typeof refreshDirectoryRequested>) {
    yield* runGuarded(action, function* (isCurrent) {
      yield* call(refreshDirectory, action, isCurrent);
    });
  }

  return function* fileExplorerReadSaga() {
    yield* takeLeadingInContext(
      initializeFileExplorer,
      (action) => JSON.stringify([action.payload[0], action.payload[1].workspacePath]),
      initializeExplorerWorker,
    );
    if (bounded) {
      yield* takeLatestInContext(
        toggleDirectoryRequested,
        (action) => JSON.stringify(action.payload),
        toggleDirectoryWorker,
      );
    } else {
      yield* takeLeadingInContext(
        toggleDirectoryRequested,
        (action) => JSON.stringify(action.payload),
        toggleDirectoryWorker,
      );
    }
    if (!bounded) {
      yield* takeLatestInContext(
        expandToPathRequested,
        (action) => action.payload[0],
        expandToPathWorker,
      );
      yield* takeLatestInContext(
        expandAllRequested,
        (action) => action.payload[0],
        expandAllWorker,
      );
    }
    yield* takeSingleFlightInContext(
      refreshFileExplorer,
      (action) => action.payload[0],
      refreshExplorerWorker,
    );
    yield* takeSingleFlightInContext(
      refreshDirectoryRequested,
      (action) =>
        JSON.stringify([
          action.payload[0],
          action.payload[1].slice(0, action.payload[1].lastIndexOf('/')),
        ]),
      refreshDirectoryWorker,
    );
  };
}
