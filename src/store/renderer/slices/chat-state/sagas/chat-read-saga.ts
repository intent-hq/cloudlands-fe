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
 *
 * Older history beyond the snapshot window is NOT fetched here: the infinite
 * scrollback saga (`chat-scrollback-saga`) pages it in on demand as the user
 * scrolls toward the top.
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
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import { isAgentNotFoundError } from '$features/agent/utils/agent-not-found-error';
import { readAgentSession } from '$features/agent/agent-read-service';
import {
  hasChatSubscriptionAcquisitionInFlight,
  hasReplayableChatSnapshot,
  hasStandingChatSubscription,
} from '$features/agent/utils/chat-subscription-registry';
import {
  acquireChatInterestLease,
  releaseChatInterestLease,
} from '$features/agent/utils/chat-interest-leases';
import { bulkUpsertSessions, upsertSession } from '../../agent-session/agent-session-slice';
import { selectAgentMessages } from '../../agent-session/agent-session-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { cleanupDeletedAgentTabs } from '../../workspace-agents/sagas/deleted-agent-cleanup';
import {
  chatReset,
  chatTranscriptSnapshotApplied,
  chatTranscriptSnapshotRerequested,
  initializeChatRequested,
  messageBlockHydrated,
  messageBlockHydrationFailed,
  messageBlockHydrationRequested,
  refreshChatTranscriptRequested,
  transcriptHydrationFailed,
  transcriptHydrationSettled,
  transcriptHydrationStarted,
} from '../chat-state-slice';
import {
  selectHydratedBlock,
  selectTranscriptHydration,
  selectTranscriptSnapshotMeta,
} from '../chat-state-selectors';

const logger = createLogger('ChatReadSaga');
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

/** Unique interest-lease holder id per hydration attempt (monorepo#3295). */
let hydrationLeaseSeq = 0;

type ChatRequest = { wsId: string; agentId: string };
type HydrationTails = Map<string, Promise<void>>;
type HydrateResult = {
  started: boolean;
  succeeded: boolean;
};

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
    return { started: false, succeeded: false };
  }
  let started = false;
  let succeeded = false;
  // Interest lease (intent-hq/monorepo#3295): held for the duration of this
  // hydration attempt — acquired before the bounded snapshot wait so a sweep
  // cannot close the standing registration the wait depends on, released in
  // the finally (which also runs on saga cancellation).
  hydrationLeaseSeq += 1;
  const leaseHolder = `chat-read:${hydrationLeaseSeq}`;
  yield* call(acquireChatInterestLease, agentId, leaseHolder);
  try {
    yield* put(transcriptHydrationStarted(agentId));
    started = true;
    const session: AgentSession | null = yield* call(readAgentSession, agentId);
    if (!session || String(session.workspaceId) !== wsId) {
      return { started, succeeded: true };
    }
    // Skip rows carrying the daemon's delete-grace-window deadline (PROTOCOL
    // §5.5 `pendingDeleteAt`, v6.7+) — a deletion scheduled by another
    // window/client (or before an FE restart) is not in the local registry.
    if (session.pendingDeleteAt) return { started, succeeded: true };
    if (yield* call(isAgentDeletionPending, agentId)) {
      return { started, succeeded: true };
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
        // Fast path (intent-hq/monorepo#2864 defense-in-depth): the standing
        // subscription already holds a replayable snapshot (deferred
        // pre-session snapshot, or its last reconciled transcript IS a
        // snapshot) yet no valid meta backs this hydration — its seq-0 emit
        // was consumed before this hydration attached (e.g. a teardown reset
        // dropped the meta) and no new emit is coming. Escalate NOW instead
        // of stranding the first bounded wait window: the re-request replays
        // the held snapshot without touching the wire.
        //
        // Dead-wait fast path (intent-hq/monorepo#3295): this window opened
        // with NEITHER a standing registration NOR an acquisition in flight
        // for the agent — a dedup-consumed open or an already-swept slot, so
        // no seq-0 emit is coming at all. Escalate NOW too: the re-request
        // force-cycles a fresh registration instead of stranding ~8s.
        //
        // A cold open (no replayable snapshot, but an acquisition IS in
        // flight) keeps the plain wait — its seq-0 emit is still coming and
        // force-cycling it would only churn a healthy opening subscription.
        const replayable = yield* call(hasReplayableChatSnapshot, agentId);
        const deadWait =
          !(yield* call(hasStandingChatSubscription, agentId)) &&
          !(yield* call(hasChatSubscriptionAcquisitionInFlight, agentId));
        if (replayable || deadWait) {
          yield* put(chatTranscriptSnapshotRerequested(wsId, agentId));
        }
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
              `No transcript snapshot recorded within wait window (attempt ${attempt}/${SNAPSHOT_WAIT_ATTEMPTS}) for agent ${agentId} in workspace ${wsId}; re-requesting`,
            );
            yield* put(chatTranscriptSnapshotRerequested(wsId, agentId));
          }
        }
      }
      if (!meta) throw new Error('No transcript snapshot arrived within the hydration wait');
      succeeded = true;
    } finally {
      yield* flush(snapshotChannel);
      snapshotChannel.close();
    }
  } catch (error) {
    if (isAgentNotFoundError(error)) {
      // The daemon no longer knows this agent — a restored layout carrying a
      // tab for a deleted agent (monorepo#1753). Expected condition, not a
      // hydration failure: WARN + close the referencing tabs (shared cleanup)
      // and short-circuit with `started: false` so the worker dispatches
      // neither settled nor failed — no error/retry surface for a tab that is
      // being closed. Unlike the deletion-pending early return above,
      // `transcriptHydrationStarted` HAS already been dispatched here, so
      // reset the chat-state entry — otherwise the deleted agent's marker
      // would sit at 'loading' forever (a leak today, a retry-less permanent
      // skeleton if a chat surface ever mounts outside an agent panel tab).
      // The interest lease still releases via the finally.
      yield* call(cleanupDeletedAgentTabs, wsId, agentId);
      yield* put(chatReset(agentId));
      return { started: false, succeeded: false };
    }
    logger.error(
      `Failed to hydrate chat transcript for agent ${agentId} in workspace ${wsId}`,
      error,
    );
  } finally {
    yield* call(releaseChatInterestLease, agentId, leaseHolder);
  }
  return { started, succeeded };
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
      yield* put(
        read.succeeded
          ? transcriptHydrationSettled(request.agentId)
          : transcriptHydrationFailed(request.agentId),
      );
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
 * accumulator was seeded. No-op unless hydration sits in `error`.
 */
function* snapshotRecoveryWorker(action: ReturnType<typeof chatTranscriptSnapshotApplied>) {
  const [agentId] = action.payload;
  const hydration = yield* selectTranscriptHydration.effect(agentId);
  if (hydration !== 'error') return;
  yield* put(transcriptHydrationSettled(agentId));
}

/**
 * Lazy block hydration (§5.5 slim projection → v7.2 `agent.getMessageBlock`):
 * fetch one FULL content block on demand when the user expands a truncated
 * tool row or views a truncated image. Single-flight per block, twice over:
 * the `messageBlockHydrationRequested` reducer parks `loading` under the
 * block's key (so a non-`loading` entry here means loaded/absent — nothing to
 * fetch), and `inFlightBlocks` (saga-local, non-serializable) drops the
 * duplicate workers takeEvery still spawns for re-dispatches that arrive
 * while the state already reads `loading`.
 */
function* hydrateMessageBlockWorker(
  inFlightBlocks: Set<string>,
  action: ReturnType<typeof messageBlockHydrationRequested>,
) {
  const [agentId, messageId, blockId] = action.payload;
  if (!agentId || !messageId || !blockId) return;
  const key = `${agentId}|${messageId}|${blockId}`;
  if (inFlightBlocks.has(key)) return;
  const entry = yield* selectHydratedBlock.effect(agentId, messageId, blockId);
  if (entry?.status !== 'loading') return;
  inFlightBlocks.add(key);
  try {
    const block = yield* call(
      [appClient.agents, appClient.agents.getMessageBlock],
      agentId,
      messageId,
      blockId,
    );
    yield* put(messageBlockHydrated(agentId, messageId, blockId, block));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('message block hydration failed', { agentId, messageId, blockId, message });
    yield* put(messageBlockHydrationFailed(agentId, messageId, blockId, message));
  } finally {
    inFlightBlocks.delete(key);
  }
}

export function* chatReadSaga() {
  const hydrationTails: HydrationTails = new Map();
  const inFlightBlocks = new Set<string>();
  try {
    yield* all([
      takeEvery(initializeChatRequested, initializeChatWorker, hydrationTails),
      takeEvery(refreshChatTranscriptRequested, refreshChatWorker, hydrationTails),
      takeEvery(chatTranscriptSnapshotApplied, snapshotRecoveryWorker),
      takeEvery(messageBlockHydrationRequested, hydrateMessageBlockWorker, inFlightBlocks),
    ]);
  } finally {
    hydrationTails.clear();
    inFlightBlocks.clear();
  }
}
