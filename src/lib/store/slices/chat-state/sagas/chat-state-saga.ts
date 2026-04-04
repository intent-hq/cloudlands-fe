/**
 * Chat State Saga
 *
 * Handles side effects for the chat-state slice:
 * - Stall detection (periodic interval while streaming)
 * - State reconciliation (detect stuck processing state)
 * - localStorage persistence for status events
 *
 * NOTE: Stream DOM event handling remains in ChatService for now,
 * as it is deeply coupled with the streaming protocol. The saga
 * handles only periodic timers and persistence.
 */

import type { Task } from 'redux-saga';
import { call, cancel, delay, fork, put, select, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { selectAgentMessages, selectAgentSession } from '../../agent-session/agent-session-selectors';
import { initializeChatSaga } from './initialize-chat-saga';
import { watchSendMessage } from './send-message-saga';
import { chatLifecycleSaga } from './chat-lifecycle-saga';
import {
  setLocalStorageJSON,
  removeLocalStorageItem,
} from '../../../utils/safe-local-storage-saga';
import { createLogger } from '$lib/utils/client-logger';
import {
  STALL_DETECTION_MS,
  STATE_RECONCILIATION_INTERVAL_MS,
  STATE_RECONCILIATION_FAILURE_THRESHOLD,
  STUCK_PROCESSING_TIMEOUT_MS,
  STATUS_EVENTS_STORAGE_KEY,
} from '../chat-state-types';
import type { StatusEvent } from '../chat-state-types';
import {
  chatSendStarted,
  chatStallDetected,
  chatStuckStateCleared,
  streamCompleted,
  streamErrored,
  chatStopCompleted,
  chatReset,
  chatInterrupted,
  streamStatusReceived,
  addSendKey,
  removeSendKey,
  clearSendKeys,
} from '../chat-state-slice';
import { SEND_KEY_TTL_MS } from '../chat-state-types';
import {
  selectChatIsProcessing,
  selectChatAgentState,
  selectChatLastChunkReceivedAt,
} from '../chat-state-selectors';
import { selectAgentById, selectAllWorkspaceAgents } from '../../workspace-agents/workspace-agents-selectors';
import { removeAgent } from '../../workspace-agents/workspace-agents-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';

const logger = createLogger('ChatStateSaga');

// ============================================================================
// Stall Detection Saga
// ============================================================================

/**
 * Monitors streaming state and detects stalls.
 * Runs while streaming is active, checks every 10 seconds.
 *
 * Includes MCP tool-use guard: if the last content block is a tool_use,
 * the tool hasn't returned yet and we should not flag as stalled.
 */
function* stallDetectionLoop(agentId: string): SagaGenerator<void> {
  while (true) {
    yield* delay(10_000);

    const agentState = yield* select(
      (state) => selectChatAgentState.select(state, agentId),
    );

    // Only check if we're actively streaming (from agent-session, single source of truth)
    const sessionForStall = yield* select(
      (state) => selectAgentSession.select(state, agentId),
    );
    if (!sessionForStall?.isStreaming) return;

    // Don't flag as stalled while an MCP tool is actively executing.
    // If the last content block is a tool_use, the tool hasn't returned yet.
    const agentMessages = yield* select(
      (state) => selectAgentMessages.select(state, agentId),
    );
    const lastMsg = agentMessages[agentMessages.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg?.contentBlocks?.length) {
      const lastBlock = lastMsg.contentBlocks[lastMsg.contentBlocks.length - 1];
      if (lastBlock.type === 'tool_use') {
        continue; // Tool is executing — not stalled
      }
    }

    // Determine how long we've been silent.
    // If we've received chunks, measure from last chunk. Otherwise from stream start.
    const referenceTime = agentState.lastChunkTime ?? agentState.streamingStartTime;
    if (!referenceTime) {
      continue;
    }

    const silenceMs = Date.now() - referenceTime;

    if (silenceMs >= STALL_DETECTION_MS && !agentState.isStalled) {
      logger.warn('[ChatStateSaga] Stall detected', {
        agentId,
        silenceMs,
        threshold: STALL_DETECTION_MS,
        hasReceivedData: agentState.lastChunkTime !== null,
        lastChunkTime: agentState.lastChunkTime,
      });
      yield* put(chatStallDetected(agentId));
    }
  }
}

// ============================================================================
// State Reconciliation Saga
// ============================================================================

/**
 * Helper to query backend for active streams via IPC.
 * Returns null if IPC is unavailable.
 */
async function getActiveStreams(): Promise<{ agentId: string }[] | null> {
  try {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const result = await window.electronAPI.invoke('agent:get-active-streams');
      return result?.data || [];
    }
  } catch {
    // IPC error — return null to signal failure
  }
  return null;
}

/**
 * Periodically checks if processing state is stuck (no active stream on backend).
 * After consecutive failures exceeding the threshold, clears the stuck state.
 *
 * Enhanced with:
 * - Backend IPC query to check if stream is actually active
 * - lastChunkReceivedAt guard to avoid false positives from transient IPC timing
 * - Safety timeout for permanently stuck states (>5 min)
 * - Session-aware checks using current session from Redux state
 */
function* stateReconciliationLoop(agentId: string): SagaGenerator<void> {
  let failureCount = 0;

  while (true) {
    yield* delay(STATE_RECONCILIATION_INTERVAL_MS);

    const agentState = yield* select(
      (state) => selectChatAgentState.select(state, agentId),
    );

    // If no longer processing (from agent-session), terminate — a new chatSendStarted will fork a fresh loop
    const sessionForReconcile = yield* select(
      (state) => selectAgentSession.select(state, agentId),
    );
    if (!sessionForReconcile?.isProcessing) {
      return;
    }

    // Get current session dynamically from agent-session slice
    const currentSession = yield* select(
      (state) => selectAgentSession.select(state, agentId),
    );
    const currentSessionId = currentSession?.id;
    if (!currentSessionId) {
      failureCount = 0;
      continue;
    }

    // Safety timeout: if isProcessing has been true for > 5 minutes without any chunks
    // AND the session is not streaming according to Redux state, auto-clear the stuck state.
    if (agentState.streamingStartTime) {
      const processingDuration = Date.now() - agentState.streamingStartTime;
      const hasRecentChunks = agentState.lastChunkTime
        && (Date.now() - agentState.lastChunkTime) < STUCK_PROCESSING_TIMEOUT_MS;
      const reconcileWorkspaceId = agentState.trackedWorkspaceId ?? currentSession?.workspaceId;
      const sessionData: any = reconcileWorkspaceId
        ? yield* select((state) => selectAgentById.select(state, agentId))
        : undefined;
      const sessionSaysStreaming = sessionData?.isStreaming ?? false;

      if (
        processingDuration >= STUCK_PROCESSING_TIMEOUT_MS
        && !hasRecentChunks
        && !sessionSaysStreaming
      ) {
        logger.warn('[ChatStateSaga] Permanently stuck isProcessing detected (>5 min, no chunks, session not streaming)', {
          agentId,
          sessionId: currentSessionId,
          processingDurationMs: processingDuration,
          lastChunkTime: agentState.lastChunkTime,
          streamingStartTime: agentState.streamingStartTime,
        });
        yield* put(chatStuckStateCleared(agentId));
        failureCount = 0;
        return; // Stop reconciliation since we've recovered
      }
    }

    // Query the backend to check if there's actually an active stream
    const activeStreams: { agentId: string }[] | null = yield* call(getActiveStreams);

    if (activeStreams === null) {
      // On IPC error, be conservative - reset failure count to avoid false positives
      failureCount = 0;
      logger.debug('[ChatStateSaga] State reconciliation check failed (IPC error), resetting failure count');
      continue;
    }

    // Re-check isProcessing since state may have changed during IPC call
    const stateAfterCheck = yield* select(
      (state) => selectChatIsProcessing.select(state, agentId),
    );
    if (!stateAfterCheck) {
      failureCount = 0;
      continue;
    }

    const hasActiveStream = activeStreams.some(
      (stream) => stream.agentId === agentId,
    );

    if (hasActiveStream) {
      // Backend confirms stream is active, reset failure count
      failureCount = 0;
      logger.debug('[ChatStateSaga] Backend confirms active stream', {
        sessionId: currentSessionId,
        activeStreams: activeStreams.length,
      });
    } else {
      // If chunks were received recently (< 30s), the stream is alive
      // even if getActiveStreams doesn't list it (transient IPC timing).
      const lastChunkReceivedAt: number = yield* select(
        (state) => selectChatLastChunkReceivedAt.select(state, agentId),
      );
      const timeSinceLastChunk = lastChunkReceivedAt ? Date.now() - lastChunkReceivedAt : Infinity;
      if (timeSinceLastChunk < 30_000) {
        logger.debug('[ChatStateSaga] Skipping failure count - chunks received recently', {
          sessionId: currentSessionId,
          timeSinceLastChunkMs: timeSinceLastChunk,
        });
        failureCount = 0;
      } else {
        // UI thinks we're processing, but backend has no active stream
        failureCount++;

        logger.warn('[ChatStateSaga] Potential stuck state detected', {
          sessionId: currentSessionId,
          failureCount,
          threshold: STATE_RECONCILIATION_FAILURE_THRESHOLD,
          timeSinceLastChunkMs: timeSinceLastChunk,
        });

        // Only reset after consecutive failures to avoid false positives
        if (failureCount >= STATE_RECONCILIATION_FAILURE_THRESHOLD) {
          logger.warn('[ChatStateSaga] Resetting stuck state after threshold', {
            sessionId: currentSessionId,
            failureCount,
          });
          yield* put(chatStuckStateCleared(agentId));
          failureCount = 0;
          return; // Stop reconciliation since we've recovered
        }
      }
    }
  }
}

// ============================================================================
// localStorage Persistence for Status Events
// ============================================================================

function makeStorageKey(agentId: string): string {
  return `${STATUS_EVENTS_STORAGE_KEY}:${agentId}`;
}

function* persistStatusEvents(agentId: string): SagaGenerator<void> {
  // Read current status events from state (flat: byAgentId)
  const statusEvents: StatusEvent[] = yield* select(
    (state) => state.chatState?.byAgentId[agentId]?.statusEvents ?? [],
  );
  yield* call(setLocalStorageJSON, makeStorageKey(agentId), statusEvents);
}

function* clearStatusEventsStorage(agentId: string): SagaGenerator<void> {
  yield* call(removeLocalStorageItem, makeStorageKey(agentId));
}

// ============================================================================
// Watchers
// ============================================================================

/**
 * Per-agentId task dedup map. Before forking new stall/reconciliation tasks,
 * cancel any existing ones for the same agentId to prevent accumulation.
 */
const activeSendTasks = new Map<string, Task[]>();

/** When a send starts, fork stall detection and state reconciliation for that agent */
function* watchSendStarted(): SagaGenerator<void> {
  yield* takeEvery(chatSendStarted, function* (action) {
    const { agentId } = action.payload;

    // Cancel any existing tasks for this agentId to prevent accumulation
    const existing = activeSendTasks.get(agentId);
    if (existing) {
      for (const task of existing) {
        yield* cancel(task);
      }
    }

    // Fork background tasks — they self-terminate when streaming ends
    const tasks = [
      yield* fork(stallDetectionLoop, agentId),
      yield* fork(stateReconciliationLoop, agentId),
    ];
    activeSendTasks.set(agentId, tasks);
  });
}

/** Persist status events to localStorage when they change */
function* watchStatusEvents(): SagaGenerator<void> {
  yield* takeEvery(streamStatusReceived, function* (action) {
    const [agentId] = action.payload;
    yield* call(persistStatusEvents, agentId);
  });
}

/** Clear status events storage on stream completion, error, or reset */
function* watchClearStorage(): SagaGenerator<void> {
  yield* takeEvery(
    [streamCompleted, streamErrored, chatReset, chatStopCompleted],
    function* (action) {
      const [agentId] = action.payload;
      yield* call(clearStatusEventsStorage, agentId);
    },
  );
}

// ============================================================================
// Send Key Expiry Saga
// ============================================================================

/**
 * When a send key is added, fork a timer that removes it after TTL.
 * On stream completion/error/reset, all send keys are cleared in the reducer,
 * and any outstanding expiry forks are effectively no-ops (removeSendKey on
 * a key that doesn't exist returns same state reference).
 */
function* watchSendKeyExpiry(): SagaGenerator<void> {
  yield* takeEvery(addSendKey, function* (action) {
    const [agentId, key] = action.payload;
    yield* delay(SEND_KEY_TTL_MS);
    yield* put(removeSendKey(agentId, key));
  });
}

/** Clear send keys on stream completion, error, stop, reset, or interruption */
function* watchClearSendKeys(): SagaGenerator<void> {
  yield* takeEvery(
    [streamCompleted, streamErrored, chatStopCompleted, chatReset, chatInterrupted],
    function* (action) {
      const [agentId] = action.payload;
      yield* put(clearSendKeys(agentId));
    },
  );
}

// ============================================================================
// Agent / Workspace Cleanup
// ============================================================================

/** Cancel and remove tracked tasks when an agent is deleted */
function* watchAgentRemoved(): SagaGenerator<void> {
  yield* takeEvery(removeAgent, function* (action) {
    const [, agentId] = action.payload;
    const existing = activeSendTasks.get(agentId);
    if (existing) {
      for (const task of existing) {
        yield* cancel(task);
      }
      activeSendTasks.delete(agentId);
    }
  });
}

/** Cancel and remove tracked tasks for all agents in a workspace when it unmounts */
function* watchWorkspaceUnmountedForCleanup(): SagaGenerator<void> {
  yield* takeEvery(workspaceUnmounted, function* (action) {
    const [wsId] = action.payload;
    // Look up which agents belong to this workspace so we can clean their entries
    const agents = yield* select(
      (state) => selectAllWorkspaceAgents.select(state, wsId),
    );
    for (const agent of agents) {
      const existing = activeSendTasks.get(agent.id);
      if (existing) {
        for (const task of existing) {
          yield* cancel(task);
        }
        activeSendTasks.delete(agent.id);
      }
    }
  });
}

// ============================================================================
// Root Saga
// ============================================================================

export function* chatStateSaga(): SagaGenerator<void> {
  // Reset dedup map when root saga restarts
  activeSendTasks.clear();
  yield* fork(watchSendStarted);
  yield* fork(watchStatusEvents);
  yield* fork(watchClearStorage);
  yield* fork(watchSendMessage);
  yield* fork(initializeChatSaga);
  yield* fork(watchSendKeyExpiry);
  yield* fork(watchClearSendKeys);
  yield* fork(chatLifecycleSaga);
  yield* fork(watchAgentRemoved);
  yield* fork(watchWorkspaceUnmountedForCleanup);
}

