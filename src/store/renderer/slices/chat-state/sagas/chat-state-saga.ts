/**
 * Chat State Saga
 *
 * Handles side effects for the chat-state slice:
 * - Stall detection (periodic interval while streaming)
 * - State reconciliation (detect stuck processing state)
 * - localStorage persistence for status events
 *
 * Stream lifecycle event handling now lives in chat stream / agent-session sagas.
 * This saga handles periodic timers and persistence.
 */

import type { Task } from 'redux-saga';
import {
  call,
  cancel,
  delay,
  fork,
  put,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import {
  selectAgentSessionIsProcessing,
  selectAgentIsResponding,
  selectAgentMessages,
} from '../../agent-session/agent-session-selectors';
import { initializeChatSaga } from './initialize-chat-saga';
import { watchSendMessage } from './send-message-saga';
import { chatLifecycleSaga } from './chat-lifecycle-saga';
import {
  getLocalStorageJSON,
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
  chatStopCompleted,
  chatReset,
  chatInterrupted,
  streamStatusReceived,
  initializeChatRequested,
  chatStatusEventsHydrated,
} from '../chat-state-slice';
import {
  selectChatAgentState,
  selectChatLastChunkReceivedAt,
  selectChatStatusEvents,
} from '../chat-state-selectors';
import { selectAllWorkspaceAgents } from '../../workspace-agents/workspace-agents-selectors';
import {
  agentStreamUpdateReceived,
  removeAgent,
  removeWorkspaceAgentState,
} from '../../workspace-agents/workspace-agents-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { sanitizeStatusEvents } from '../chat-state-serialization';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { AgentActivationState } from '$shared/types/agent-session';

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

    const agentState = yield* selectChatAgentState.effect(agentId);

    // Only check if we're actively streaming (from agent-session, single source of truth)
    const sessionForStall = yield* selectAgentSession.effect(agentId);
    if (!sessionForStall?.isStreaming) return;

    // Don't flag as stalled while an MCP tool is actively executing.
    // If the last content block is a tool_use, the tool hasn't returned yet.
    const agentMessages = yield* selectAgentMessages.effect(agentId);
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

    const agentState = yield* selectChatAgentState.effect(agentId);

    // If no longer processing (from agent-session), terminate — a new chatSendStarted will fork a fresh loop
    const sessionForReconcile = yield* selectAgentSession.effect(agentId);
    if (!sessionForReconcile?.isProcessing) {
      return;
    }

    // Activation guard: while the agent is still activating (pre-stream phase),
    // the backend has no active stream yet — that's expected, not a stuck state.
    // Skip both the safety-timeout and the threshold branches, and reset
    // failureCount so we don't carry false positives across the activation→active boundary.
    const isActivating =
      sessionForReconcile.activationState === AgentActivationState.PENDING
      || sessionForReconcile.activationState === AgentActivationState.ACTIVATING
      || sessionForReconcile.backendSessionId == null;
    if (isActivating) {
      failureCount = 0;
      continue;
    }

    // Get current session dynamically from agent-session slice
    const currentSession = yield* selectAgentSession.effect(agentId);
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
        ? yield* selectAgentSession.effect(agentId)
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
    const stateAfterCheck = yield* selectAgentSessionIsProcessing.effect(agentId);
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
      const lastChunkReceivedAt: number = yield* selectChatLastChunkReceivedAt.effect(agentId);
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

function isStatusEvent(value: unknown): value is StatusEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StatusEvent>;
  return typeof candidate.phase === 'string'
    && typeof candidate.message === 'string'
    && (candidate.level === 'info' || candidate.level === 'warn' || candidate.level === 'error')
    && typeof candidate.timestamp === 'number'
    && Number.isFinite(candidate.timestamp);
}

function parsePersistedStatusEvents(value: unknown): StatusEvent[] | null {
  if (!Array.isArray(value) || !value.every(isStatusEvent)) {
    return null;
  }
  return value;
}

function* hydrateStatusEvents(agentId: string): SagaGenerator<void> {
  const persisted: unknown = yield* call(getLocalStorageJSON, makeStorageKey(agentId));
  const statusEvents = parsePersistedStatusEvents(persisted);
  if (statusEvents && statusEvents.length > 0) {
    yield* put(chatStatusEventsHydrated(agentId, statusEvents));
  }
}

function* persistStatusEvents(agentId: string): SagaGenerator<void> {
  // Read current status events from state (flat: byAgentId)
  const statusEvents: StatusEvent[] = yield* selectChatStatusEvents.effect(agentId);
  yield* call(setLocalStorageJSON, makeStorageKey(agentId), sanitizeStatusEvents(statusEvents));
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

/** @internal Exposed for tests so they can assert task liveness after dispatches. */
export function __getActiveSendTasksForTesting(): Map<string, Task[]> {
  return activeSendTasks;
}

function* cancelAndForgetTasks(agentId: string, tasks: Task[]): SagaGenerator<void> {
  for (const task of tasks) {
    if (task.isRunning()) {
      yield* cancel(task);
    }
  }
  activeSendTasks.delete(agentId);
}

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

/** Hydrate status events from saga-owned localStorage during chat initialization */
function* watchStatusEventsHydration(): SagaGenerator<void> {
  yield* takeEvery(initializeChatRequested, function* (action) {
    yield* call(hydrateStatusEvents, action.payload.agentId);
  });
}

/** Clear status events storage on stream completion, error, or reset */
function* watchClearStorage(): SagaGenerator<void> {
  yield* takeEvery(
    [streamCompleted, chatReset, chatStopCompleted],
    function* (action) {
      const [agentId] = action.payload;
      yield* call(clearStatusEventsStorage, agentId);
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
      yield* call(cancelAndForgetTasks, agentId, existing);
    }
  });
}

/**
 * When a workspace unmounts, cancel per-agent watchdog tasks ONLY for agents
 * whose session is idle (not streaming and not processing).
 *
 * Agents that are still streaming/processing keep their watchdogs alive so
 * stall detection and state reconciliation continue running in the background
 * until the agent itself emits a completion/failure/stuck-cleared event
 * (handled by `watchSessionLifecycleForTaskCleanup`) or the workspace is fully
 * deleted (handled by `watchWorkspaceAgentStateRemoved`).
 */
function* watchWorkspaceUnmountedForCleanup(): SagaGenerator<void> {
  yield* takeEvery(workspaceUnmounted, function* (action) {
    const [wsId] = action.payload;
    const agents = yield* selectAllWorkspaceAgents.effect(wsId);

    const agentIds = new Set(agents.map((agent) => String(agent.id)));
    for (const agentId of activeSendTasks.keys()) {
      if (agentIds.has(agentId)) continue;

      const session = yield* selectAgentSession.effect(agentId);
      if (String(session?.workspaceId) === String(wsId)) {
        agentIds.add(agentId);
      }
    }

    for (const agentId of agentIds) {
      const existing = activeSendTasks.get(agentId);
      if (!existing) continue;
      const stillActive = yield* selectAgentIsResponding.effect(agentId);
      if (stillActive) {
        continue;
      }
      yield* call(cancelAndForgetTasks, agentId, existing);
    }
  });
}

/**
 * When a chat-session lifecycle event fires (completion, error, stop, reset,
 * stuck cleared), the `stallDetectionLoop` / `stateReconciliationLoop` loops
 * self-terminate on their next tick because they guard on `isStreaming` /
 * `isProcessing`. This watcher proactively cancels any still-running forks
 * and clears the map entry so that agents which completed while their
 * workspace was unmounted don't leave stale entries in `activeSendTasks`.
 */
function* watchSessionLifecycleForTaskCleanup(): SagaGenerator<void> {
  yield* takeEvery(
    [streamCompleted, chatStopCompleted, chatReset, chatInterrupted, chatStuckStateCleared],
    function* (action) {
      const [agentId] = action.payload;
      const existing = activeSendTasks.get(agentId);
      if (existing) {
        yield* call(cancelAndForgetTasks, agentId, existing);
      }
    },
  );
}

function isTerminalAgentStreamUpdate(eventType: string): boolean {
  return eventType === 'complete' || eventType === 'error' || eventType === 'timeout';
}

function* watchAgentStreamUpdatesForCleanup(): SagaGenerator<void> {
  yield* takeEvery(agentStreamUpdateReceived, function* (action) {
    const [payload] = action.payload;
    if (!isTerminalAgentStreamUpdate(payload.eventType)) return;

    yield* call(clearStatusEventsStorage, payload.agentId);
    const existing = activeSendTasks.get(payload.agentId);
    if (existing) {
      yield* call(cancelAndForgetTasks, payload.agentId, existing);
    }
  });
}

/**
 * When a workspace is fully deleted (`removeWorkspaceAgentState`), cancel
 * every tracked watchdog that was running for an agent in that workspace —
 * even if the agent's session still reports streaming/processing (its state
 * can no longer be meaningfully observed once the workspace is gone).
 */
function* watchWorkspaceAgentStateRemoved(): SagaGenerator<void> {
  yield* takeEvery(removeWorkspaceAgentState, function* (action) {
    const [wsId] = action.payload;
    for (const [agentId, tasks] of Array.from(activeSendTasks.entries())) {
      const session = yield* selectAgentSession.effect(agentId);
      if (!session || String(session.workspaceId) === String(wsId)) {
        yield* call(cancelAndForgetTasks, agentId, tasks);
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
  yield* fork(watchStatusEventsHydration);
  yield* fork(watchStatusEvents);
  yield* fork(watchClearStorage);
  yield* fork(watchSendMessage);
  yield* fork(initializeChatSaga);
  yield* fork(chatLifecycleSaga);
  yield* fork(watchAgentRemoved);
  yield* fork(watchWorkspaceUnmountedForCleanup);
  yield* fork(watchSessionLifecycleForTaskCleanup);
  yield* fork(watchAgentStreamUpdatesForCleanup);
  yield* fork(watchWorkspaceAgentStateRemoved);
}

