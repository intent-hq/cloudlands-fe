/**
 * Chat read saga — SINGLE-TRANSFER hydration. Opening a chat transfers the
 * conversation once: the standing `chat.subscribe` subscription's seq-0
 * snapshot (which already merges the in-flight assistant message, CS-0 D5) is
 * the SOLE hydration source. No `agent.getConversation` call happens on the
 * critical path — a direct read cannot carry the in-flight assistant message,
 * so settling from it would reveal a transcript missing the live turn (the
 * user-message-then-chunks flicker):
 *
 *  1. `transcriptHydrationStarted`, fetch the session shell (`agents.get`,
 *     counts only) and upsert it so the subscription's snapshot can apply.
 *  2. Wait (bounded) for the standing subscription's snapshot to apply —
 *     `chatTranscriptSnapshotApplied` is dispatched only after the snapshot's
 *     messages AND stream-accumulator seed have landed. A timed-out window
 *     re-requests the snapshot from the subscribe saga
 *     (`chatTranscriptSnapshotRerequested`, up to `SNAPSHOT_WAIT_ATTEMPTS`
 *     windows, intent-hq/monorepo#2692); only after every attempt times out
 *     does hydration fail (`transcriptHydrationFailed`) and the existing
 *     error/retry surface show — never a silent partial paint.
 *  3. Settle (`transcriptHydrationSettled`) — first paint gates on this.
 *  4. OFF the critical path: when older history exists beyond the snapshot
 *     window (`truncated`), page it in the background via the §5.5
 *     `aroundMessageId` seek anchored at the AUTHORITATIVE window's oldest
 *     row — the snapshot page's oldest (`TranscriptSnapshotMeta.
 *     oldestMessageId`) — NOT the store's
 *     oldest retained row: retained history can sit BELOW an interior gap
 *     (§7.1 `resumed: false` fallback), and anchoring
 *     below the gap would walk strictly older and never fill it. Walking
 *     backward from the window's oldest traverses the gap first and the
 *     nothing-new stop condition halts on already-retained pages. Merged
 *     with current-wins dedup; stops early when a page contributes nothing
 *     new or the store's 500-message prune cap is reached (fetching beyond
 *     it would be discarded anyway).
 */
import {
  actionChannel,
  all,
  call,
  delay,
  flush,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { INITIAL_RETRY_DELAY_MS, SNAPSHOT_TIMEOUT_MS } from '$lib/client/live/live-chat-client';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentMessage, AgentSession } from '$shared/types';
import { deduplicateAgentMessages } from '$shared/utils/message-dedup';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import {
  MAX_MESSAGES_PER_AGENT,
  bulkUpsertSessions,
  replaceMessages,
  upsertSession,
} from '../../agent-session/agent-session-slice';
import {
  selectAgentMessages,
  selectAgentSession,
} from '../../agent-session/agent-session-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  chatTranscriptSnapshotApplied,
  chatTranscriptSnapshotRerequested,
  initializeChatRequested,
  refreshChatTranscriptRequested,
  transcriptHydrationFailed,
  transcriptHydrationSettled,
  transcriptHydrationStarted,
} from '../chat-state-slice';
import { selectTranscriptHydration, selectTranscriptSnapshotMeta } from '../chat-state-selectors';

const logger = createLogger('ChatReadSaga');
const PAGE_LIMIT = 200;
/** Margin for the healed registration's fresh snapshot to arrive and apply. */
const SNAPSHOT_HEAL_MARGIN_MS = 2_000;
/**
 * Bounded wait for the standing subscription's seq-0 snapshot — the SOLE
 * hydration source. It normally applies within tens of milliseconds; the
 * bound only converts a broken subscription into the error/retry surface
 * instead of a permanent skeleton. Derived from LiveChatClient's own
 * constants so it stays strictly larger than one full self-heal cycle (seq-0
 * timeout + first retry delay + the fresh registration's snapshot RTT) and
 * the relationship cannot silently invert: a subscription the client heals
 * on its own settles in-window; a snapshot landing even later is caught by
 * the recovery watcher (`snapshotRecoveryWorker`).
 */
const SNAPSHOT_WAIT_MS = SNAPSHOT_TIMEOUT_MS + INITIAL_RETRY_DELAY_MS + SNAPSHOT_HEAL_MARGIN_MS;
/**
 * Bounded-wait attempts before hydration fails (intent-hq/monorepo#2692).
 * A timed-out window no longer fails the load outright: between attempts the
 * saga dispatches `chatTranscriptSnapshotRerequested`, which the subscribe
 * saga answers by replaying a held/last snapshot or force-cycling the
 * registration (fresh `chat.subscribe` → fresh seq-0 snapshot) — so a
 * dropped initial push heals without a manual retry. Only after every
 * attempt times out does hydration fail to the error/retry surface.
 *
 * Deliberate UX tradeoff: time-to-error for a genuinely dead subscription is
 * 3 × SNAPSHOT_WAIT_MS (~24s) instead of one window (~8s). The error surface
 * is the failure mode #2692 exists to avoid, so the extended ceiling buys the
 * second re-request's force-cycle a full window for its fresh seq-0 snapshot
 * to land; a truly dead subscription still reaches the retry surface.
 */
const SNAPSHOT_WAIT_ATTEMPTS = 3;

type ChatRequest = { wsId: string; agentId: string };
type HydrationTails = Map<string, Promise<void>>;
type HydrateResult = {
  started: boolean;
  succeeded: boolean;
  fetchOlder: boolean;
  /** Older-walk seek anchor: the authoritative window's oldest row id. */
  anchor?: string;
};

function identitySet(messages: AgentMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (typeof message.id === 'string') ids.add(message.id);
    if (typeof message.appMessageId === 'string') ids.add(message.appMessageId);
  }
  return ids;
}

function oldestMessageId(messages: AgentMessage[]): string | undefined {
  for (const message of messages) {
    if (typeof message.id === 'string' && message.id.length > 0) return message.id;
  }
  return undefined;
}

function* hydrateAfterPrevious(
  request: ChatRequest,
  previous: Promise<void>,
): SagaGenerator<HydrateResult> {
  yield* call(() => previous);
  return yield* call(hydrateChatTranscriptSaga, request);
}

function* hydrateChatTranscriptSaga(request: ChatRequest): SagaGenerator<HydrateResult> {
  const { wsId, agentId } = request;
  if (yield* call(isAgentDeletionPending, agentId)) {
    return { started: false, succeeded: false, fetchOlder: false };
  }
  let started = false;
  let succeeded = false;
  let fetchOlder = false;
  let anchor: string | undefined;
  try {
    yield* put(transcriptHydrationStarted(agentId));
    started = true;
    const session: AgentSession | null = yield* call(
      [appClient.agents, appClient.agents.get],
      agentId,
    );
    if (!session || String(session.workspaceId) !== wsId) {
      return { started, succeeded: true, fetchOlder };
    }
    // Skip rows carrying the daemon's delete-grace-window deadline (PROTOCOL
    // §5.5 `pendingDeleteAt`, v6.7+) — a deletion scheduled by another
    // window/client (or before an FE restart) is not in the local registry.
    if (session.pendingDeleteAt) return { started, succeeded: true, fetchOlder };
    if (yield* call(isAgentDeletionPending, agentId)) {
      return { started, succeeded: true, fetchOlder };
    }

    // Register/refresh the session shell WITHOUT touching the transcript:
    // the standing subscription's snapshot (applyTranscript) needs a stored
    // session to apply against, and its rows must never be clobbered by the
    // shell's empty message list.
    const preserved: AgentMessage[] = yield* selectAgentMessages.effect(agentId);
    const hydrated = { ...session, messages: preserved };
    yield* put(bulkUpsertSessions([hydrated]));
    yield* put(upsertSession(hydrated));

    // SOLE SOURCE: wait (bounded) for the standing subscription's seq-0
    // snapshot. `chatTranscriptSnapshotApplied` is dispatched by the
    // subscribe saga only AFTER the snapshot's messages replaced the store
    // rows and the stream accumulator was seeded from the in-flight
    // assistant message — so settling on it can never reveal a frame
    // missing the live turn. The channel is opened BEFORE the state read so
    // a dispatch landing between the two cannot be missed.
    const isSnapshotForAgent = (action: { type: string; payload?: unknown }) =>
      action.type === chatTranscriptSnapshotApplied.type &&
      Array.isArray(action.payload) &&
      action.payload[0] === agentId;
    const snapshotChannel = yield* actionChannel(isSnapshotForAgent);
    try {
      let meta = yield* selectTranscriptSnapshotMeta.effect(agentId);
      const visible: AgentMessage[] = yield* selectAgentMessages.effect(agentId);
      // Re-settle instantly only when the already-applied snapshot is still
      // reflected in the store (refresh with live meta); otherwise wait for
      // a fresh application.
      if (!(meta && (meta.totalMessages === 0 || visible.length > 0))) {
        meta = undefined;
        for (let attempt = 1; attempt <= SNAPSHOT_WAIT_ATTEMPTS && !meta; attempt += 1) {
          const { applied } = yield* race({
            applied: take(snapshotChannel),
            timedOut: delay(SNAPSHOT_WAIT_MS),
          });
          if (applied) {
            meta = yield* selectTranscriptSnapshotMeta.effect(agentId);
          }
          // Escalate on ANY non-final iteration that ends without valid meta
          // (window timed out, or an application raced a session reset and
          // left no recorded meta) so every window after the first opens with
          // a re-request in flight.
          if (!meta && attempt < SNAPSHOT_WAIT_ATTEMPTS) {
            logger.warn(
              `No transcript snapshot recorded within wait window (attempt ${attempt}/${SNAPSHOT_WAIT_ATTEMPTS}); re-requesting`,
            );
            yield* put(chatTranscriptSnapshotRerequested(wsId, agentId));
          }
        }
      }
      if (!meta) throw new Error('No transcript snapshot arrived within the hydration wait');
      succeeded = true;
      fetchOlder = meta.truncated === true;
      anchor = meta.oldestMessageId;
    } finally {
      yield* flush(snapshotChannel);
      snapshotChannel.close();
    }
  } catch (error) {
    logger.error('Failed to hydrate chat transcript', error);
  }
  return { started, succeeded, fetchOlder, anchor };
}

/**
 * Background older-history fetch (OFF the hydration critical path). Anchors a
 * §5.5 `aroundMessageId` seek at the AUTHORITATIVE window's oldest row (the
 * snapshot page's oldest — falling back to the store's
 * oldest when none was recorded), then walks `nextToken` backward,
 * accumulating rows the store does not hold. Anchoring at the window rather
 * than the store's oldest retained row matters when retained history sits
 * BELOW an interior gap (§7.1 `resumed: false` fallback): the backward walk
 * traverses the gap first, and the nothing-new stop
 * condition halts once it reaches already-retained pages. Each page merges
 * as `[...older, ...current]` with current-wins dedup so live rows that
 * arrived meanwhile are never clobbered. Stops when: no token remains, a
 * page contributes nothing new (already-present history), or the store's
 * prune cap is reached. Errors are swallowed — the snapshot window already
 * rendered.
 */
function* fetchOlderHistorySaga(request: ChatRequest, windowAnchor?: string): SagaGenerator<void> {
  const { agentId } = request;
  try {
    if (yield* call(isAgentDeletionPending, agentId)) return;
    const current: AgentMessage[] = yield* selectAgentMessages.effect(agentId);
    const anchor = windowAnchor ?? oldestMessageId(current);
    if (!anchor || current.length >= MAX_MESSAGES_PER_AGENT) return;

    const older: AgentMessage[] = [];
    const knownIds = identitySet(current);
    // Seek to the page CONTAINING the anchor: rows older than it are new
    // history; the anchor and newer rows are already in the store (dropped
    // by the knownIds filter below).
    let page: Awaited<ReturnType<typeof appClient.agents.getConversation>> = yield* call(
      [appClient.agents, appClient.agents.getConversation],
      agentId,
      PAGE_LIMIT,
      undefined,
      anchor,
    );
    for (;;) {
      const fresh = page.messages.filter(
        (message) =>
          !(typeof message.id === 'string' && knownIds.has(message.id)) &&
          !(typeof message.appMessageId === 'string' && knownIds.has(message.appMessageId)),
      );
      for (const message of fresh) {
        if (typeof message.id === 'string') knownIds.add(message.id);
        if (typeof message.appMessageId === 'string') knownIds.add(message.appMessageId);
      }
      older.unshift(...fresh);
      if (page.nextToken === null) break;
      // Nothing new on a non-seek page means this history is already present
      // (e.g. resume onto retained rows) — stop paging.
      if (fresh.length === 0 && older.length > 0) break;
      if (older.length + current.length >= MAX_MESSAGES_PER_AGENT) break;
      page = yield* call(
        [appClient.agents, appClient.agents.getConversation],
        agentId,
        PAGE_LIMIT,
        page.nextToken,
      );
    }
    if (older.length === 0) return;
    if (yield* call(isAgentDeletionPending, agentId)) return;

    // Merge against the store AT WRITE TIME (live rows may have landed since
    // the fetch began); current copies win identity in the dedup.
    const latest: AgentMessage[] = yield* selectAgentMessages.effect(agentId);
    const latestIds = identitySet(latest);
    const prepend = older.filter(
      (message) =>
        !(typeof message.id === 'string' && latestIds.has(message.id)) &&
        !(typeof message.appMessageId === 'string' && latestIds.has(message.appMessageId)),
    );
    if (prepend.length === 0) return;
    yield* put(replaceMessages(agentId, deduplicateAgentMessages([...prepend, ...latest])));
  } catch (error) {
    logger.error('Failed to fetch older chat history', error);
  }
}

function matchesChatCleanup({ wsId }: ChatRequest) {
  return (action: { type: string; payload?: unknown }) => {
    if (action.type !== workspaceUnmounted.type) return false;
    if (!Array.isArray(action.payload)) return false;
    return action.payload[0] === wsId;
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
    const { read } = yield* race({
      read: call(hydrateAfterPrevious, request, previous),
      cleanup: take(matchesChatCleanup(request)),
    });
    if (read?.started && hydrationTails.get(request.agentId) === tail) {
      // Settle FIRST — first paint gates on this; the older-history fetch
      // runs after, still inside the per-agent tail (serialized against a
      // follow-up hydration) and raced against cleanup.
      yield* put(
        read.succeeded
          ? transcriptHydrationSettled(request.agentId)
          : transcriptHydrationFailed(request.agentId),
      );
      if (read.succeeded && read.fetchOlder) {
        yield* race({
          fetch: call(fetchOlderHistorySaga, request, read.anchor),
          cleanup: take(matchesChatCleanup(request)),
        });
      }
    }
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

/**
 * Late-snapshot recovery: LiveChatClient self-heals a broken registration
 * (unsubscribe + re-register) on its own schedule, so a seq-0 snapshot can
 * apply AFTER the bounded wait already failed hydration and the worker
 * exited. When that happens, settle hydration off the applied snapshot —
 * the atomic-reveal invariant holds because `chatTranscriptSnapshotApplied`
 * is only ever dispatched after the messages landed and the stream
 * accumulator was seeded — and kick the background older-history walk the
 * failed worker never ran. No-op unless hydration sits in `error`.
 */
function* snapshotRecoveryWorker(action: ReturnType<typeof chatTranscriptSnapshotApplied>) {
  const [agentId, meta] = action.payload;
  const hydration = yield* selectTranscriptHydration.effect(agentId);
  if (hydration !== 'error') return;
  yield* put(transcriptHydrationSettled(agentId));
  if (meta.truncated !== true) return;
  const session = yield* selectAgentSession.effect(agentId);
  if (!session) return;
  const request: ChatRequest = { wsId: String(session.workspaceId), agentId };
  yield* race({
    fetch: call(fetchOlderHistorySaga, request, meta.oldestMessageId),
    cleanup: take(matchesChatCleanup(request)),
  });
}

export function* chatReadSaga() {
  const hydrationTails: HydrationTails = new Map();
  try {
    yield* all([
      takeEvery(initializeChatRequested, initializeChatWorker, hydrationTails),
      takeEvery(refreshChatTranscriptRequested, refreshChatWorker, hydrationTails),
      takeEvery(chatTranscriptSnapshotApplied, snapshotRecoveryWorker),
    ]);
  } finally {
    hydrationTails.clear();
  }
}
