import { all, call, cancelled, put, race, take, takeLatest, type SagaGenerator } from 'typed-redux-saga';

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
type WorkspaceCleanupAction =
  | ReturnType<typeof workspaceDeleted>
  | ReturnType<typeof workspaceUnmounted>;

function identitySet(messages: AgentMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (typeof message.id === 'string') ids.add(message.id);
    if (typeof message.appMessageId === 'string') ids.add(message.appMessageId);
  }
  return ids;
}

function* hydrateChatTranscriptSaga(request: ChatRequest) {
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
    if (!session || String(session.workspaceId) !== wsId) return;
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
    } while (nextToken !== null);

    const snapshot: Awaited<ReturnType<typeof appClient.chat.subscribeSnapshot>> = yield* call(
      [appClient.chat, appClient.chat.subscribeSnapshot],
      agentId,
    );
    if (yield* call(isAgentDeletionPending, agentId)) return;

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

function matchesChatCleanup({ wsId, agentId }: ChatRequest) {
  return (action: WorkspaceCleanupAction) => {
    if (action.type !== workspaceDeleted.type && action.type !== workspaceUnmounted.type) return false;
    const [cleanupWorkspaceId, deletedAgentIds = []] = action.payload;
    return cleanupWorkspaceId === wsId || deletedAgentIds.includes(agentId);
  };
}

function* hydrateChatWorker(request: ChatRequest): SagaGenerator<void> {
  if (!request.wsId || !request.agentId) return;
  yield* race({
    read: call(hydrateChatTranscriptSaga, request),
    cleanup: take(matchesChatCleanup(request)),
  });
}

function* initializeChatWorker(action: ReturnType<typeof initializeChatRequested>) {
  yield* hydrateChatWorker(action.payload);
}

function* refreshChatWorker(action: ReturnType<typeof refreshChatTranscriptRequested>) {
  const [wsId, agentId] = action.payload;
  yield* hydrateChatWorker({ wsId, agentId });
}

export function* chatReadSaga() {
  yield* all([
    takeLatest(initializeChatRequested, initializeChatWorker),
    takeLatest(refreshChatTranscriptRequested, refreshChatWorker),
  ]);
}