import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { CHAT_PAGE_SIZE } from '$shared/constants';
import type { AgentMessage, AgentSession } from '$shared/types';
import type { AgentsClient } from '$lib/client/app-client';
import { createLogger } from '$lib/utils/client-logger';
import type { ChatAgentState } from '../chat-state-types';
import type { HistorySegmentMeta } from '../../agent-session/agent-history-projections';
import {
  appendHistoryMessages,
  prependHistoryMessages,
  setHistoryOldestReached,
} from '../../agent-session/agent-session-slice';
import {
  olderHistoryPageRequested,
  historyGapFillRequested,
  scrollbackFetchStarted,
  scrollbackOlderPageSettled,
  scrollbackGapPageSettled,
  scrollbackContinuationReset,
} from '../chat-state-slice';
type ConversationPage = Awaited<ReturnType<AgentsClient['getConversation']>>;
const logger = createLogger('ChatScrollbackSaga');
function oldestRowId(messages: AgentMessage[]): string | undefined {
  for (const message of messages) {
    if (typeof message.id === 'string' && message.id.length > 0) return message.id;
  }
  return undefined;
}

function newestRowId(messages: AgentMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (typeof message.id === 'string' && message.id.length > 0) return message.id;
  }
  return undefined;
}

/** Shared serial history policy. The renderer supplies canonical selector bindings and transport. */
export function createHistoryPageWorkers({
  getConversation,
  readChat,
  readMeta,
  readHistory,
  readTail,
  readSession,
  hasHistory,
  isDeleted,
}: {
  getConversation: AgentsClient['getConversation'];
  readChat: (id: string) => SagaGenerator<ChatAgentState>;
  readMeta: (id: string) => SagaGenerator<HistorySegmentMeta>;
  readHistory: (id: string) => SagaGenerator<AgentMessage[]>;
  readTail: (id: string) => SagaGenerator<AgentMessage[]>;
  readSession: (id: string) => SagaGenerator<AgentSession | null | undefined>;
  hasHistory: (id: string) => SagaGenerator<boolean>;
  isDeleted: (id: string) => boolean;
}) {
  /** One page: token continuation when a cursor is held, else an anchored seek. */
  function* fetchPage(
    agentId: string,
    token: string | null,
    anchor: string | undefined,
    workspaceId: string,
  ): SagaGenerator<ConversationPage> {
    if (token) {
      return yield* call(
        getConversation,
        agentId,
        CHAT_PAGE_SIZE,
        token,
        undefined,
        undefined,
        workspaceId,
      );
    }
    return yield* call(
      getConversation,
      agentId,
      CHAT_PAGE_SIZE,
      undefined,
      anchor,
      undefined,
      workspaceId,
    );
  }
  function* older(action: ReturnType<typeof olderHistoryPageRequested>): SagaGenerator<void> {
    const [workspaceId, agentId] = action.payload;
    if (yield* call(isDeleted, agentId)) return;
    const chat = yield* readChat(agentId);
    if (chat.initialHistoryPending || chat.fetchingOlderHistory || chat.fetchingGapFill) return;
    // Mirror of the seek worker's serial guard: a settling seek REPLACES the
    // segment, so a page anchored at the pre-seek segment must never merge
    // into the seeded one. The panel re-classifies once the seek settles.
    if (chat.fetchingHistorySeek) return;
    const meta = yield* readMeta(agentId);
    if (meta.oldestReached) return;
    const history: AgentMessage[] = yield* readHistory(agentId);
    // A held cursor is honored unconditionally — even when the segment holds
    // no rows. It is never stale: every segment-clearing path (removeSession,
    // the removeWorkspaceSessions / clearAllSessions bulk removals,
    // clearHistorySegment, the §7.1 `resumed: false` snapshot discard) nulls
    // it via scrollbackContinuationReset / the snapshot reducer's atomic
    // reset. And it can be the walk's only way to make progress: a page whose
    // rows are all already tail-resident merges to an EMPTY segment, so
    // re-anchoring at the tail's oldest row would refetch the identical page
    // forever. The anchored seek is only the no-cursor fallback.
    const token = chat.scrollbackOlderToken;
    const tail: AgentMessage[] = yield* readTail(agentId);
    const anchor = oldestRowId(history) ?? oldestRowId(tail);
    // No cursor and no anchorable row anywhere: empty conversation.
    if (!token && !anchor) return;
    const epoch = chat.scrollbackDiscardEpoch;
    yield* put(scrollbackFetchStarted(agentId, 'older'));
    let continuation: string | null = null;
    let blocked = true;
    try {
      const page = yield* fetchPage(agentId, token, anchor, workspaceId);
      if (yield* call(isDeleted, agentId)) return;
      // A §7.1 discard landed while the wire call was in flight: the page was
      // fetched against the discarded transcript — drop it entirely (the
      // reducer already reset the flags/cursors atomically with the snapshot).
      if (yield* discardedSince(agentId, epoch)) return;
      // Keep a segment record even for filtered/empty pages so its advancing
      // continuation survives the post-settle hygiene check.
      yield* put(prependHistoryMessages(agentId, page.messages));
      continuation = page.nextToken;
      blocked = token !== null && page.nextToken === token;
      if (page.nextToken === null) {
        yield* put(setHistoryOldestReached(agentId));
      }
    } catch (error) {
      logger.error('Failed to fetch older scrollback page', error);
    } finally {
      if (!(yield* discardedSince(agentId, epoch))) {
        yield* put(scrollbackOlderPageSettled(agentId, continuation, blocked));
        yield* dropContinuationIfSegmentGone(agentId, blocked);
      }
    }
  }

  function* gap(action: ReturnType<typeof historyGapFillRequested>): SagaGenerator<void> {
    const [workspaceId, agentId] = action.payload;
    if (yield* call(isDeleted, agentId)) return;
    const chat = yield* readChat(agentId);
    if (chat.initialHistoryPending || chat.fetchingGapFill || chat.fetchingOlderHistory) return;
    // Mirror of the seek worker's serial guard (see fetchOlderPageWorker).
    if (chat.fetchingHistorySeek) return;
    const meta = yield* readMeta(agentId);
    if (!meta.gapToTail) return;
    const history: AgentMessage[] = yield* readHistory(agentId);
    const anchor = newestRowId(history);
    if (!anchor) return;
    const token = chat.scrollbackGapToken;
    const epoch = chat.scrollbackDiscardEpoch;
    yield* put(scrollbackFetchStarted(agentId, 'gap'));
    let continuation: string | null = null;
    let blocked = true;
    try {
      const page = yield* fetchPage(agentId, token, anchor, workspaceId);
      if (yield* call(isDeleted, agentId)) return;
      // Mid-flight §7.1 discard: drop the stale page (see fetchOlderPageWorker).
      if (yield* discardedSince(agentId, epoch)) return;
      if (page.messages.length > 0) {
        yield* put(appendHistoryMessages(agentId, page.messages));
      }
      continuation = page.prevToken;
      blocked = page.prevToken === null || (token !== null && page.prevToken === token);
    } catch (error) {
      logger.error('Failed to fetch scrollback gap-refill page', error);
    } finally {
      if (!(yield* discardedSince(agentId, epoch))) {
        yield* put(scrollbackGapPageSettled(agentId, continuation, blocked));
        yield* dropContinuationIfSegmentGone(agentId, blocked);
      }
    }
  }

  function* discardedSince(agentId: string, epoch: number): SagaGenerator<boolean> {
    const chat = yield* readChat(agentId);
    return chat.scrollbackDiscardEpoch !== epoch;
  }
  function* dropContinuationIfSegmentGone(agentId: string, blocked = false): SagaGenerator<void> {
    if (blocked && (yield* readSession(agentId))) return;
    if (!(yield* hasHistory(agentId))) yield* put(scrollbackContinuationReset(agentId));
  }
  // One source owner for each trigger; renderer lifetimes provide admission.
  function* watch(admits: (workspaceId: string, agentId: string) => boolean = () => true) {
    return [
      yield* takeEvery(olderHistoryPageRequested, function* (action) {
        if (admits(...action.payload)) yield* call(older, action);
      }),
      yield* takeEvery(historyGapFillRequested, function* (action) {
        if (admits(...action.payload)) yield* call(gap, action);
      }),
    ];
  }
  return { watch };
}
