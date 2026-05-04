/**
 * Agent Lock Saga
 *
 * Watches for relevant state changes and recomputes which agents and files
 * are locked due to auto-commit being enabled and agents actively working.
 *
 * A file is locked when:
 * 1. Auto-commit is enabled AND
 * 2. The file belongs to an agent that is actively working
 *    (streaming or task not in terminal status)
 */

import { fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { Logger } from '$lib/utils/logger';
import {
  selectStagedWorkingChanges,
  selectUnstagedWorkingChanges,
} from '../../changes/changes-selectors';
import { setChangesData, setChanges } from '../../changes/changes-slice';
import {
  setAutoCommitEnabled,
  loadAutoCommitSettings,
} from '../../workspace-settings/workspace-settings-slice';
import { selectAutoCommitEnabled } from '../../workspace-settings/workspace-settings-selectors';
import { applyTaskStatusChanged } from '../../workspace-notes/workspace-notes-slice';
import { selectNoteById } from '../../workspace-notes/workspace-notes-selectors';
import { recomputeAgentLocks, setAgentLockState } from '../agent-lock-slice';
import { selectAgentById } from '../../workspace-agents/workspace-agents-selectors';
import type { TrackedChange } from '../../changes/changes-types';

const agentLockLogger = new Logger({ category: 'AgentLockSaga' });

// ============================================================================
// Agent activity check — accesses Redux state through selector effects
// ============================================================================

/**
 * Check if an agent is actively working (streaming or task not complete).
 * Uses Redux state exclusively (appropriate for sagas).
 */
function* isAgentActivelyWorking(
  agentId: string,
): SagaGenerator<boolean> {
  try {
    // Check streaming state from Redux
    const session = yield* selectAgentById.effect(agentId);
    if (!session) return false;

    if (session.isStreaming) {
      return true;
    }

    // Check linked task status via Redux state
    const taskNoteId = session.metadata?.taskNoteId as string | undefined;
    if (taskNoteId) {
      const sessionWsId = session.workspaceId;
      if (sessionWsId) {
        const taskNote = yield* selectNoteById.effect(sessionWsId, taskNoteId);
        const taskStatus = taskNote?.metadata?.task?.status;
        if (taskStatus && taskStatus !== 'complete' && taskStatus !== 'cancelled') {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    agentLockLogger.warn('Failed to check agent activity', { agentId, error });
    return false;
  }
}

// ============================================================================
// Recomputation handler
// ============================================================================

function* handleRecomputeAgentLocks(
  action: ReturnType<typeof recomputeAgentLocks>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;

  // Check autoCommitEnabled from workspace settings
  const autoCommitEnabled = yield* selectAutoCommitEnabled.effect(workspaceId);

  // If auto-commit is disabled, clear locks
  if (!autoCommitEnabled) {
    yield* put(setAgentLockState(workspaceId, {}, {}));
    return;
  }

  // Get working changes from file-tracking
  const unstaged = yield* selectUnstagedWorkingChanges.effect(workspaceId);
  const staged = yield* selectStagedWorkingChanges.effect(workspaceId);

  // Collect unique agent IDs from both unstaged and staged changes
  const agentIds = new Set<string>();
  for (const change of unstaged) {
    const agentId = change.attribution?.agent?.agentId;
    if (agentId) agentIds.add(agentId);
  }
  for (const change of staged) {
    const agentId = change.attribution?.agent?.agentId;
    if (agentId) agentIds.add(agentId);
  }

  // Check each agent through selector effects
  const lockedAgentIds: Record<string, true> = {};
  for (const agentId of agentIds) {
    if (yield* isAgentActivelyWorking(agentId)) {
      lockedAgentIds[agentId] = true;
    }
  }

  // Compute locked file paths from locked agents
  const lockedFilePaths: Record<string, true> = {};
  const addLockedPaths = (changes: TrackedChange[]) => {
    for (const change of changes) {
      const agentId = change.attribution?.agent?.agentId;
      if (agentId && agentId in lockedAgentIds) {
        lockedFilePaths[change.relativePath] = true;
        if (change.file && change.file !== change.relativePath) {
          lockedFilePaths[change.file] = true;
        }
      }
    }
  };
  addLockedPaths(unstaged);
  addLockedPaths(staged);

  yield* put(setAgentLockState(workspaceId, lockedAgentIds, lockedFilePaths));
}

// ============================================================================
// Watchers — trigger recomputation on relevant state changes
// ============================================================================

/** Watch for explicit recompute requests */
function* watchRecomputeRequests(): SagaGenerator<void> {
  yield* takeEvery(recomputeAgentLocks, handleRecomputeAgentLocks);
}

/** Watch for file-tracking changes (new/modified files) */
function* watchFileTrackingChanges(): SagaGenerator<void> {
  yield* takeEvery([setChangesData, setChanges], function* (action: any) {
    // Extract workspaceId from the action payload
    const wsId = action.payload?.wsId ?? action.payload?.[0];
    if (wsId) {
      yield* put(recomputeAgentLocks(wsId));
    }
  });
}

/** Watch for workspace settings changes (autoCommit toggle) */
function* watchAutoCommitChanges(): SagaGenerator<void> {
  yield* takeEvery([setAutoCommitEnabled, loadAutoCommitSettings], function* (action: any) {
    const wsId = action.payload?.[0];
    if (wsId) {
      yield* put(recomputeAgentLocks(wsId));
    }
  });
}

/** Watch for task status changes (agent task completed/cancelled) */
function* watchTaskStatusChanges(): SagaGenerator<void> {
  yield* takeEvery(applyTaskStatusChanged, function* (action: any) {
    const wsId = action.payload?.[0];
    if (wsId) {
      yield* put(recomputeAgentLocks(wsId));
    }
  });
}

// ============================================================================
// Root saga
// ============================================================================

export function* agentLockSaga(): SagaGenerator<void> {
  yield* fork(watchRecomputeRequests);
  yield* fork(watchFileTrackingChanges);
  yield* fork(watchAutoCommitChanges);
  yield* fork(watchTaskStatusChanges);
}
