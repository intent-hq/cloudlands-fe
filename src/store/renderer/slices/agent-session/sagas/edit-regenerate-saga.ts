import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  chatLastAttemptedMessageSet,
  chatQueuedRetryRecordsCleared,
  chatSendStarted,
} from '../../chat-state/chat-state-slice';
import { agentSessionEditAndRegenerateRequested, replaceMessages } from '../agent-session-slice';
import { selectAgentSession } from '../agent-session-selectors';

const logger = createLogger('EditRegenerateSaga');
type EditAction = ReturnType<typeof agentSessionEditAndRegenerateRequested>;

function editError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(error ? String(error) : m.agent_editRegenerate_failed_error());
}

async function showEditError(message: string): Promise<void> {
  try {
    const { toast } = await import('svelte-sonner');
    toast.error(message);
  } catch (error) {
    logger.error('Failed to surface edit-and-regenerate error', error);
  }
}

function* editAndRegenerate(action: EditAction): SagaGenerator<void> {
  const [agentId, wsId, messageId, newText, options] = action.payload;
  let settled = false;
  try {
    const result = yield* call([appClient.agents, appClient.agents.editAndRegenerate], {
      agentId,
      workspaceId: wsId,
      messageId,
      content: newText,
      ...(options?.model !== undefined ? { model: options.model } : {}),
    });
    if (!result.success) throw new Error(result.error || m.agent_editRegenerate_failed_error());

    const session = yield* selectAgentSession.effect(agentId);
    const index = session?.messages.findIndex((message) => message.id === messageId) ?? -1;
    if (session && index >= 0) {
      yield* put(replaceMessages(agentId, session.messages.slice(0, index)));
    }
    yield* put(chatQueuedRetryRecordsCleared(agentId));
    yield* put(chatSendStarted(agentId, wsId));
    yield* put(chatLastAttemptedMessageSet(agentId, { text: newText }));
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    const resolved = editError(error);
    yield* call(showEditError, resolved.message);
    yield* put(action.failure(resolved));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_editRegenerate_failed_error())));
    }
  }
}

export function* editRegenerateSaga(): SagaGenerator<void> {
  yield* takeEvery(agentSessionEditAndRegenerateRequested, editAndRegenerate);
}
