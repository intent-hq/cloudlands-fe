import {
  all,
  call,
  cancelled,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentMessage, AgentSession } from '$shared/types';
import { deduplicateAgentMessages } from '$shared/utils/message-dedup';
import { seedStreamFromSnapshot } from '$features/events/daemon-events-bridge.client';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import { bulkUpsertSessions, upsertSession } from '../../agent-session/agent-session-slice';
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
type HydrationTails = Map<string, Promise<void>>;

function identitySet(messages: AgentMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (typeof message.id === 'string') ids.add(message.id);
    if (typeof message.appMessageId === 'string') ids.add(message.appMessageId);
  }
  return ids;
}

function* hydrateAfterPrevious(request: ChatRequest, previous: Promise<void>) {
  yield* call(() => previous);
  yield* call(hydrateChatTranscriptSaga, request);
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
        !(
          baselineIds.has(message.id) ||
          (typeof message.appMessageId === 'string' && baselineIds.has(message.appMessageId))
        ),
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
  return (action: { type: string; payload?: unknown }) => {
    if (action.type !== workspaceDeleted.type && action.type !== workspaceUnmounted.type)
      return false;
    if (!Array.isArray(action.payload)) return false;
    const [cleanupWorkspaceId, deletedAgentIds = []] = action.payload;
    return (
      cleanupWorkspaceId === wsId ||
      (Array.isArray(deletedAgentIds) && deletedAgentIds.includes(agentId))
    );
  };
}

function* hydrateChatWorker(
  request: ChatRequest,
  hydrationTails: HydrationTails,
): SagaGenerator<void> {
  if (!request.wsId || !request.agentId) return;

  const previous = hydrationTails.get(request.agentId) ?? Promise.resolve();
  let release!: () => void;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => completion);
  hydrationTails.set(request.agentId, tail);
  void tail.then(() => {
    if (hydrationTails.get(request.agentId) === tail) hydrationTails.delete(request.agentId);
  });

  try {
    yield* race({
      read: call(hydrateAfterPrevious, request, previous),
      cleanup: take(matchesChatCleanup(request)),
    });
  } finally {
    release();
  }
}

function* initializeChatWorker(
  hydrationTails: HydrationTails,
  action: ReturnType<typeof initializeChatRequested>,
) {
  yield* hydrateChatWorker(action.payload, hydrationTails);
}

function* refreshChatWorker(
  hydrationTails: HydrationTails,
  action: ReturnType<typeof refreshChatTranscriptRequested>,
) {
  const [wsId, agentId] = action.payload;
  yield* hydrateChatWorker({ wsId, agentId }, hydrationTails);
}

export function* chatReadSaga() {
  const hydrationTails: HydrationTails = new Map();
  try {
    yield* all([
      takeEvery(initializeChatRequested, initializeChatWorker, hydrationTails),
      takeEvery(refreshChatTranscriptRequested, refreshChatWorker, hydrationTails),
    ]);
  } finally {
    hydrationTails.clear();
  }
}
