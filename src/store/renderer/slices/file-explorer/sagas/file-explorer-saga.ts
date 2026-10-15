import { call, cancelled, fork, put, race, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createBackendFileNameSearch } from '$lib/client/live/backend-file-name-search';
import { createLogger } from '$lib/utils/client-logger';
import { getAgentFileEdits, propagateAgentEditsToParents } from '$lib/utils/agent-file-edits';
import type { FileGitStatus, FileNode } from '$shared/types';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  takeLatestByContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { mapFileNode } from '../file-explorer-utils';
import { createFileExplorerReadSaga } from './file-explorer-read-saga-factory';
import { createFileSearchSaga } from './file-search-saga-factory';
import { selectFileExplorerState } from '../file-explorer-selectors';
import {
  addExpandedPath,
  hydrateFileExplorerRequested,
  removeAgentFileEditsEntries,
  setFileExplorerFileCount,
  setFileExplorerError,
  setFileExplorerInitialized,
  setFileExplorerLoading,
  setFileExplorerWorkspacePath,
  setGitStatusMap,
  setRootNode,
  syncGitStatusFromStoresRequested,
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

function* hydrateExplorerWorker(action: ReturnType<typeof hydrateFileExplorerRequested>) {
  const [wsId, force] = action.payload;
  if (!wsId) return;
  yield* race({
    hydrate: call(hydrateExplorer, wsId, force),
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

const searchFiles = createFileSearchSaga({
  read: createBackendFileNameSearch(backendRequest),
  onError: (error) => logger.error('Search failed', error),
});

const readFileExplorer = createFileExplorerReadSaga({
  files: appClient.files,
  selectFileExplorerState,
  onLoaded: loadAgentFileEdits,
  onError: (error) => logger.error('File explorer read failed', error),
});

export function* fileExplorerSaga() {
  yield* fork(searchFiles);
  yield* fork(readFileExplorer);
  yield* takeLatestByContext(
    hydrateFileExplorerRequested,
    (action) => ({
      context: action.payload[0],
      force: action.payload[1],
      generation: action.payload[2] ?? 0,
    }),
    hydrateExplorerWorker,
  );
  yield* takeSingleFlightInContext(
    syncGitStatusFromStoresRequested,
    (action) => action.payload[0],
    refreshAgentEditsWorker,
  );
}
