/**
 * Changes Saga
 *
 * Consolidated from file-tracking-saga + line-changes-saga.
 *
 * Handles:
 * - IPC event listeners (file-tracking:changes-updated, workspace-changes, etc.)
 * - Workspace initialization flow
 * - Periodic sync of agent stats with main process (safety net)
 */

import {
  all,
  call,
  put,
  takeLatest,
  delay,
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
import { TRACKING_CONFIG } from '$features/file-tracking/tracking.config';
import { takeEveryFromElectronChannel } from '$lib/store/utils/ipc-channel';
import {
  initWorkspace,
  setLoading,
  setError,
  setHasLoadedInitialData,
  updateAgentStatsBatch,
} from '../changes-slice';
import type { LineChangeStats } from '../changes-types';
import { selectActiveWorkspaceId } from '../../workspace/workspace-selectors';
import { selectAllWorkspaceAgents } from '../../workspace-agents/workspace-agents-selectors';
import { setGitStatus } from '../../git/git-slice';
import {
  doSyncWithGit,
  doLoadWorkspaceData,
  resetTrackingState,
  fileTrackingOperationsSaga,
} from './changes-operations-saga';
import { lineChangesClient } from '$features/line-changes/line-changes.client';
import { createLogger } from '$lib/utils/client-logger';

const logger = new Logger({ category: 'ChangesSaga' });
const agentStatsLogger = createLogger('ChangesSaga:AgentStats');

const IPC_INIT_TIMEOUT_MS = 10000;
const config = TRACKING_CONFIG.fileTracking;
const AGENT_STATS_SYNC_INTERVAL = 60000; // 60 seconds safety net

// ---------------------------------------------------------------------------
// IPC Listener Sagas
// ---------------------------------------------------------------------------

type FileTrackingEvent = {
  workspaceId: string;
  changeCount?: number;
  source?: string;
  filePath?: string;
};

function* watchChangesUpdated(wsId: string) {
  yield* takeEveryFromElectronChannel<FileTrackingEvent>(
    'file-tracking:changes-updated',
    function* (data) {
      if (data.workspaceId !== wsId) return;
      yield* delay(config.updateDebounce);
      yield* call(doLoadWorkspaceData, wsId);
    },
  );
}

function* watchAgentFileChanged(wsId: string) {
  yield* takeEveryFromElectronChannel<FileTrackingEvent>(
    'file-tracking:agent-file-changed',
    function* (data) {
      if (data.workspaceId !== wsId) return;
      yield* delay(50);
      yield* call(doSyncWithGit, wsId, true);
      yield* call(doLoadWorkspaceData, wsId);
    },
  );
}

export function* handleWorkspaceChangesEvent(
  wsId: string,
  data: { workspaceId?: string },
): SagaGenerator<void> {
  if (data.workspaceId !== wsId) return;
  yield* delay(config.updateDebounce);
  yield* call(doSyncWithGit, wsId, true);
  yield* call(doLoadWorkspaceData, wsId);
}

function* watchWorkspaceChanges(wsId: string) {
  yield* takeEveryFromElectronChannel<{ workspaceId?: string }>(
    'workspace-changes',
    function* (data) {
      yield* call(handleWorkspaceChangesEvent, wsId, data);
    },
  );
}

function* watchGitStatusAction(wsId: string): SagaGenerator<void> {
  yield* takeLatest(setGitStatus, function* (action) {
    const { wsId: actionWsId } = action.payload;
    if (actionWsId !== wsId) return;
    yield* delay(config.updateDebounce);
    yield* call(doLoadWorkspaceData, wsId);
  });
}

// ---------------------------------------------------------------------------
// Agent stats periodic sync (absorbed from line-changes-saga)
// ---------------------------------------------------------------------------

function* fetchAgentStatsWorker(
  agentId: string,
): SagaGenerator<{ id: string; stats: LineChangeStats } | null> {
  try {
    const stats = yield* call([lineChangesClient, lineChangesClient.getAgentStats], agentId as any);
    return stats ? { id: agentId, stats } : null;
  } catch {
    // Best effort: one agent's failure must not abort the batch
    return null;
  }
}

export function* syncAgentStatsFromMain() {
  try {
    const wsId = yield* selectActiveWorkspaceId.effect();
    if (!wsId) return;

    // Use canonical workspace agents list instead of only already-known stats keys
    const agents = yield* selectAllWorkspaceAgents.effect(wsId);
    if (agents.length === 0) return;

    const results = yield* all(agents.map((agent) => call(fetchAgentStatsWorker, agent.id)));

    const batch: Record<string, LineChangeStats> = {};
    for (const result of results) {
      if (result) {
        batch[result.id] = result.stats;
      }
    }

    if (Object.keys(batch).length > 0) {
      yield* put(updateAgentStatsBatch(batch));
    }
  } catch (error) {
    agentStatsLogger.error('Failed to sync agent stats from main process:', error as Error);
  }
}

function* periodicAgentStatsSyncSaga() {
  // Initial sync
  yield* call(syncAgentStatsFromMain);

  // Then periodic
  while (true) {
    yield* delay(AGENT_STATS_SYNC_INTERVAL);
    yield* call(syncAgentStatsFromMain);
  }
}

// ---------------------------------------------------------------------------
// Workspace initialization
// ---------------------------------------------------------------------------

function* handleInitWorkspace(action: ReturnType<typeof initWorkspace>): SagaGenerator<void> {
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

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* changesSaga(): SagaGenerator<void> {
  // Fork the operations saga to handle all operation request actions
  yield* fork(fileTrackingOperationsSaga);

  // Fork agent stats periodic sync
  yield* fork(periodicAgentStatsSyncSaga);

  // Watch for workspace init and set up listeners
  let listenerTask: Task | null = null;

  yield* takeLatest(initWorkspace, function* (action) {
    // Cancel previous listeners
    if (listenerTask) {
      yield* cancel(listenerTask);
    }

    // Run initialization
    yield* call(handleInitWorkspace, action);

    const wsId = action.payload[0];
    const currentWsId = yield* selectActiveWorkspaceId.effect();
    if (currentWsId !== wsId) return;

    // Fork IPC listeners for this workspace
    listenerTask = (yield* fork(function* () {
      yield* fork(watchChangesUpdated, wsId);
      yield* fork(watchAgentFileChanged, wsId);
      yield* fork(watchWorkspaceChanges, wsId);
      yield* fork(watchGitStatusAction, wsId);
    })) as unknown as Task;
  });
}
