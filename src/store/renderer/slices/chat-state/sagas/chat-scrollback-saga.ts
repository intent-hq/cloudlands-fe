/**
 * Chat scrollback saga — on-demand history page fetches driven by UI request
 * actions, feeding the bounded scrollback HISTORY SEGMENT (agent-session
 * slice). Tail hydration paths (chat-read-saga) are untouched.
 *
 * Two directions, ONE 200-row page per request, deduped per agent per
 * direction by the chat-state fetching flags (takeLeading semantics — the
 * flag is set synchronously before the wire call, so a second request
 * arriving mid-flight is dropped):
 *
 *  - OLDER (`olderHistoryPageRequested`): anchor a §5.5 `aroundMessageId`
 *    seek at the history segment's oldest row (or the tail's oldest when
 *    history is empty), then persist the page's `nextToken` per agent so
 *    subsequent requests continue the backward walk without re-seeking.
 *    Pages merge via `prependHistoryMessages` (normalize/dedup/sort; past
 *    the segment cap the reducer prunes the newest side and opens
 *    `gapToTail`). `nextToken === null` marks `setHistoryOldestReached`.
 *
 *  - GAP REFILL (`historyGapFillRequested`): only while the segment's
 *    `gapToTail` is open. Anchor a seek at history's newest row, then walk
 *    the seek page's `prevToken` (forward cursor toward the live tail) one
 *    page per request. Pages merge via `appendHistoryMessages`, which closes
 *    the gap when appended rows overlap the tail; a page whose rows the tail
 *    has since pruned simply lands in history with the gap still open, and
 *    the persisted token keeps the walk moving on the next request.
 *
 *  - SEEK (`historySeekRequested`): far-flick jump. ONE `aroundIndex`
 *    (§5.5 ordinal seek, 0-based from oldest, clamped daemon-side) fetch
 *    REPLACES the history segment with the landing page
 *    (`seedHistoryAround`), and BOTH cursors the landing page mints persist
 *    (backward `nextToken`, forward `prevToken`) so subsequent older/gap
 *    walks continue from the landing without re-seeking. A daemon predating
 *    `aroundIndex` rejects with INVALID_PARAMS (-32602): the settle latches
 *    `historySeekUnsupported`, disabling seeks for the agent — deep scrolls
 *    keep exactly the serial-walk behavior.
 *
 * Each settle drops the OTHER direction's cursor: a prepend can cap-prune
 * history's newest side and an append its oldest side, so the other walk's
 * position may no longer border the segment — its next request re-seeks.
 * Continuation state resets when the history segment is cleared out from
 * under the walk (session removal, explicit segment clear, and the §7.1
 * `resumed: false` rehydration — whose retained rows are unanchored, so the
 * segment itself is discarded here too). Errors are logged and swallowed
 * (the transcript already rendered); the finally settle always clears the
 * fetching flag.
 */
import { all, call, delay, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { estimateSeekLandingStartOrdinal } from '$lib/utils/seek-landing-estimate';
import type { AgentMessage } from '$shared/types';
import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';
import { getQuestionFromResourceBlock, type Question } from '$shared/types/question-resource';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import {
  appendHistoryMessages,
  clearHistorySegment,
  prependHistoryMessages,
  removeSession,
  seedHistoryAround,
  setHistoryOldestReached,
} from '../../agent-session/agent-session-slice';
import {
  selectAgentHistoryMessages,
  selectAgentMessageById,
  selectAgentMessages,
  selectAgentSession,
  selectHistorySegmentMeta,
} from '../../agent-session/agent-session-selectors';
import {
  chatTranscriptSnapshotApplied,
  historyGapFillRequested,
  historySeekRequested,
  olderHistoryPageRequested,
  pendingQuestionRecoveryCleared,
  pendingQuestionRecoveryRequested,
  pendingQuestionRecoverySettled,
  scrollbackContinuationReset,
  scrollbackFetchStarted,
  scrollbackGapPageSettled,
  scrollbackOlderPageSettled,
  scrollbackSeekSettled,
} from '../chat-state-slice';
import { selectChatAgentState } from '../chat-state-selectors';

const logger = createLogger('ChatScrollbackSaga');
const PAGE_LIMIT = 200;
const MARKED_QUESTION_LIMIT = 1;
const MARKED_QUESTION_RETRY_DELAYS_MS = [250, 1_000] as const;

type ConversationPage = Awaited<ReturnType<typeof appClient.agents.getConversation>>;
type ObservedAction = { type: string; payload?: unknown };

function markedQuestions(message: AgentMessage): Question[] {
  if (message.role !== 'assistant' || message.isStreaming) return [];
  return dedupeResourceBlocks(message.contentBlocks ?? [])
    .map(getQuestionFromResourceBlock)
    .filter((question): question is Question => question !== null);
}

function stopsPendingQuestionRecovery(
  action: ObservedAction,
  agentId: string,
  messageId: string,
): boolean {
  if (!Array.isArray(action.payload) || action.payload[0] !== agentId) return false;
  if (action.type === removeSession.type || action.type === pendingQuestionRecoveryCleared.type) {
    return true;
  }
  return action.type === pendingQuestionRecoveryRequested.type && action.payload[1] !== messageId;
}

function* pendingQuestionRecoveryIsCurrent(
  agentId: string,
  messageId: string,
): SagaGenerator<boolean> {
  const session = yield* selectAgentSession.effect(agentId);
  const chat = yield* selectChatAgentState.effect(agentId);
  return (
    session?.metadata?.pendingQuestionsMessageId === messageId &&
    chat.pendingQuestionRecovery?.messageId === messageId &&
    chat.pendingQuestionRecovery.status === 'loading'
  );
}

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

/** One page: token continuation when a cursor is held, else an anchored seek. */
function* fetchPage(
  agentId: string,
  token: string | null,
  anchor: string,
): SagaGenerator<ConversationPage> {
  if (token) {
    return yield* call(
      [appClient.agents, appClient.agents.getConversation],
      agentId,
      PAGE_LIMIT,
      token,
    );
  }
  return yield* call(
    [appClient.agents, appClient.agents.getConversation],
    agentId,
    PAGE_LIMIT,
    undefined,
    anchor,
  );
}

function* fetchOlderPageWorker(
  action: ReturnType<typeof olderHistoryPageRequested>,
): SagaGenerator<void> {
  const [, agentId] = action.payload;
  if (yield* call(isAgentDeletionPending, agentId)) return;
  const chat = yield* selectChatAgentState.effect(agentId);
  if (chat.fetchingOlderHistory) return;
  // Mirror of the seek worker's serial guard: a settling seek REPLACES the
  // segment, so a page anchored at the pre-seek segment must never merge
  // into the seeded one. The panel re-classifies once the seek settles.
  if (chat.fetchingHistorySeek) return;
  const meta = yield* selectHistorySegmentMeta.effect(agentId);
  if (meta.oldestReached) return;
  const history: AgentMessage[] = yield* selectAgentHistoryMessages.effect(agentId);
  // The persisted cursor is only honored while the segment it was minted
  // against still has rows; with no anchorable row anywhere there is no
  // history to page (empty conversation).
  const token = history.length > 0 ? chat.scrollbackOlderToken : null;
  const tail: AgentMessage[] = yield* selectAgentMessages.effect(agentId);
  const anchor = oldestRowId(history) ?? oldestRowId(tail);
  if (!anchor) return;
  yield* put(scrollbackFetchStarted(agentId, 'older'));
  let continuation: string | null = null;
  try {
    const page = yield* fetchPage(agentId, token, anchor);
    if (yield* call(isAgentDeletionPending, agentId)) return;
    if (page.messages.length > 0) {
      yield* put(prependHistoryMessages(agentId, page.messages));
    }
    continuation = page.nextToken;
    if (page.nextToken === null) {
      yield* put(setHistoryOldestReached(agentId));
    }
  } catch (error) {
    logger.error('Failed to fetch older scrollback page', error);
  } finally {
    yield* put(scrollbackOlderPageSettled(agentId, continuation));
    yield* dropContinuationIfSegmentGone(agentId);
  }
}

function* fetchGapFillWorker(
  action: ReturnType<typeof historyGapFillRequested>,
): SagaGenerator<void> {
  const [, agentId] = action.payload;
  if (yield* call(isAgentDeletionPending, agentId)) return;
  const chat = yield* selectChatAgentState.effect(agentId);
  if (chat.fetchingGapFill) return;
  // Mirror of the seek worker's serial guard (see fetchOlderPageWorker).
  if (chat.fetchingHistorySeek) return;
  const meta = yield* selectHistorySegmentMeta.effect(agentId);
  if (!meta.gapToTail) return;
  const history: AgentMessage[] = yield* selectAgentHistoryMessages.effect(agentId);
  const anchor = newestRowId(history);
  if (!anchor) return;
  const token = chat.scrollbackGapToken;
  yield* put(scrollbackFetchStarted(agentId, 'gap'));
  let continuation: string | null = null;
  try {
    const page = yield* fetchPage(agentId, token, anchor);
    if (yield* call(isAgentDeletionPending, agentId)) return;
    if (page.messages.length > 0) {
      yield* put(appendHistoryMessages(agentId, page.messages));
    }
    continuation = page.prevToken;
  } catch (error) {
    logger.error('Failed to fetch scrollback gap-refill page', error);
  } finally {
    yield* put(scrollbackGapPageSettled(agentId, continuation));
    yield* dropContinuationIfSegmentGone(agentId);
  }
}

/**
 * INVALID_PARAMS (-32602) from either transport: a strict daemon rejecting
 * the `aroundIndex` param it does not know. Deliberately over-matches: the
 * daemon serves other -32602s on this method (e.g. agent not found), so a
 * seek racing a daemon-side agent deletion can latch `historySeekUnsupported`
 * from an unrelated rejection — accepted, since the latch is per-agent and
 * that agent is gone anyway.
 */
function isInvalidParamsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { rpcCode?: unknown; code?: unknown };
  return candidate.rpcCode === -32602 || candidate.code === 'INVALID_PARAMS';
}

function* historySeekWorker(
  action: ReturnType<typeof historySeekRequested>,
): SagaGenerator<void> {
  const [, agentId, targetOrdinal] = action.payload;
  if (yield* call(isAgentDeletionPending, agentId)) return;
  const chat = yield* selectChatAgentState.effect(agentId);
  if (chat.fetchingHistorySeek || chat.historySeekUnsupported) return;
  // Never race a seek against an in-flight serial page: the landing REPLACES
  // the segment, and a page settling afterwards would merge into the wrong
  // segment. The panel re-classifies once the in-flight fetch settles.
  if (chat.fetchingOlderHistory || chat.fetchingGapFill) return;
  const target = Math.max(0, Math.round(targetOrdinal));
  yield* put(scrollbackFetchStarted(agentId, 'seek'));
  let tokens: { nextToken: string | null; prevToken: string | null } = {
    nextToken: null,
    prevToken: null,
  };
  let unsupported = false;
  try {
    const page: ConversationPage = yield* call(
      [appClient.agents, appClient.agents.getConversation],
      agentId,
      PAGE_LIMIT,
      undefined,
      undefined,
      target,
    );
    if (yield* call(isAgentDeletionPending, agentId)) return;
    if (page.prevToken === null) {
      // No forward cursor: either the daemon predates `aroundIndex` (its
      // router ignores unknown params and returned the legacy NEWEST page),
      // or the seek legitimately clamped at the newest edge. Distinguish by
      // coverage — on both daemon generations the returned page is the
      // newest slice here, so its start ordinal is exact.
      const newestPageStart = Math.max(0, page.totalMessages - page.messages.length);
      if (target >= newestPageStart && page.messages.length > 0) {
        yield* put(seedHistoryAround(agentId, page.messages, newestPageStart));
        tokens = { nextToken: page.nextToken, prevToken: null };
        if (page.nextToken === null) yield* put(setHistoryOldestReached(agentId));
      } else {
        // The page cannot contain the target — old daemon. Discard it and
        // disable seeks for this agent (serial walk keeps working).
        unsupported = true;
        logger.warn('Daemon ignored aroundIndex (predates the param); disabling seek', {
          agentId,
        });
      }
    } else if (page.messages.length > 0) {
      yield* put(
        seedHistoryAround(
          agentId,
          page.messages,
          estimateSeekLandingStartOrdinal(target, page.messages.length, page.totalMessages),
        ),
      );
      tokens = { nextToken: page.nextToken, prevToken: page.prevToken };
      if (page.nextToken === null) yield* put(setHistoryOldestReached(agentId));
    }
  } catch (error) {
    if (isInvalidParamsError(error)) {
      unsupported = true;
      logger.warn('Daemon rejected aroundIndex (INVALID_PARAMS); disabling seek', { agentId });
    } else {
      logger.error('Failed to fetch scrollback seek page', error);
    }
  } finally {
    yield* put(scrollbackSeekSettled(agentId, tokens, unsupported));
    yield* dropContinuationIfSegmentGone(agentId);
  }
}

function* recoverPendingQuestionWorker(
  inFlight: Set<string>,
  action: ReturnType<typeof pendingQuestionRecoveryRequested>,
): SagaGenerator<void> {
  const [agentId, messageId] = action.payload;
  const key = `${agentId}\u0000${messageId}`;
  const chat = yield* selectChatAgentState.effect(agentId);
  if (
    chat.pendingQuestionRecovery?.messageId !== messageId ||
    chat.pendingQuestionRecovery.status !== 'loading' ||
    inFlight.has(key)
  ) {
    return;
  }
  const resident = yield* selectAgentMessageById.effect(agentId, messageId);
  if (resident) {
    const questions = markedQuestions(resident);
    yield* put(
      pendingQuestionRecoverySettled(
        agentId,
        messageId,
        questions.length > 0 ? 'found' : 'not-found',
        questions,
      ),
    );
    return;
  }

  inFlight.add(key);
  try {
    for (let attempt = 0; attempt <= MARKED_QUESTION_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const outcome: { page?: ConversationPage; stopped?: ObservedAction } = yield* race({
          page: call(
            [appClient.agents, appClient.agents.getConversation],
            agentId,
            MARKED_QUESTION_LIMIT,
            undefined,
            messageId,
          ),
          stopped: take((action: ObservedAction) =>
            stopsPendingQuestionRecovery(action, agentId, messageId),
          ),
        });
        if (outcome.stopped || !outcome.page) {
          yield* put(pendingQuestionRecoverySettled(agentId, messageId, 'cancelled'));
          return;
        }
        if (!(yield* pendingQuestionRecoveryIsCurrent(agentId, messageId))) {
          yield* put(pendingQuestionRecoverySettled(agentId, messageId, 'cancelled'));
          return;
        }
        const marked = outcome.page.messages.find((message) => message.id === messageId);
        if (!marked) {
          yield* put(pendingQuestionRecoverySettled(agentId, messageId, 'not-found'));
          return;
        }
        const questions = markedQuestions(marked);
        yield* put(
          pendingQuestionRecoverySettled(
            agentId,
            messageId,
            questions.length > 0 ? 'found' : 'not-found',
            questions,
          ),
        );
        return;
      } catch (error) {
        if (isInvalidParamsError(error)) {
          yield* put(pendingQuestionRecoverySettled(agentId, messageId, 'not-found'));
          return;
        }
        if (!(yield* pendingQuestionRecoveryIsCurrent(agentId, messageId))) {
          yield* put(pendingQuestionRecoverySettled(agentId, messageId, 'cancelled'));
          return;
        }
        const retryDelay = MARKED_QUESTION_RETRY_DELAYS_MS[attempt];
        if (retryDelay === undefined) {
          logger.error('Failed to recover marked pending question after bounded retries', {
            agentId,
            messageId,
            error,
          });
          yield* put(pendingQuestionRecoverySettled(agentId, messageId, 'error'));
          return;
        }
        logger.warn('Retrying marked pending question recovery', {
          agentId,
          messageId,
          attempt: attempt + 1,
          error,
        });
        const { stopped }: { stopped?: ObservedAction } = yield* race({
          elapsed: delay(retryDelay),
          stopped: take((action: ObservedAction) =>
            stopsPendingQuestionRecovery(action, agentId, messageId),
          ),
        });
        if (stopped || !(yield* pendingQuestionRecoveryIsCurrent(agentId, messageId))) {
          yield* put(pendingQuestionRecoverySettled(agentId, messageId, 'cancelled'));
          return;
        }
      }
    }
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Post-settle hygiene: when the history segment was cleared out from under
 * an in-flight fetch (session removal / `resumed: false` rehydration), the
 * just-persisted cursor was minted against the discarded segment — drop it
 * so a future walk re-seeks instead of continuing from a stale position.
 */
function* dropContinuationIfSegmentGone(agentId: string): SagaGenerator<void> {
  const history: AgentMessage[] = yield* selectAgentHistoryMessages.effect(agentId);
  if (history.length === 0) {
    yield* put(scrollbackContinuationReset(agentId));
  }
}

/** Segment gone (session removal / explicit clear) ⇒ drop continuation state. */
function* continuationResetWorker(
  action: ReturnType<typeof removeSession> | ReturnType<typeof clearHistorySegment>,
): SagaGenerator<void> {
  const [agentId] = action.payload;
  yield* put(scrollbackContinuationReset(agentId));
}

/**
 * §7.1 `resumed: false` fallback snapshot: the daemon declined the resume
 * anchor, so retained rows — the history segment included — are unanchored
 * and must be discarded (the tail is replaced by the subscribe saga). The
 * `clearHistorySegment` watcher above then resets the continuation state.
 */
function* snapshotResetWorker(
  action: ReturnType<typeof chatTranscriptSnapshotApplied>,
): SagaGenerator<void> {
  const [agentId, meta] = action.payload;
  if (meta.resumed !== false) return;
  yield* put(clearHistorySegment(agentId));
}

export function* chatScrollbackSaga(): SagaGenerator<void> {
  const pendingQuestionRecoveries = new Set<string>();
  try {
    yield* all([
      takeEvery(olderHistoryPageRequested, fetchOlderPageWorker),
      takeEvery(historyGapFillRequested, fetchGapFillWorker),
      takeEvery(historySeekRequested, historySeekWorker),
      takeEvery(
        pendingQuestionRecoveryRequested,
        recoverPendingQuestionWorker,
        pendingQuestionRecoveries,
      ),
      takeEvery(removeSession, continuationResetWorker),
      takeEvery(clearHistorySegment, continuationResetWorker),
      takeEvery(chatTranscriptSnapshotApplied, snapshotResetWorker),
    ]);
  } finally {
    pendingQuestionRecoveries.clear();
  }
}
