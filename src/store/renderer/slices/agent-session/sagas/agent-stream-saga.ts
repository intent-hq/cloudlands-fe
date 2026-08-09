import { buffers } from 'redux-saga';
import {
  actionChannel,
  call,
  flush,
  put,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
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
  return !!action && typeof action === 'object' && 'type' in action &&
    action.type === agentStreamUpdateReceived.type;
}

function interruptedMetadata(
  payload: AgentStreamUpdatePayload,
): { interrupted: true; stopReason: string } | undefined {
  return payload.eventType === 'complete' && payload.stopReason === 'interrupted'
    ? { interrupted: true, stopReason: payload.stopReason }
    : undefined;
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

function* applyStreamPayload(payload: AgentStreamUpdatePayload): SagaGenerator<void> {
  const { agentId, eventType, contentBlocks, assistantMessageId, assistantAppMessageId } = payload;
  if (!agentId) return;
  const isFinalize = eventType === 'complete' || eventType === 'error' || eventType === 'timeout';
  const session: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
  const existing = findStreamTargetAssistantMessage(
    session,
    assistantAppMessageId,
    assistantMessageId,
  );

  if (eventType === 'error' || eventType === 'timeout') {
    if (existing) {
      yield* put(updateMessage(agentId, existing.id, { isStreaming: false, streamingComplete: true }));
    }
    yield* call(clearSessionStreaming, agentId, eventType);
    return;
  }

  if (!existing) {
    if (isStaleFinalizedAssistantStream(session, assistantAppMessageId)) {
      if (isFinalize) yield* call(clearSessionStreaming, agentId, eventType);
      return;
    }
    if (!assistantMessageId) {
      if (isFinalize) yield* call(clearSessionStreaming, agentId, eventType);
      return;
    }
    const metadata = interruptedMetadata(payload);
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
    return;
  }

  const nextBlocks = resolveStreamContentBlocks(existing.contentBlocks, contentBlocks, eventType);
  if (eventType === 'complete') {
    const updates: Partial<AgentMessage> = { isStreaming: false, streamingComplete: true };
    if (nextBlocks && nextBlocks !== existing.contentBlocks) updates.contentBlocks = nextBlocks;
    const metadata = interruptedMetadata(payload);
    if (metadata) updates.metadata = { ...existing.metadata, ...metadata };
    yield* put(updateMessage(agentId, existing.id, updates));
    yield* call(clearSessionStreaming, agentId, eventType);
    return;
  }

  if (nextBlocks && nextBlocks !== existing.contentBlocks) {
    yield* put(updateMessage(agentId, existing.id, { contentBlocks: nextBlocks, isStreaming: true }));
  }
}

function* safelyApply(payload: AgentStreamUpdatePayload): SagaGenerator<void> {
  try {
    yield* call(applyStreamPayload, payload);
  } catch (error) {
    logger.error('Failed to apply agent stream update', error);
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