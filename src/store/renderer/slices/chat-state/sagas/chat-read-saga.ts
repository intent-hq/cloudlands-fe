import type { Task } from 'redux-saga';
import { call, cancel, cancelled, fork, put, take, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentMessage, AgentSession } from '$shared/types';
import { deduplicateAgentMessages } from '$shared/utils/message-dedup';
import { seedStreamFromSnapshot } from '$features/events/daemon-events-bridge.client';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import {
  bulkUpsertSessions,
  upsertSession,
} from '../../agent-session/agent-session-slice';
import { selectAgentMessages } from '../../agent-session/agent-session-selectors';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  initializeChatRequested,
  refreshChatTranscriptRequested,
  transcriptHydrationSettled,
  transcriptHydrationStarted,
} from '../chat-state-slice';

const logger = createLogger('ChatReadSaga');
const PAGE_LIMIT = 200;

type ChatRequest = { wsId: string; agentId: string };
type PendingRequest = ChatRequest & { generation: number };
type ChatSlot = {
  wsId: string;
  generation: number;
  task?: Task;
  pending?: PendingRequest;
};

function identitySet(messages: AgentMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (typeof message.id === 'string') ids.add(message.id);
    if (typeof message.appMessageId === 'string') ids.add(message.appMessageId);
  }
  return ids;
}

function* hydrateChatTranscriptSaga(
  request: ChatRequest,
  slot: ChatSlot,
  generation: number,
) {
  const { wsId, agentId } = request;
  if (yield* call(isAgentDeletionPending, agentId)) return;
  let started = false;
  try {
    yield* put(transcriptHydrationStarted(agentId));
    started = true;
    const baseline: AgentMessage[] = yield* selectAgentMessages.effect(agentId);
    const baselineIds = identitySet(baseline);
    const session: AgentSession | null = yield* call(
      [appClient.agents, appClient.agents.get],
      agentId,
    );
    if (!session || String(session.workspaceId) !== wsId || slot.generation !== generation) return;
    if (yield* call(isAgentDeletionPending, agentId)) return;

    const messages: AgentMessage[] = [];
    let nextToken: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof appClient.agents.getConversation>> = yield* call(
        [appClient.agents, appClient.agents.getConversation],
        agentId,
        PAGE_LIMIT,
        nextToken ?? undefined,
      );
      messages.unshift(...page.messages);
      nextToken = page.nextToken;
      if (slot.generation !== generation) return;
    } while (nextToken !== null);

    const snapshot: Awaited<ReturnType<typeof appClient.chat.subscribeSnapshot>> = yield* call(
      [appClient.chat, appClient.chat.subscribeSnapshot],
      agentId,
    );
    if (slot.generation !== generation || (yield* call(isAgentDeletionPending, agentId))) return;

    const inFlight = snapshot.messages.find(
      (message) => message.role === 'assistant' && message.isStreaming === true,
    );
    let fetched = messages;
    if (inFlight && !messages.some((message) => message.id === inFlight.id)) {
      fetched = [...messages, inFlight];
      yield* call(seedStreamFromSnapshot, agentId, inFlight, wsId);
    }

    const current: AgentMessage[] = yield* selectAgentMessages.effect(agentId);
    const appendedDuringRead = current.filter(
      (message) =>
        !(baselineIds.has(message.id) ||
          (typeof message.appMessageId === 'string' && baselineIds.has(message.appMessageId))),
    );
    const merged =
      appendedDuringRead.length === 0
        ? fetched
        : deduplicateAgentMessages([...fetched, ...appendedDuringRead]);
    const hydrated = { ...session, messages: merged };
    yield* put(bulkUpsertSessions([hydrated]));
    yield* put(upsertSession(hydrated));
  } catch (error) {
    logger.error('Failed to load agent conversation transcript', error);
  } finally {
    if (started && !(yield* cancelled())) yield* put(transcriptHydrationSettled(agentId));
  }
}

function* runChatSlot(
  slots: Map<string, ChatSlot>,
  slot: ChatSlot,
  request: ChatRequest,
  generation: number,
): SagaGenerator<void> {
  try {
    yield* call(hydrateChatTranscriptSaga, request, slot, generation);
  } finally {
    if (slots.get(request.agentId) !== slot) return;
    slot.task = undefined;
    const pending = slot.pending;
    slot.pending = undefined;
    if (!pending) {
      slots.delete(request.agentId);
      return;
    }
    slot.wsId = pending.wsId;
    const task = yield* fork(runChatSlot, slots, slot, pending, pending.generation);
    slot.task = task;
  }
}

function* queueChatRead(slots: Map<string, ChatSlot>, request: ChatRequest) {
  const existing = slots.get(request.agentId);
  if (existing?.task) {
    existing.generation += 1;
    existing.pending = { ...request, generation: existing.generation };
    return;
  }
  const slot: ChatSlot = { wsId: request.wsId, generation: 1 };
  slots.set(request.agentId, slot);
  slot.task = yield* fork(runChatSlot, slots, slot, request, slot.generation);
}

export function* chatReadSaga() {
  const slots = new Map<string, ChatSlot>();
  try {
    while (true) {
      const action: { type: string; payload: unknown } = yield* take([
        initializeChatRequested,
        refreshChatTranscriptRequested,
        workspaceDeleted,
        workspaceUnmounted,
      ]);
      if (action.type === initializeChatRequested.type) {
        const payload = action.payload as { wsId: string; agentId: string };
        yield* fork(queueChatRead, slots, payload);
        continue;
      }
      if (action.type === refreshChatTranscriptRequested.type) {
        const [wsId, agentId] = action.payload as [string, string];
        yield* fork(queueChatRead, slots, { wsId, agentId });
        continue;
      }

      const [wsId, deletedAgentIds = []] = action.payload as [string, string[]?];
      for (const [agentId, slot] of slots) {
        if (slot.wsId !== wsId && !deletedAgentIds.includes(agentId)) continue;
        slots.delete(agentId);
        slot.pending = undefined;
        if (slot.task) yield* cancel(slot.task);
      }
    }
  } finally {
    for (const slot of slots.values()) {
      slot.pending = undefined;
      if (slot.task) yield* cancel(slot.task);
    }
    slots.clear();
  }
}