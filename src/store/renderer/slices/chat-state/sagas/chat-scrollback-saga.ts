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
import { all, call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentMessage } from '$shared/types';
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
  selectAgentMessages,
  selectHistorySegmentMeta,
} from '../../agent-session/agent-session-selectors';
import {
  chatTranscriptSnapshotApplied,
  historyGapFillRequested,
  historySeekRequested,
  olderHistoryPageRequested,
  scrollbackContinuationReset,
  scrollbackFetchStarted,
  scrollbackGapPageSettled,
  scrollbackOlderPageSettled,
  scrollbackSeekSettled,
} from '../chat-state-slice';
import { selectChatAgentState } from '../chat-state-selectors';

const logger = createLogger('ChatScrollbackSaga');
const PAGE_LIMIT = 200;

type ConversationPage = Awaited<ReturnType<typeof appClient.agents.getConversation>>;

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
 * the `aroundIndex` param it does not know.
 */
function isInvalidParamsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { rpcCode?: unknown; code?: unknown };
  return candidate.rpcCode === -32602 || candidate.code === 'INVALID_PARAMS';
}

/**
 * Estimate the conversation ordinal of a seek landing page's FIRST row,
 * mirroring the daemon's `page_window_around`: half the page budget goes to
 * rows older than the (clamped) target, clamped at either edge so the page
 * stays full. An estimate only — boundaries stay exact via `oldestReached`
 * (`nextToken === null` ⇒ start is 0) and the tail-overlap gap close.
 */
function estimateSeekLandingStart(
  targetOrdinal: number,
  pageRows: number,
  totalMessages: number,
): number {
  if (totalMessages <= 0) return 0;
  const target = Math.min(totalMessages - 1, Math.max(0, Math.floor(targetOrdinal)));
  const start = target - Math.floor(pageRows / 2);
  return Math.min(Math.max(0, totalMessages - pageRows), Math.max(0, start));
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
          estimateSeekLandingStart(target, page.messages.length, page.totalMessages),
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
  yield* all([
    takeEvery(olderHistoryPageRequested, fetchOlderPageWorker),
    takeEvery(historyGapFillRequested, fetchGapFillWorker),
    takeEvery(historySeekRequested, historySeekWorker),
    takeEvery(removeSession, continuationResetWorker),
    takeEvery(clearHistorySegment, continuationResetWorker),
    takeEvery(chatTranscriptSnapshotApplied, snapshotResetWorker),
  ]);
}
