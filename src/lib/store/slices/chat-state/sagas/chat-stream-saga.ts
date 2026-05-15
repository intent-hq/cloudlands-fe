/**
 * Chat Stream Saga
 *
 * Manages the streaming lifecycle that was previously handled by chat service
 * instance fields and methods:
 *
 * - Stream timeout management
 *
 * Non-serializable timer handles live in the chat-stream-registry module,
 * NOT in Redux state.
 */

import type { Task } from 'redux-saga';
import {
  call,
  delay,
  fork,
  put,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { createLogger } from '$lib/utils/client-logger';
import {
  streamStatusReceived,
  streamTimedOut,
} from '../chat-state-slice';
import {
  selectAgentSessionExists,
  selectAgentSessionIsStreaming,
  selectAgentSessionWorkspaceId,
} from '../../agent-session/agent-session-selectors';
import { setAgentStreaming } from '../../agent-session/agent-session-slice';
import { agentStreamUpdateReceived } from '../../workspace-agents/workspace-agents-slice';
import * as registry from '../chat-stream-registry';

const logger = createLogger('ChatStreamSaga');

// NOTE: Connection change monitoring (online/offline) is handled by
// chat-lifecycle-saga.ts (watchConnectionChange). Not duplicated here.

// ============================================================================
// Canonical stream updates — saga-owned runtime effects only
// ============================================================================

function* handleAgentStreamUpdateRuntimeEffects(
  action: ReturnType<typeof agentStreamUpdateReceived>,
): SagaGenerator<void> {
  const [payload] = action.payload;
  if (
    payload.eventType === 'started' ||
    payload.eventType === 'chunk' ||
    payload.eventType === 'content-blocks'
  ) {
    yield* rearmStreamTimeout(payload.handlerSessionId, payload.agentId);
    return;
  }
  if (
    payload.eventType === 'complete' ||
    payload.eventType === 'error' ||
    payload.eventType === 'timeout'
  ) {
    yield* clearStreamTimeout(payload.handlerSessionId);
  }
}

function cancelStreamTimeoutFromRegistry(sessionId: string): void {
  const timeout = registry.getStreamTimeout(sessionId);
  if (timeout) {
    timeout.cleanup();
    registry.deleteStreamTimeout(sessionId);
  }
}

function* backendStreamTimeoutLoop(sessionId: string, agentId: string): SagaGenerator<void> {
  yield* delay(registry.STREAM_TIMEOUT_MS);

  const isStreaming = yield* selectAgentSessionIsStreaming.effect(agentId);
  const hasSession = yield* selectAgentSessionExists.effect(agentId);
  const currentWorkspaceId = yield* selectAgentSessionWorkspaceId.effect(agentId);

  if (isStreaming && hasSession) {
    logger.warn('Stream timeout - cleaning up', { sessionId });
    if (currentWorkspaceId) {
      yield* put(setAgentStreaming(agentId, false));
    }
    yield* put(streamTimedOut(agentId));
  }

  registry.deleteStreamTimeout(sessionId);
}

function* rearmStreamTimeout(sessionId: string, agentId: string): SagaGenerator<void> {
  yield* call(cancelStreamTimeoutFromRegistry, sessionId);
  const task: Task = yield* fork(backendStreamTimeoutLoop, sessionId, agentId);
  registry.setStreamTimeout(sessionId, { cleanup: () => task.cancel() });
}

function* clearStreamTimeout(sessionId: string): SagaGenerator<void> {
  yield* call(cancelStreamTimeoutFromRegistry, sessionId);
}

function* handleStreamStatusRuntimeEffects(
  action: ReturnType<typeof streamStatusReceived>,
): SagaGenerator<void> {
  const [agentId, , , context] = action.payload;
  if (!context?.sessionId) return;
  yield* rearmStreamTimeout(context.sessionId, agentId);
}

// ============================================================================
// Root Saga
// ============================================================================

export function* chatStreamSaga(): SagaGenerator<void> {
  yield* takeEvery(agentStreamUpdateReceived, handleAgentStreamUpdateRuntimeEffects);
  yield* takeEvery(streamStatusReceived, handleStreamStatusRuntimeEffects);
}
