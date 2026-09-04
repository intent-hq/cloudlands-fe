import { buffers } from 'redux-saga';
import { actionChannel, call, flush, put, take, type SagaGenerator } from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
import {
  reportStreamLifecycle,
  streamTurnCorrelation,
} from '$lib/utils/stream-lifecycle-telemetry';
import { hasStandingChatSubscription } from '$features/agent/utils/chat-subscription-registry';
import type { AgentMessage, AgentSession } from '$shared/types';
import { streamCompleted, streamTimedOut } from '../../chat-state/chat-state-slice';
import { selectChatAgentState } from '../../chat-state/chat-state-selectors';
import {
  agentStreamUpdateReceived,
  type AgentStreamUpdatePayload,
} from '../../workspace-agents/workspace-agents-stream-slice';
import { addMessage, updateMessage } from '../agent-session-slice';
import { selectAgentSession } from '../agent-session-selectors';
import { resolveStreamContentBlocks } from '../utils/stream-content-blocks';
import {
  findStreamTargetAssistantMessage,
  isStaleFinalizedAssistantStream,
} from '../utils/stream-target-state';

const logger = createLogger('AgentStreamSaga');

function isStreamUpdateAction(
  action: unknown,
): action is ReturnType<typeof agentStreamUpdateReceived> {
  return (
    !!action &&
    typeof action === 'object' &&
    'type' in action &&
    action.type === agentStreamUpdateReceived.type
  );
}

function interruptedMetadata(
  payload: AgentStreamUpdatePayload,
): { interrupted: true; stopReason: string } | undefined {
  return payload.eventType === 'complete' && payload.stopReason === 'interrupted'
    ? { interrupted: true, stopReason: payload.stopReason }
    : undefined;
}

/**
 * Metadata to stamp on a message finalized by a terminal `complete` payload:
 * the interrupted marker (Stopped badge) and/or the abnormal `finishReason`
 * (PROTOCOL §7.3 — refusal / max_tokens / max_turn_requests notice). Mirrors
 * what the daemon persists on the row, so live and reloaded transcripts agree.
 */
function finalizedMetadata(payload: AgentStreamUpdatePayload): Record<string, unknown> | undefined {
  const interrupted = interruptedMetadata(payload);
  const finishReason =
    payload.eventType === 'complete' && payload.finishReason
      ? { finishReason: payload.finishReason }
      : undefined;
  if (!interrupted && !finishReason) return undefined;
  return { ...interrupted, ...finishReason };
}

function* clearSessionStreaming(
  agentId: string,
  eventType: AgentStreamUpdatePayload['eventType'],
): SagaGenerator<void> {
  if (eventType === 'timeout') {
    yield* put(streamTimedOut(agentId));
    return;
  }
  if (eventType === 'complete' || eventType === 'error') {
    const chatState = yield* selectChatAgentState.effect(agentId);
    yield* put(
      streamCompleted(agentId, {
        lastAttemptedMessage: chatState.lastAttemptedMessage,
        modelUnavailable: chatState.modelUnavailable,
      }),
    );
  }
}

function* reportAppliedStoreState(
  payload: AgentStreamUpdatePayload,
  event: 'update-applied' | 'update-ignored',
): SagaGenerator<void> {
  const session: AgentSession | undefined = yield* selectAgentSession.effect(payload.agentId);
  const message = session?.messages.find(
    (candidate) =>
      candidate.role === 'assistant' &&
      ((payload.assistantMessageId && candidate.id === payload.assistantMessageId) ||
        (payload.assistantAppMessageId &&
          candidate.appMessageId === payload.assistantAppMessageId)),
  );
  const chatState = yield* selectChatAgentState.effect(payload.agentId);
  const storeStreamState = chatState.error
    ? 'error'
    : !message
      ? 'missing'
      : message.isStreaming === true || message.streamingComplete === false
        ? 'streaming'
        : 'idle';
  reportStreamLifecycle({
    stage: 'store',
    event,
    turnCorrelation: streamTurnCorrelation(payload.assistantMessageId),
    callbackResult: event === 'update-applied' ? 'observed' : 'ignored',
    storeStreamState,
    ...(message?.contentBlocks ? { blockCount: message.contentBlocks.length } : {}),
  });
}

function* applyStreamPayload(payload: AgentStreamUpdatePayload): SagaGenerator<void> {
  const { agentId, eventType, assistantMessageId, assistantAppMessageId } = payload;
  if (!agentId) return;
  // SOLE-WRITER INVARIANT (PROTOCOL §7.1): while a standing chat.subscribe
  // registration covers the agent, the subscription owns message CONTENT —
  // drop the firehose payload's blocks and keep only the bookkeeping writes
  // (streaming flags, interrupted/finishReason metadata, session flag
  // clearing). The bridge already omits blocks at dispatch time; this
  // apply-time re-check covers dispatches buffered across a registration
  // install (e.g. the terminal flush in the saga's finally block), so a stale
  // accumulator set can never replace the reconciled transcript.
  const contentBlocks = hasStandingChatSubscription(agentId) ? undefined : payload.contentBlocks;
  const isFinalize = eventType === 'complete' || eventType === 'error' || eventType === 'timeout';
  const session: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
  const existing = findStreamTargetAssistantMessage(
    session,
    assistantAppMessageId,
    assistantMessageId,
  );

  if (eventType === 'error' || eventType === 'timeout') {
    if (existing) {
      yield* put(
        updateMessage(agentId, existing.id, { isStreaming: false, streamingComplete: true }),
      );
    }
    yield* call(clearSessionStreaming, agentId, eventType);
    yield* reportAppliedStoreState(payload, 'update-applied');
    return;
  }

  if (!existing) {
    if (isStaleFinalizedAssistantStream(session, assistantAppMessageId)) {
      if (isFinalize) yield* call(clearSessionStreaming, agentId, eventType);
      yield* reportAppliedStoreState(payload, 'update-ignored');
      return;
    }
    if (!assistantMessageId) {
      if (isFinalize) yield* call(clearSessionStreaming, agentId, eventType);
      yield* reportAppliedStoreState(payload, 'update-ignored');
      return;
    }
    const metadata = finalizedMetadata(payload);
    // For a covered agent this placeholder is deliberately EMPTY-content
    // (blocks were dropped above): a terminal `complete` racing ahead of the
    // §7.1 reconcile still surfaces its metadata live (Stopped badge /
    // finishReason notice) on a transient row the reconcile then replaces by
    // id — not dropped content.
    const placeholder: AgentMessage = {
      id: assistantMessageId,
      ...(assistantAppMessageId ? { appMessageId: assistantAppMessageId } : {}),
      role: 'assistant',
      contentBlocks: resolveStreamContentBlocks(undefined, contentBlocks, eventType) ?? [],
      timestamp: new Date(payload.timestamp ?? Date.now()).toISOString(),
      isStreaming: eventType !== 'complete',
      streamingComplete: eventType === 'complete',
      ...(metadata ? { metadata } : {}),
    };
    yield* put(addMessage(agentId, placeholder));
    if (isFinalize) yield* call(clearSessionStreaming, agentId, eventType);
    yield* reportAppliedStoreState(payload, 'update-applied');
    return;
  }

  const nextBlocks = resolveStreamContentBlocks(existing.contentBlocks, contentBlocks, eventType);
  if (eventType === 'complete') {
    const updates: Partial<AgentMessage> = { isStreaming: false, streamingComplete: true };
    if (nextBlocks && nextBlocks !== existing.contentBlocks) updates.contentBlocks = nextBlocks;
    const metadata = finalizedMetadata(payload);
    if (metadata) updates.metadata = { ...existing.metadata, ...metadata };
    yield* put(updateMessage(agentId, existing.id, updates));
    yield* call(clearSessionStreaming, agentId, eventType);
    yield* reportAppliedStoreState(payload, 'update-applied');
    return;
  }

  if (nextBlocks && nextBlocks !== existing.contentBlocks) {
    yield* put(
      updateMessage(agentId, existing.id, { contentBlocks: nextBlocks, isStreaming: true }),
    );
    yield* reportAppliedStoreState(payload, 'update-applied');
    return;
  }
  yield* reportAppliedStoreState(payload, 'update-ignored');
}

function* safelyApply(payload: AgentStreamUpdatePayload): SagaGenerator<void> {
  try {
    yield* call(applyStreamPayload, payload);
  } catch (error) {
    logger.error('Failed to apply agent stream update', error);
    reportStreamLifecycle({
      stage: 'store',
      event: 'update-threw',
      turnCorrelation: streamTurnCorrelation(payload.assistantMessageId),
      callbackResult: 'threw',
    });
  }
}

export function* agentStreamSaga(): SagaGenerator<void> {
  const channel = yield* actionChannel(
    isStreamUpdateAction,
    buffers.expanding<ReturnType<typeof agentStreamUpdateReceived>>(),
  );
  try {
    while (true) {
      const action: ReturnType<typeof agentStreamUpdateReceived> = yield* take(channel);
      yield* call(safelyApply, action.payload[0]);
    }
  } finally {
    const buffered: ReturnType<typeof agentStreamUpdateReceived>[] = yield* flush(channel);
    for (const action of buffered) {
      const payload = action.payload[0];
      if (
        payload.eventType === 'complete' ||
        payload.eventType === 'error' ||
        payload.eventType === 'timeout'
      ) {
        yield* safelyApply(payload);
      }
    }
    channel.close();
  }
}
