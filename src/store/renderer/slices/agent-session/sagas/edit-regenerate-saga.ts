import type { Task } from 'redux-saga';
import { call, cancel, cancelled, fork, put, take, type SagaGenerator } from 'typed-redux-saga';

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

function* drainAgentQueue(
  agentId: string,
  queues: Map<string, EditAction[]>,
  workers: Map<string, Task>,
): SagaGenerator<void> {
  const queue = queues.get(agentId);
  if (!queue) return;
  try {
    while (true) {
      const action = queue.shift();
      if (!action) return;
      yield* call(editAndRegenerate, action);
    }
  } finally {
    workers.delete(agentId);
    queues.delete(agentId);
    if (yield* cancelled()) {
      for (const action of queue) {
        yield* put(action.failure(new Error(m.agent_editRegenerate_failed_error())));
      }
      queue.length = 0;
    }
  }
}

export function* editRegenerateSaga(): SagaGenerator<void> {
  const queues = new Map<string, EditAction[]>();
  const workers = new Map<string, Task>();
  try {
    while (true) {
      const action: EditAction = yield* take(agentSessionEditAndRegenerateRequested);
      const agentId = action.payload[0];
      let queue = queues.get(agentId);
      if (!queue) {
        queue = [];
        queues.set(agentId, queue);
      }
      queue.push(action);
      if (!workers.has(agentId)) {
        const task = yield* fork(drainAgentQueue, agentId, queues, workers);
        workers.set(agentId, task);
      }
    }
  } finally {
    for (const task of workers.values()) yield* cancel(task);
    workers.clear();
    for (const queue of queues.values()) {
      for (const action of queue) {
        yield* put(action.failure(new Error(m.agent_editRegenerate_failed_error())));
      }
    }
    queues.clear();
  }
}
