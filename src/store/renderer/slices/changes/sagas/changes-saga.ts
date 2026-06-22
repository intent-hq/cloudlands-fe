/**
 * Changes Saga
 *
 * Consolidated from file-tracking-saga + line-changes-saga.
 *
 * Handles:
 * - IPC event listeners (file-tracking:changes-updated, workspace-changes, etc.)
 * - Workspace initialization flow
 * - Requested agent line-stat loads from the main process
 */

import {
  call,
  put,
  takeEvery,
  takeLatest,
  fork,
  cancel,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { Task } from 'redux-saga';
import {
  invokeWithTimeout,
  IpcTimeoutError,
} from '$lib/electron-bridge';
import { Logger } from '$lib/utils/logger';
import { takeEveryFromElectronChannel } from '$store/renderer/utils/ipc-channel';
import {
  initWorkspace,
  refreshRequested,
  setLoading,
  setError,
  setHasLoadedInitialData,
  requestAgentLineStats,
  updateAgentStats,
  agentLineStatsRequestStarted,
  agentLineStatsRequestSucceeded,
  agentLineStatsRequestFailed,
} from '../changes-slice';
import type { LineChangeStats } from '../changes-types';
import {
  selectChangesLastUpdatedAt,
  selectShouldRequestAgentLineStats,
} from '../changes-selectors';
import { openWorkspaceLocalChanges } from '../../workspace-navigation/workspace-navigation-slice';
import { selectActiveWorkspaceId } from '../../workspace/workspace-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { streamCompleted } from '../../chat-state/chat-state-slice';
import { selectAgentSessionWorkspaceId } from '../../agent-session/agent-session-selectors';
import {
  doSyncWithGit,
  doLoadWorkspaceData,
  resetTrackingState,
  fileTrackingOperationsSaga,
} from './changes-operations-saga';
import { lineChangesClient } from '$features/line-changes/line-changes.client';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentId } from '$shared/types/branded-ids';

const logger = new Logger({ category: 'ChangesSaga' });
const agentStatsLogger = createLogger('ChangesSaga:AgentStats');

const IPC_INIT_TIMEOUT_MS = 10000;
export const CHANGES_AUTO_REFRESH_FRESHNESS_MS = 60_000;

// ---------------------------------------------------------------------------
// IPC Listener Sagas
// ---------------------------------------------------------------------------

type FileTrackingEvent = {
  workspaceId: string;
  changeCount?: number;
  source?: string;
  filePath?: string;
};

const pendingTrackingReadyWorkspaceIds = new Set<string>();

export function resetChangesSagaPendingState(): void {
  pendingTrackingReadyWorkspaceIds.clear();
}

export function isChangesAutomaticRefreshStale(lastUpdatedAt: number, now: number): boolean {
  return lastUpdatedAt <= 0 || now - lastUpdatedAt > CHANGES_AUTO_REFRESH_FRESHNESS_MS;
}

function* requestAutomaticChangesRefreshIfStale(wsId: string): SagaGenerator<void> {
  const lastUpdatedAt = yield* selectChangesLastUpdatedAt.effect(wsId);
  if (!isChangesAutomaticRefreshStale(lastUpdatedAt, Date.now())) return;
  yield* put(refreshRequested(wsId));
}

function getCurrentIsoTimestamp(): string {
  return new Date().toISOString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function* handleChangesUpdatedEvent(
  wsId: string,
  data: FileTrackingEvent,
): SagaGenerator<void> {
  if (data.workspaceId !== wsId) return;
  yield* put(refreshRequested(wsId));
}

function* watchChangesUpdated(wsId: string): SagaGenerator<void> {
  yield* takeEveryFromElectronChannel<FileTrackingEvent>(
    'file-tracking:changes-updated',
    function* (data) {
      yield* call(handleChangesUpdatedEvent, wsId, data);
    },
  );
}

export function* handleTrackingReadyEvent(data: { workspaceId?: string }): SagaGenerator<void> {
  const wsId = data.workspaceId;
  if (!wsId) return;
  logger.debug('Ignoring listener-ready as an automatic changes refresh trigger', { wsId });
}

export function* replayPendingTrackingReadyForWorkspace(wsId: string): SagaGenerator<void> {
  if (!pendingTrackingReadyWorkspaceIds.has(wsId)) return;
  pendingTrackingReadyWorkspaceIds.delete(wsId);
}

export function* watchGlobalTrackingReady() {
  yield* takeEveryFromElectronChannel<{ workspaceId?: string }>(
    'file-tracking:listener-ready',
    function* (data) {
      yield* call(handleTrackingReadyEvent, data);
    },
  );
}

export function* handleWorkspaceUnmountedForChanges(
  action: ReturnType<typeof workspaceUnmounted>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  pendingTrackingReadyWorkspaceIds.delete(wsId);
}

export function* watchWorkspaceUnmountedForChanges(): SagaGenerator<void> {
  yield* takeEvery(workspaceUnmounted, handleWorkspaceUnmountedForChanges);
}

export function* handleAgentFileChangedEvent(
  wsId: string,
  data: FileTrackingEvent,
): SagaGenerator<void> {
  if (data.workspaceId !== wsId) return;
  yield* put(refreshRequested(wsId));
}

function* watchAgentFileChanged(wsId: string): SagaGenerator<void> {
  yield* takeEveryFromElectronChannel<FileTrackingEvent>(
    'file-tracking:agent-file-changed',
    function* (data) {
      yield* call(handleAgentFileChangedEvent, wsId, data);
    },
  );
}

export function* handleWorkspaceChangesEvent(
  wsId: string,
  data: { workspaceId?: string },
): SagaGenerator<void> {
  if (data.workspaceId !== wsId) return;
  yield* put(refreshRequested(wsId));
}

function* watchWorkspaceChanges(wsId: string) {
  yield* takeEveryFromElectronChannel<{ workspaceId?: string }>(
    'workspace-changes',
    function* (data) {
      yield* call(handleWorkspaceChangesEvent, wsId, data);
    },
  );
}

export function* handleOpenWorkspaceLocalChanges(
  action: ReturnType<typeof openWorkspaceLocalChanges>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  if (!wsId) return;
  const currentWsId = yield* selectActiveWorkspaceId.effect();
  if (currentWsId !== wsId) return;
  yield* requestAutomaticChangesRefreshIfStale(wsId);
}

function* watchOpenWorkspaceLocalChanges(): SagaGenerator<void> {
  yield* takeLatest(openWorkspaceLocalChanges, handleOpenWorkspaceLocalChanges);
}

export function* handleAgentStreamCompletedForChanges(
  action: ReturnType<typeof streamCompleted>,
): SagaGenerator<void> {
  const [agentId] = action.payload;
  const wsId = yield* selectAgentSessionWorkspaceId.effect(agentId);
  if (!wsId) return;
  const currentWsId = yield* selectActiveWorkspaceId.effect();
  if (currentWsId !== wsId) return;
  yield* requestAutomaticChangesRefreshIfStale(wsId);
}

function* watchAgentStreamCompletedForChanges(): SagaGenerator<void> {
  yield* takeEvery(streamCompleted, handleAgentStreamCompletedForChanges);
}

export function* watchWorkspaceIpcListeners(wsId: string): SagaGenerator<void> {
  yield* fork(watchChangesUpdated, wsId);
  yield* fork(watchAgentFileChanged, wsId);
  yield* fork(watchWorkspaceChanges, wsId);
}

// ---------------------------------------------------------------------------
// Requested agent line stats (absorbed from line-changes-saga)
// ---------------------------------------------------------------------------

export function* handleRequestAgentLineStats(
  action: ReturnType<typeof requestAgentLineStats>,
): SagaGenerator<void> {
  const { agentId, forceRefresh } = action.payload;

  const shouldRequest = yield* selectShouldRequestAgentLineStats.effect(agentId, forceRefresh);
  if (!shouldRequest) return;

  yield* put(agentLineStatsRequestStarted(agentId, getCurrentIsoTimestamp()));
  try {
    const stats: LineChangeStats | null = yield* call(
      [lineChangesClient, lineChangesClient.getAgentStats],
      agentId as AgentId,
    );
    if (stats) {
      yield* put(updateAgentStats(agentId, stats));
    }
    yield* put(agentLineStatsRequestSucceeded(agentId, getCurrentIsoTimestamp()));
  } catch (error) {
    agentStatsLogger.warn('Failed to load requested agent line stats', { agentId, error });
    yield* put(agentLineStatsRequestFailed(agentId, getErrorMessage(error), getCurrentIsoTimestamp()));
  }
}

export function* watchRequestedAgentLineStats(): SagaGenerator<void> {
  yield* takeEvery(requestAgentLineStats, handleRequestAgentLineStats);
}

// ---------------------------------------------------------------------------
// Workspace initialization
// ---------------------------------------------------------------------------

export function* handleInitWorkspace(action: ReturnType<typeof initWorkspace>): SagaGenerator<void> {
  const wsId = action.payload[0];
  logger.info('[ChangesSaga] initWorkspace', { wsId });

  yield* put(setLoading(wsId, true));
  yield* put(setError(wsId, null));

  // Reset module-level tracking state
  yield* call(resetTrackingState);

  try {
    // Initialize file tracking backend
    try {
      const result = (yield* call(
        invokeWithTimeout,
        'file-tracking:init',
        { workspaceId: wsId },
        IPC_INIT_TIMEOUT_MS,
      )) as { success?: boolean; error?: string } | null;
      if (result && !result.success) {
        logger.warn('File tracking backend init failed', { wsId, error: result.error });
      }
    } catch (error) {
      if (error instanceof IpcTimeoutError) {
        logger.warn('File tracking init timed out, continuing...', { wsId });
      } else {
        logger.error('Failed to init file tracking backend', error as Error, { wsId });
      }
    }

    // Check workspace hasn't changed
    const currentWsId = yield* selectActiveWorkspaceId.effect();
    if (currentWsId !== wsId) return;

    yield* call(doSyncWithGit, wsId, false);
    const currentWsId2 = yield* selectActiveWorkspaceId.effect();
    if (currentWsId2 !== wsId) return;

    yield* call(doLoadWorkspaceData, wsId);
    const currentWsId3 = yield* selectActiveWorkspaceId.effect();
    if (currentWsId3 !== wsId) return;

    yield* put(setHasLoadedInitialData(wsId, true));
    yield* put(setLoading(wsId, false));
  } catch (error) {
    logger.error('[ChangesSaga] Unexpected init error', error as Error, { wsId });
    const currentWsId = yield* selectActiveWorkspaceId.effect();
    if (currentWsId === wsId) {
      yield* put(setHasLoadedInitialData(wsId, true));
      yield* put(setLoading(wsId, false));
      yield* put(setError(wsId, error instanceof Error ? error.message : 'Failed to initialize'));
    }
  }
}

export function* handleInitWorkspaceWithListeners(
  action: ReturnType<typeof initWorkspace>,
): SagaGenerator<void> {
  const wsId = action.payload[0];
  const listenerTask = (yield* fork(watchWorkspaceIpcListeners, wsId)) as unknown as Task;

  yield* call(handleInitWorkspace, action);
  yield* call(replayPendingTrackingReadyForWorkspace, wsId);

  const currentWsId = yield* selectActiveWorkspaceId.effect();
  if (currentWsId !== wsId) {
    yield* cancel(listenerTask);
  }
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* changesSaga(): SagaGenerator<void> {
  // Fork the operations saga to handle all operation request actions
  yield* fork(fileTrackingOperationsSaga);

  // Watch explicit requested agent line-stat loads
  yield* fork(watchRequestedAgentLineStats);

  // Watch tab-open intent actions and route refresh through changes operations
  yield* fork(watchOpenWorkspaceLocalChanges);

  // Watch existing agent done Redux signal; agent:idle is normalized to streamCompleted upstream.
  yield* fork(watchAgentStreamCompletedForChanges);

  // Watch global listener-ready events before workspace-scoped init listeners exist
  yield* fork(watchGlobalTrackingReady);

  // Drop stale deferred listener-ready workspace IDs when a workspace unmounts.
  yield* fork(watchWorkspaceUnmountedForChanges);

  // Watch for workspace init and set up listeners before initial sync/load
  yield* takeLatest(initWorkspace, handleInitWorkspaceWithListeners);
}
