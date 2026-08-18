/**
 * Chat subscribe saga — feeds the STANDING `chat.subscribe` transcript
 * (PROTOCOL §7.1) into the agent-session slice so ChatPanel renders from the
 * live-reconciled stream, sibling to `chat-read-saga.ts`.
 *
 * `chatSubscribeSaga()` observes the concrete subscription lifecycle actions:
 *  - `initializeChatRequested` opens one standing subscription for that agent
 *    (deduped per agent id; skipped while a soft-hidden deletion is pending).
 *  - `markAgentAsViewed` swaps subscriptions on agent switch: it closes every
 *    other agent's subscription and (re)opens the viewed agent's when its
 *    session exists — so switching chats never leaks registrations. The swap
 *    is realm-scoped (monorepo#1421): chief-workspace subscriptions (entry
 *    wsId / session workspaceId === CHIEF_WORKSPACE_ID) and ordinary
 *    workspace subscriptions never close each other, because the Chief panel
 *    is a standing sidebar surface that stays open — and must keep rendering
 *    live — while the user views workspace chats (and vice versa). Viewing a
 *    chief thread still closes other chief threads' subscriptions.
 *  - `transcriptHydrationSettled` re-applies the entry's last reconciled
 *    transcript: a slower chat-read hydrate whose pages predate a finalize
 *    would otherwise clobber the finalized row this stream already delivered
 *    (monorepo#1161).
 *  - `refreshChatTranscriptRequested` while hydration sits in `error` (the
 *    retry surface) replays what the registration holds — a deferred
 *    pre-session snapshot or the last reconciled snapshot — or force-cycles
 *    the registration for a fresh seq-0 snapshot, so a manual retry can heal
 *    a subscription that will never re-emit on its own.
 *  - `chatTranscriptSnapshotRerequested` is the same escalation gated on
 *    hydration `loading`: the chat-read saga's bounded wait timed out a
 *    window and re-requests the snapshot before failing the load
 *    (monorepo#2692).
 *  - `clearCurrentlyViewedAgent` (chat close / panel destroy) closes all
 *    non-chief subscriptions — but only when the clear actually applied (no
 *    agent remains viewed after the reducer). A background panel's trailing
 *    scoped clear is ignored by the reducer, so the viewed agent's
 *    subscription survives (monorepo#1215). A clear scoped to a
 *    chief-workspace agent instead closes exactly that subscription,
 *    regardless of which agent remains viewed: the swap exempts chief
 *    subscriptions, so the Chief panel's own destroy (collapse /
 *    thread-switch remount) is their only viewed-lifecycle teardown — and
 *    the chat area's viewed state says nothing about the chief panel.
 *  - `removeSession` (agent-deletion soft-hide), `workspaceDeleted`,
 *    `removeWorkspaceSessions`, and `clearAllSessions` tear down the affected
 *    subscriptions so a deleted agent's stream can never resurrect its state.
 *
 * Each emitted `ChatTranscript` (the seq-0 snapshot reduced with every block
 * delta by `ChatTranscriptReconciler`) is merged into the store via
 * `replaceMessages`: the transcript is canonical for every message it covers,
 * while store-only rows absent from it — the optimistic user row not yet
 * echoed by the daemon, and older paged history beyond the snapshot's newest
 * page — are preserved. `deduplicateAgentMessages` collapses the optimistic
 * user row against the incoming canonical copy by `appMessageId` (PROTOCOL
 * §5.5 `userAppMessageId` lift), so an optimistic send produces exactly one
 * user row with the canonical identity, no flicker.
 *
 * Streaming flags are reconciled from `transcript.isStreaming` (the §7.1
 * snapshot activity-flag overlay / synthetic in-flight message, and the delta
 * stream's terminal `streamingComplete` frame): a rising edge sets
 * isStreaming/isProcessing, a falling edge clears all three responding flags.
 * An authoritative idle snapshot also clears retained flags after reconnect or
 * HMR, except for one snapshot that races a locally observed `chatSendStarted`.
 *
 * CANONICAL-WRITER INVARIANT: the standing subscription is the CANONICAL
 * writer of an agent's transcript MESSAGE state. The `agent:tool:call`
 * firehose path co-writes tool-status previews onto the in-flight assistant
 * message, but its updates are merged by block identity
 * (`mergeStreamContentBlocks`, monorepo#2814) so they can never delete
 * subscription-owned blocks — the next subscription emit remains the
 * authoritative arbiter. The initial hydration (`chat-read-saga`) writes only
 * the persisted history.
 *
 * The root-owned saga takes each lifecycle action after reducers have applied
 * it, preserving the former post-action state-read semantics.
 */
import { buffers, channel as createChannel, type Channel, type Task } from 'redux-saga';
import {
  actionChannel,
  call,
  cancel,
  delay,
  fork,
  put,
  race,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { ChatLiveStreamPhase, ChatTranscript } from '$lib/client/app-client';
import type { AgentMessage, AgentSession } from '$shared/types';
import { appClient } from '$lib/client';
import { INITIAL_RETRY_DELAY_MS, SNAPSHOT_TIMEOUT_MS } from '$lib/client/live/live-chat-client';
import {
  chatLiveStreamPhaseChanged,
  chatSendStarted,
  chatSwitchBackRevealTimedOut,
  chatTranscriptSnapshotApplied,
  chatTranscriptSnapshotRerequested,
  chatUtilityFooterReady,
  initializeChatRequested,
  refreshChatTranscriptRequested,
  transcriptHydrationSettled,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  selectAwaitingSwitchBackSnapshot,
  selectAwaitingUtilityFooter,
  selectTranscriptHydration,
} from '$store/renderer/slices/chat-state/chat-state-selectors';
import {
  setSubscriptionSnapshot,
  subscriptionSnapshotFetchFailed,
} from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import { selectSubscriptionSnapshotFetched } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-selectors';
import {
  backgroundHooksCleared,
  backgroundHooksUpdated,
} from '$store/renderer/slices/background-hooks/background-hooks-slice';
import { selectBackgroundHooksSnapshotDelivered } from '$store/renderer/slices/background-hooks/background-hooks-selectors';
import { prMonitorsUpdated } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
import { selectPrMonitorsSnapshotDelivered } from '$store/renderer/slices/pr-monitor/pr-monitor-selectors';
import { isUtilityFooterReady } from '$lib/components/chat/chat-panel-visibility';
import {
  bulkUpsertSessions,
  clearAllSessions,
  removeSession,
  removeWorkspaceSessions,
  replaceMessages,
  updateSession,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearCurrentlyViewedAgent,
  markAgentAsViewed,
} from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
import { deduplicateAgentMessages } from '$shared/utils/message-dedup';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { createLogger } from '$lib/utils/client-logger';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import { seedStreamFromSnapshot } from '$features/events/daemon-events-bridge.client';
import {
  selectAgentMessages,
  selectAgentSession,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
import { selectCurrentlyViewedAgentId } from '$store/renderer/slices/unread-tracking/unread-tracking-selectors';

const logger = createLogger('ChatSubscribeSaga');

interface SubscriptionEntry {
  acquisition: SubscriptionAcquisition;
  token: object;
  /** Workspace the chat was opened under (for removeWorkspaceSessions teardown). */
  wsId?: string;
  /** True once the reconciler has emitted (seq-0 snapshot applied). */
  hasEmitted: boolean;
  /** Last emitted transcript.isStreaming, for edge-triggered flag writes. */
  wasStreaming: boolean;
  /** Last reconciled transcript, re-applied on transcriptHydrationSettled. */
  lastTranscript?: ChatTranscript;
  /**
   * A seq-0 snapshot that arrived BEFORE the session shell existed (the
   * chat-read saga's `agents.get` was still pending), held back so its meta
   * is never recorded without its messages; replayed on the shell's upsert.
   */
  pendingSnapshot?: ChatTranscript;
}

type ChatSubscriptionEvent =
  | { kind: 'transcript'; agentId: string; token: object; transcript: ChatTranscript }
  | { kind: 'phase'; agentId: string; token: object; phase: ChatLiveStreamPhase };

type MaybePromise<T> = T | Promise<T>;
type AsyncUnsubscribe = () => MaybePromise<void>;

interface SubscriptionAcquisition {
  wait: () => MaybePromise<AsyncUnsubscribe | undefined>;
  cancelPending: () => void;
  dispose: () => MaybePromise<void>;
}

interface TransitionCompletion {
  promise: Promise<void>;
  resolve: () => void;
  settled: boolean;
}

type AgentTransition =
  | {
      kind: 'open';
      token: object;
      wsId?: string;
      waitFor?: TransitionCompletion[];
      completion: TransitionCompletion;
    }
  | { kind: 'close'; clearResumeAnchor?: boolean; completion: TransitionCompletion }
  | { kind: 'hydration-settled'; completion: TransitionCompletion };

interface AgentTransitionSlot {
  channel: Channel<AgentTransition>;
  pendingCount: number;
  desiredToken?: object;
  wsId?: string;
  acquisition?: SubscriptionAcquisition;
}

interface SubscriptionCoordinator {
  subscriptions: Map<string, SubscriptionEntry>;
  slots: Map<string, AgentTransitionSlot>;
  events: Channel<ChatSubscriptionEvent>;
  /** Agents whose next idle snapshot may predate a locally-started turn. */
  locallyStartedTurns: Set<string>;
  /** One bounded reveal-gate watcher per agent (see revealGateWatcher). */
  revealGateWatchers: Map<string, Task>;
}

function createCompletion(): TransitionCompletion {
  let settlePromise: (value: void | PromiseLike<void>) => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    settlePromise = settle;
  });
  const completion: TransitionCompletion = {
    promise,
    settled: false,
    resolve: () => {
      if (completion.settled) return;
      completion.settled = true;
      settlePromise(undefined);
    },
  };
  return completion;
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function createSubscriptionAcquisition(
  agentId: string,
  onTranscript: (transcript: ChatTranscript) => void,
  onPhase: (phase: ChatLiveStreamPhase) => void,
  options?: { sinceMessageId: string },
): SubscriptionAcquisition {
  let unsubscribe: AsyncUnsubscribe | undefined;
  let disposeRequested = false;
  let disposed = false;
  let disposal: MaybePromise<void> | undefined;

  const disposeResolved = (): MaybePromise<void> => {
    if (disposed || !unsubscribe) return disposal;
    disposed = true;
    try {
      const result = unsubscribe();
      disposal = isPromiseLike<void>(result)
        ? Promise.resolve(result).catch((error) => {
            logger.error('Failed to close chat subscription', error);
          })
        : undefined;
    } catch (error) {
      logger.error('Failed to close chat subscription', error);
    }
    return disposal;
  };

  const subscribe = appClient.chat.subscribe as unknown as (
    agentId: string,
    handler: (transcript: ChatTranscript) => void,
    onPhase: (phase: ChatLiveStreamPhase) => void,
    options?: { sinceMessageId: string },
  ) => MaybePromise<AsyncUnsubscribe>;
  const raw = options
    ? subscribe(agentId, onTranscript, onPhase, options)
    : subscribe(agentId, onTranscript, onPhase);

  if (!isPromiseLike<AsyncUnsubscribe>(raw)) {
    unsubscribe = raw;
    return {
      wait: () => (disposeRequested ? undefined : unsubscribe),
      cancelPending: () => undefined,
      dispose: () => {
        disposeRequested = true;
        return disposeResolved();
      },
    };
  }

  const pending = Promise.resolve(raw).then((acquired) => {
    unsubscribe = acquired;
    if (!disposeRequested) return acquired;
    return Promise.resolve(disposeResolved()).then(() => undefined);
  });

  return {
    wait: () => pending,
    cancelPending: () => {
      disposeRequested = true;
      void pending.catch((error) => {
        logger.error('Failed to open chat subscription', error);
      });
    },
    dispose: () => {
      disposeRequested = true;
      return unsubscribe
        ? disposeResolved()
        : pending.then(
            () => undefined,
            () => undefined,
          );
    },
  };
}

function isCurrentSubscription(
  coordinator: SubscriptionCoordinator,
  agentId: string,
  entry: SubscriptionEntry,
): boolean {
  return (
    coordinator.subscriptions.get(agentId) === entry &&
    coordinator.slots.get(agentId)?.desiredToken === entry.token
  );
}

/**
 * Merge one emitted transcript into the agent-session slice. The transcript
 * is canonical for every message it covers; store-only rows absent from it
 * (by id AND appMessageId) are preserved — optimistic user rows the daemon
 * has not echoed yet, plus older full-history pages beyond the snapshot's
 * newest page. Ordering `[...storeOnly, ...transcript]` lets the transcript
 * copy win identity in the appMessageId merge (canonical row replaces the
 * optimistic one). No-op while the session has not hydrated yet — the next
 * delta emit retries against the hydrated session.
 *
 * `discardStoreOnly` (§7.1 `resumed: false` fallback snapshot only): the
 * daemon declined the resume anchor, so retained rows are unanchored — they
 * may be stale and can sit below an interior gap toward the served window.
 * The protocol mandates discarding the cached transcript and rehydrating
 * from this snapshot as if freshly subscribed; a not-yet-echoed optimistic
 * row is dropped with them and reappears on its daemon echo.
 */
function* applyTranscript(
  coordinator: SubscriptionCoordinator,
  agentId: string,
  entry: SubscriptionEntry,
  transcript: ChatTranscript,
  discardStoreOnly = false,
): SagaGenerator<void> {
  const session = yield* selectAgentSession.effect(agentId);
  if (!isCurrentSubscription(coordinator, agentId, entry)) return;
  if (session) {
    const transcriptIds = new Set<string>();
    for (const message of transcript.messages) {
      if (typeof message.id === 'string') transcriptIds.add(message.id);
      if (typeof message.appMessageId === 'string') transcriptIds.add(message.appMessageId);
    }
    const storeOnly = discardStoreOnly
      ? []
      : (session.messages ?? []).filter(
          (message) =>
            !(typeof message.id === 'string' && transcriptIds.has(message.id)) &&
            !(typeof message.appMessageId === 'string' && transcriptIds.has(message.appMessageId)),
        );
    const merged =
      storeOnly.length === 0
        ? transcript.messages
        : deduplicateAgentMessages([...storeOnly, ...transcript.messages]);
    if (isCurrentSubscription(coordinator, agentId, entry)) {
      yield* put(replaceMessages(agentId, merged));
    }
  }

  // Consume the streaming edge only when the dispatch actually lands — a
  // pre-hydration emit must not swallow the transition, so the next emit
  // against the hydrated session still sees the edge and dispatches it.
  const streamingChanged = transcript.isStreaming !== entry.wasStreaming;
  const authoritativeIdleSnapshot =
    transcript.fromSnapshot === true && transcript.isStreaming === false;
  const protectsLocalStart = session
    ? authoritativeIdleSnapshot && coordinator.locallyStartedTurns.delete(agentId)
    : false;
  if (session && transcript.isStreaming) coordinator.locallyStartedTurns.delete(agentId);
  const shouldReconcileStreaming =
    streamingChanged || (authoritativeIdleSnapshot && !protectsLocalStart);
  if (session && shouldReconcileStreaming && isCurrentSubscription(coordinator, agentId, entry)) {
    entry.wasStreaming = transcript.isStreaming;
    yield* put(
      updateSession(
        agentId,
        transcript.isStreaming
          ? { isStreaming: true, isProcessing: true }
          : { isStreaming: false, isProcessing: false, isResponding: false },
      ),
    );
  }
}

/**
 * Clear stale message-level streaming flags left behind when a standing
 * subscription closes mid-turn. Message content is untouched; a re-view's
 * seq-0 snapshot re-canonicalizes the same message id.
 */
function* clearStaleStreamingMessageFlags(agentId: string): SagaGenerator<void> {
  const session = yield* selectAgentSession.effect(agentId);
  const messages = session?.messages;
  if (!messages?.length) return;
  const hasStale = messages.some(
    (message) => message.isStreaming === true || message.streamingComplete === false,
  );
  if (!hasStale) return;
  const normalized = messages.map((message) =>
    message.isStreaming === true || message.streamingComplete === false
      ? { ...message, isStreaming: false, streamingComplete: true }
      : message,
  );
  yield* put(replaceMessages(agentId, normalized));
}

function* handleSubscriptionEvent(
  coordinator: SubscriptionCoordinator,
  event: ChatSubscriptionEvent,
): SagaGenerator<void> {
  const entry = coordinator.subscriptions.get(event.agentId);
  if (!entry || entry.token !== event.token) return;
  if (!isCurrentSubscription(coordinator, event.agentId, entry)) return;
  try {
    if (event.kind === 'phase') {
      if (isCurrentSubscription(coordinator, event.agentId, entry)) {
        yield* put(chatLiveStreamPhaseChanged(event.agentId, event.phase));
      }
      return;
    }
    if (yield* call(isAgentDeletionPending, event.agentId)) return;
    if (!isCurrentSubscription(coordinator, event.agentId, entry)) return;
    entry.hasEmitted = true;
    entry.lastTranscript = event.transcript;
    // Pre-session seq-0 race: `initializeChatRequested` starts this saga and
    // the chat-read saga concurrently, so the snapshot can arrive while
    // `agents.get` is still pending. Applying it now would record snapshot
    // meta the store's rows don't back (applyTranscript no-ops without a
    // session), stranding the read saga waiting on a second snapshot a
    // healthy subscription never emits. Defer the WHOLE application until
    // the session shell upserts (replayed by the lifecycle loop), so meta is
    // only ever recorded after the messages actually landed.
    if (event.transcript.fromSnapshot === true) {
      const preSession = yield* selectAgentSession.effect(event.agentId);
      if (!preSession) {
        entry.pendingSnapshot = event.transcript;
        return;
      }
      entry.pendingSnapshot = undefined;
    }
    // §7.1 `resumed: false` snapshot: the retained transcript MUST be
    // discarded (see applyTranscript). Snapshot emits only — the settled
    // re-apply of the same transcript must not wipe the background
    // older-history pages fetched after it.
    const discardStoreOnly =
      event.transcript.fromSnapshot === true && event.transcript.resumed === false;
    yield* applyTranscript(coordinator, event.agentId, entry, event.transcript, discardStoreOnly);
    // Seq-0 snapshot applied (single-transfer hydration): seed the firehose
    // stream accumulator with the snapshot's in-flight assistant message so
    // subsequent agent:stream:chunk dispatches carry the full block prefix,
    // then record the snapshot metadata for the chat-read saga (it settles
    // hydration on it and anchors the background older-history fetch).
    if (event.transcript.fromSnapshot === true) {
      const session = yield* selectAgentSession.effect(event.agentId);
      const wsId = entry.wsId ?? session?.workspaceId;
      const inFlight = event.transcript.messages.find(
        (message) => message.role === 'assistant' && message.isStreaming === true,
      );
      if (inFlight && wsId) {
        yield* call(seedStreamFromSnapshot, event.agentId, inFlight, wsId);
      }
      const oldest = event.transcript.messages.find(
        (message) => typeof message.id === 'string' && message.id.length > 0,
      );
      yield* put(
        chatTranscriptSnapshotApplied(event.agentId, {
          truncated: event.transcript.truncated,
          totalMessages: event.transcript.totalMessages,
          ...(oldest ? { oldestMessageId: oldest.id } : {}),
          ...(event.transcript.resumed === undefined ? {} : { resumed: event.transcript.resumed }),
        }),
      );
      // §7.1 resume fallback: the daemon did not honor the requested
      // `sinceMessageId` (unknown/pruned anchor) and served the standard
      // newest page instead — the retained older history may be stale, so
      // trigger a full rehydration through the chat-read saga.
      if (event.transcript.resumed === false && wsId) {
        yield* put(refreshChatTranscriptRequested(wsId, event.agentId));
      }
    }
  } catch (error) {
    logger.error('Failed to process chat subscription event', error);
  }
}

/**
 * Resume anchors captured at subscription close (§7.1 `sinceMessageId`),
 * keyed by agentId. Captured BEFORE `clearStaleStreamingMessageFlags`
 * normalizes the store rows: after normalization a formerly-partial
 * assistant row is indistinguishable from a complete one, and anchoring past
 * a partial row would freeze its stale content (the resumed delta snapshot
 * carries only messages AFTER the anchor). `""` records "close happened but
 * nothing was anchorable" (every row still streaming) so the reopen falls
 * back to the full snapshot instead of scanning the normalized rows.
 * Transient saga-lifecycle state (like pending-agent-deletions), never
 * Redux; dropped on session teardown and root-saga cancel.
 */
const resumeAnchors = new Map<string, string>();

/** The newest fully-persisted message id, or undefined when none exists. */
function newestPersistedMessageId(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.isStreaming === true || message.streamingComplete === false) continue;
    if (typeof message.id === 'string' && message.id.length > 0) return message.id;
  }
  return undefined;
}

/**
 * Resume anchor for a (re)opened subscription (§7.1 `sinceMessageId`), or
 * `undefined` when the standard full snapshot is wanted. `undefined` until
 * the transcript has hydrated (first open). A close-captured anchor wins
 * when its row is still in the transcript; a captured `""` (nothing was
 * anchorable at close) forces the full snapshot. Otherwise — no close
 * happened, or the transcript was replaced since — the current rows carry
 * accurate streaming flags, so the newest fully-persisted id is scanned
 * directly. A client-minted optimistic row the daemon does not know simply
 * resolves as `resumed: false` (full-rehydration fallback) — safe either way.
 */
function* resolveResumeAnchor(agentId: string): SagaGenerator<string | undefined> {
  const hydration = yield* selectTranscriptHydration.effect(agentId);
  if (hydration !== 'settled') return undefined;
  const messages = yield* selectAgentMessages.effect(agentId);
  const captured = resumeAnchors.get(agentId);
  if (captured === '') return undefined;
  if (captured !== undefined && messages.some((message) => message.id === captured)) {
    return captured;
  }
  return newestPersistedMessageId(messages);
}

function* openSubscription(
  coordinator: SubscriptionCoordinator,
  slot: AgentTransitionSlot,
  agentId: string,
  transition: Extract<AgentTransition, { kind: 'open' }>,
): SagaGenerator<void> {
  const pendingBarriers = transition.waitFor?.filter((completion) => !completion.settled);
  if (pendingBarriers?.length) {
    yield* call(() => Promise.all(pendingBarriers.map(({ promise }) => promise)));
  }
  if (slot.desiredToken !== transition.token) return;
  if (yield* call(isAgentDeletionPending, agentId)) {
    if (slot.desiredToken === transition.token) {
      slot.desiredToken = undefined;
      slot.wsId = undefined;
    }
    return;
  }

  const pending: ChatSubscriptionEvent[] = [];
  let ready = false;
  const emit = (event: ChatSubscriptionEvent) => {
    if (slot.desiredToken !== transition.token) return;
    if (ready) coordinator.events.put(event);
    else pending.push(event);
  };

  let acquisition: SubscriptionAcquisition | undefined;
  let installed = false;
  try {
    const sinceMessageId = yield* resolveResumeAnchor(agentId);
    acquisition = yield* call(
      createSubscriptionAcquisition,
      agentId,
      (transcript: ChatTranscript) =>
        emit({ kind: 'transcript', agentId, token: transition.token, transcript }),
      (phase: ChatLiveStreamPhase) =>
        emit({ kind: 'phase', agentId, token: transition.token, phase }),
      sinceMessageId === undefined ? undefined : { sinceMessageId },
    );
    slot.acquisition = acquisition;
    const unsubscribe = yield* call(acquisition.wait);
    if (!unsubscribe || slot.desiredToken !== transition.token) return;

    coordinator.subscriptions.set(agentId, {
      acquisition,
      token: transition.token,
      wsId: transition.wsId,
      hasEmitted: false,
      wasStreaming: false,
    });
    installed = true;
    ready = true;
    for (const event of pending) coordinator.events.put(event);
  } catch (error) {
    logger.error('Failed to open chat subscription', error);
  } finally {
    if (!installed && acquisition) {
      void acquisition.dispose();
      if (slot.acquisition === acquisition) slot.acquisition = undefined;
    }
    if (!installed && slot.desiredToken === transition.token) {
      slot.desiredToken = undefined;
      slot.wsId = undefined;
    }
  }
}

function* closeSubscription(
  coordinator: SubscriptionCoordinator,
  slot: AgentTransitionSlot,
  agentId: string,
  clearResumeAnchor = false,
): SagaGenerator<void> {
  // A renderer-level detach retires the ordering window that could make the
  // next idle snapshot predate a locally-started turn. If the terminal edge is
  // missed while detached, the next registration's seq-0 snapshot must be
  // authoritative. Transport reconnects do not call this function and keep
  // their in-registration exemption intact.
  coordinator.locallyStartedTurns.delete(agentId);
  if (clearResumeAnchor) resumeAnchors.delete(agentId);
  const entry = coordinator.subscriptions.get(agentId);
  if (!entry) {
    // A close can land while the subscription is still being acquired (the
    // enqueued open was cancelled before install): there are no store rows
    // to normalize, but the teardown phase reset must still land — state
    // gated on an open/opening subscription (the switch-back reveal gate)
    // would otherwise stay set with no subscription left to satisfy it.
    try {
      yield* put(chatLiveStreamPhaseChanged(agentId, null));
    } catch (error) {
      logger.error('Failed to reset live stream phase', error);
    }
    return;
  }
  coordinator.subscriptions.delete(agentId);
  yield* call(entry.acquisition.dispose);
  if (slot.acquisition === entry.acquisition) slot.acquisition = undefined;
  try {
    // Capture the resume anchor BEFORE the streaming flags are normalized
    // below — afterwards a partial row can no longer be told apart.
    if (!clearResumeAnchor) {
      const messages = (yield* selectAgentSession.effect(agentId))?.messages ?? [];
      resumeAnchors.set(agentId, newestPersistedMessageId(messages) ?? '');
    }
  } catch (error) {
    logger.error('Failed to capture chat resume anchor', error);
  }
  try {
    yield* put(chatLiveStreamPhaseChanged(agentId, null));
  } catch (error) {
    logger.error('Failed to reset live stream phase', error);
  }
  try {
    yield* clearStaleStreamingMessageFlags(agentId);
  } catch (error) {
    logger.error('Failed to clear stale streaming message flags', error);
  }
}

/**
 * True when the agent belongs to the chief virtual workspace, per its
 * subscription entry's wsId or (before a subscription exists) its stored
 * session's workspaceId.
 */
function* isChiefChatAgent(
  coordinator: SubscriptionCoordinator,
  agentId: string,
): SagaGenerator<boolean> {
  const workspaceId =
    coordinator.slots.get(agentId)?.wsId ?? coordinator.subscriptions.get(agentId)?.wsId;
  if (workspaceId !== undefined) return workspaceId === CHIEF_WORKSPACE_ID;
  const session = yield* selectAgentSession.effect(agentId);
  return session?.workspaceId === CHIEF_WORKSPACE_ID;
}

function* applyHydrationSettled(
  coordinator: SubscriptionCoordinator,
  agentId: string,
): SagaGenerator<void> {
  const entry = coordinator.subscriptions.get(agentId);
  if (entry?.hasEmitted && entry.lastTranscript) {
    yield* applyTranscript(coordinator, agentId, entry, entry.lastTranscript);
  }
}

function canRetireSlot(
  coordinator: SubscriptionCoordinator,
  agentId: string,
  slot: AgentTransitionSlot,
): boolean {
  return (
    slot.pendingCount === 0 &&
    !slot.desiredToken &&
    !slot.acquisition &&
    !coordinator.subscriptions.has(agentId)
  );
}

function* runAgentTransitions(
  coordinator: SubscriptionCoordinator,
  agentId: string,
  slot: AgentTransitionSlot,
): SagaGenerator<void> {
  try {
    while (true) {
      const transition = yield* take(slot.channel);
      slot.pendingCount -= 1;
      try {
        if (transition.kind === 'open') {
          yield* openSubscription(coordinator, slot, agentId, transition);
        } else if (transition.kind === 'close') {
          yield* closeSubscription(coordinator, slot, agentId, transition.clearResumeAnchor);
          if (!slot.desiredToken) slot.wsId = undefined;
        } else {
          yield* applyHydrationSettled(coordinator, agentId);
        }
      } catch (error) {
        logger.error('chat-subscribe saga action failed', error);
      } finally {
        transition.completion.resolve();
      }

      if (canRetireSlot(coordinator, agentId, slot)) {
        if (coordinator.slots.get(agentId) === slot) coordinator.slots.delete(agentId);
        slot.channel.close();
        return;
      }
    }
  } finally {
    slot.channel.close();
    slot.acquisition?.dispose();
  }
}

function* ensureSlot(
  coordinator: SubscriptionCoordinator,
  agentId: string,
): SagaGenerator<AgentTransitionSlot> {
  const existing = coordinator.slots.get(agentId);
  if (existing) return existing;
  const slot: AgentTransitionSlot = {
    channel: createChannel(buffers.expanding<AgentTransition>()),
    pendingCount: 0,
  };
  coordinator.slots.set(agentId, slot);
  yield* fork(runAgentTransitions, coordinator, agentId, slot);
  return slot;
}

function enqueue(slot: AgentTransitionSlot, transition: AgentTransition): TransitionCompletion {
  slot.pendingCount += 1;
  slot.channel.put(transition);
  return transition.completion;
}

function resolvedCompletion(): TransitionCompletion {
  const completion = createCompletion();
  completion.resolve();
  return completion;
}

function* enqueueOpen(
  coordinator: SubscriptionCoordinator,
  agentId: string,
  wsId?: string,
  waitFor?: TransitionCompletion[],
): SagaGenerator<TransitionCompletion> {
  const slot = yield* ensureSlot(coordinator, agentId);
  if (slot.desiredToken) return resolvedCompletion();
  const token = {};
  slot.desiredToken = token;
  slot.wsId = wsId;
  const completion = createCompletion();
  return enqueue(slot, { kind: 'open', token, wsId, waitFor, completion });
}

function enqueueClose(
  coordinator: SubscriptionCoordinator,
  agentId: string,
  clearResumeAnchor = false,
): TransitionCompletion {
  const slot = coordinator.slots.get(agentId);
  if (!slot) {
    if (clearResumeAnchor) resumeAnchors.delete(agentId);
    return resolvedCompletion();
  }
  slot.desiredToken = undefined;
  slot.acquisition?.cancelPending();
  const completion = createCompletion();
  return enqueue(slot, { kind: 'close', clearResumeAnchor, completion });
}

function enqueueHydrationSettled(
  coordinator: SubscriptionCoordinator,
  agentId: string,
): TransitionCompletion {
  const slot = coordinator.slots.get(agentId);
  if (!slot) return resolvedCompletion();
  const completion = createCompletion();
  return enqueue(slot, { kind: 'hydration-settled', completion });
}

function closeMatchingSlots(
  coordinator: SubscriptionCoordinator,
  predicate: (agentId: string, slot: AgentTransitionSlot) => boolean,
  clearResumeAnchor = false,
): TransitionCompletion[] {
  const completions: TransitionCompletion[] = [];
  for (const [agentId, slot] of [...coordinator.slots.entries()]) {
    if (predicate(agentId, slot)) {
      completions.push(enqueueClose(coordinator, agentId, clearResumeAnchor));
    }
  }
  return completions;
}

/**
 * Bounded fallback for the switch-back transcript reveal gate. Margin for the
 * healed registration's fresh snapshot to arrive and apply (mirrors the
 * chat-read saga's SNAPSHOT_HEAL_MARGIN_MS derivation).
 */
const SWITCH_BACK_REVEAL_MARGIN_MS = 2_000;
/**
 * Bounded wait for the switch-back reveal gate (armed by the
 * `markAgentAsViewed` reducer case): if the reopening subscription's seq-0
 * snapshot has not applied within this window, the gate clears and the
 * retained transcript shows (today's behavior) rather than an indefinite
 * skeleton. Derived from LiveChatClient's own constants — the same family as
 * the chat-read saga's SNAPSHOT_WAIT_MS — so it stays strictly larger than
 * one full self-heal cycle (seq-0 timeout + first retry delay + the fresh
 * registration's snapshot RTT) and a subscription the client heals on its
 * own reveals with the fresh snapshot, not the fallback.
 */
export const SWITCH_BACK_REVEAL_WAIT_MS =
  SNAPSHOT_TIMEOUT_MS + INITIAL_RETRY_DELAY_MS + SWITCH_BACK_REVEAL_MARGIN_MS;

/**
 * Composed utility-footer readiness for one (workspace, agent): the agent's
 * `agent.getSubscriptions` read plus the workspace's `hook.list` and
 * `prMonitor.list` seeds have all settled (success or failure both latch —
 * a failed read renders the same as empty). The chief virtual workspace is
 * EXEMPT (always ready): its footer seeds come only from the two
 * active-workspace watchers keyed on `currentTabId`, and the Chief panel is
 * a standing surface outside the tab strip — the seeds would never arrive
 * ahead of the card mount, so gating a chief thread on them could only ever
 * resolve via the bounded fallback (a full-length skeleton on every open).
 * Chief threads keep the pre-gate behavior: reveal on transcript readiness,
 * with the footer populating from the card's own mount-time fetches. The
 * same short-circuit is deliberately NOT applied to ordinary non-active-tab
 * workspaces (multi-panel layouts): their entries seed on tab activation and
 * are retained (pr-monitors) or re-seeded by the card mount (hooks), so the
 * gate still converges without the fallback in the common case.
 */
function* isFooterReadyForReveal(wsId: string, agentId: string): SagaGenerator<boolean> {
  if (wsId === CHIEF_WORKSPACE_ID) return true;
  const subscriptionSnapshotFetched = yield* selectSubscriptionSnapshotFetched.effect(
    wsId,
    agentId,
  );
  const backgroundHooksSnapshotDelivered =
    yield* selectBackgroundHooksSnapshotDelivered.effect(wsId);
  const prMonitorsSnapshotDelivered = yield* selectPrMonitorsSnapshotDelivered.effect(wsId);
  return isUtilityFooterReady({
    subscriptionSnapshotFetched,
    backgroundHooksSnapshotDelivered,
    prMonitorsSnapshotDelivered,
  });
}

/**
 * Saga-owned watcher for the armed transcript reveal gates (the switch-back
 * snapshot gate and/or the utility-footer gate — both first open and
 * switch-back share it). One bounded timer per agent: it clears the footer
 * gate (`chatUtilityFooterReady`) the moment the footer data sources are all
 * settled, exits once every gate is clear (snapshot applied / subscription
 * closed already clear their gates in the reducer), and on timeout with any
 * gate STILL armed dispatches the fallback clear — the transcript reveals
 * without the footer (today's behavior) rather than an indefinite skeleton.
 * `startRevealGateWatcher` cancels a superseded watcher before forking a
 * fresh one, so exactly one runs per agent instead of duplicates racing; the
 * reducer additionally no-ops a stale timeout dispatch, so a superseded
 * watcher can never re-clear a re-armed gate.
 */
function* revealGateWatcher(agentId: string, wsId: string): SagaGenerator<void> {
  const mayChangeGates = (action: { type: string; payload?: unknown }): boolean => {
    switch (action.type) {
      case chatTranscriptSnapshotApplied.type:
      case chatLiveStreamPhaseChanged.type:
      case chatSwitchBackRevealTimedOut.type:
      case chatUtilityFooterReady.type:
        return Array.isArray(action.payload) && action.payload[0] === agentId;
      case setSubscriptionSnapshot.type: {
        const payload = action.payload as { workspaceId?: string; agentId?: string } | undefined;
        return payload?.workspaceId === wsId && payload?.agentId === agentId;
      }
      case subscriptionSnapshotFetchFailed.type:
        return (
          Array.isArray(action.payload) &&
          action.payload[0] === wsId &&
          action.payload[1] === agentId
        );
      case backgroundHooksUpdated.type:
      case backgroundHooksCleared.type:
      case prMonitorsUpdated.type:
        return Array.isArray(action.payload) && action.payload[0] === wsId;
      default:
        return false;
    }
  };
  function* gatesSettled(): SagaGenerator<void> {
    while (true) {
      if (
        (yield* selectAwaitingUtilityFooter.effect(agentId)) &&
        (yield* isFooterReadyForReveal(wsId, agentId))
      ) {
        yield* put(chatUtilityFooterReady(agentId));
      }
      const snapshotArmed = yield* selectAwaitingSwitchBackSnapshot.effect(agentId);
      const footerArmed = yield* selectAwaitingUtilityFooter.effect(agentId);
      if (!snapshotArmed && !footerArmed) return;
      yield* take(mayChangeGates);
    }
  }
  const { timedOut } = yield* race({
    settled: call(gatesSettled),
    timedOut: delay(SWITCH_BACK_REVEAL_WAIT_MS),
  });
  if (
    timedOut &&
    ((yield* selectAwaitingSwitchBackSnapshot.effect(agentId)) ||
      (yield* selectAwaitingUtilityFooter.effect(agentId)))
  ) {
    yield* put(chatSwitchBackRevealTimedOut(agentId));
  }
}

/** Fork the per-agent reveal-gate watcher, superseding any previous one. */
function* startRevealGateWatcher(
  coordinator: SubscriptionCoordinator,
  agentId: string,
): SagaGenerator<void> {
  const wsId =
    coordinator.slots.get(agentId)?.wsId ??
    coordinator.subscriptions.get(agentId)?.wsId ??
    (yield* selectAgentSession.effect(agentId))?.workspaceId;
  if (!wsId) {
    // No workspace to watch footer readiness for — fail OPEN (clear both
    // gates immediately) rather than leaving an armed gate with no watcher.
    yield* put(chatSwitchBackRevealTimedOut(agentId));
    return;
  }
  const existing = coordinator.revealGateWatchers.get(agentId);
  if (existing?.isRunning()) yield* cancel(existing);
  const task = yield* fork(function* runWatcher(): SagaGenerator<void> {
    try {
      yield* call(revealGateWatcher, agentId, wsId);
    } finally {
      // Self-prune on completion (settled, timed out, or cancelled) so the
      // map holds only live watchers; a superseded watcher's cancellation
      // runs before the fresh task is stored, so the identity check keeps
      // it from deleting its successor.
      if (coordinator.revealGateWatchers.get(agentId) === task) {
        coordinator.revealGateWatchers.delete(agentId);
      }
    }
  });
  coordinator.revealGateWatchers.set(agentId, task);
}

/**
 * The viewed-agent swap is global within its realm: all related closes settle
 * before the newly viewed agent opens. Chief and ordinary workspace realms
 * remain independent because their standing surfaces intentionally coexist.
 */
function* handleViewed(coordinator: SubscriptionCoordinator, agentId: string): SagaGenerator<void> {
  const viewedIsChief = yield* isChiefChatAgent(coordinator, agentId);
  const closes = closeMatchingSlots(
    coordinator,
    (otherId, slot) => otherId !== agentId && (slot.wsId === CHIEF_WORKSPACE_ID) === viewedIsChief,
  );
  const session = yield* selectAgentSession.effect(agentId);
  if (session) {
    yield* enqueueOpen(
      coordinator,
      agentId,
      session.workspaceId,
      closes.length > 0 ? closes : undefined,
    );
  }
}

/**
 * Replay a deferred pre-session seq-0 snapshot now that the agent's session
 * exists in the store. Re-enqueued through the events channel so it runs
 * through the same entry/token/deletion guards as a live emit. When newer
 * delta emits landed while the snapshot was held back (they no-op without a
 * session too), the latest one is replayed after it so the store ends on the
 * newest reconciled transcript.
 */
function replayPendingSnapshot(coordinator: SubscriptionCoordinator, agentId: string): void {
  const entry = coordinator.subscriptions.get(agentId);
  const pending = entry?.pendingSnapshot;
  if (!entry || !pending) return;
  entry.pendingSnapshot = undefined;
  // Capture BEFORE putting: a waiting taker consumes the put synchronously,
  // and processing the replayed snapshot resets entry.lastTranscript to it.
  const newerDelta =
    entry.lastTranscript && entry.lastTranscript !== pending ? entry.lastTranscript : undefined;
  coordinator.events.put({ kind: 'transcript', agentId, token: entry.token, transcript: pending });
  if (newerDelta) {
    coordinator.events.put({
      kind: 'transcript',
      agentId,
      token: entry.token,
      transcript: newerDelta,
    });
  }
}

/**
 * Manual retry / forced rehydration support: the error surface's retry
 * dispatches `refreshChatTranscriptRequested`, which the chat-read saga
 * answers by re-entering its bounded snapshot wait — but that wait alone
 * cannot heal a subscription that will never (re-)emit: a dead registration,
 * or a healthy one whose only snapshot was consumed while it could not
 * apply. When hydration sits in `error`, give the wait something to settle
 * on: replay a deferred pre-session snapshot if one is held; re-emit the
 * entry's last reconciled snapshot if one applied (meta exists but the store
 * rows were lost); otherwise force a resnapshot by closing and reopening the
 * registration (fresh `chat.subscribe` → fresh seq-0 snapshot). Strictly a
 * no-op outside the error state, so the §7.1 `resumed: false` rehydration —
 * which dispatches this same action right after its snapshot applied — never
 * cycles the registration it just opened (and a re-emitted `resumed: false`
 * snapshot cannot re-trigger itself).
 */
function* handleTranscriptRefresh(
  coordinator: SubscriptionCoordinator,
  agentId: string,
  wsId: string,
): SagaGenerator<void> {
  const hydration = yield* selectTranscriptHydration.effect(agentId);
  if (hydration !== 'error') return;
  yield* emitOrCycleSnapshot(coordinator, agentId, wsId);
}

/**
 * Mid-hydration snapshot re-request (intent-hq/monorepo#2692): the chat-read
 * saga's bounded seq-0 wait timed out a window while hydration still sits in
 * `loading` — before failing the load it asks for something to settle on.
 * Same escalation as the manual retry, but gated on `loading` so a stale
 * dispatch (hydration already settled or failed by delivery time) is a
 * strict no-op and never cycles a healthy registration.
 */
function* handleSnapshotRerequest(
  coordinator: SubscriptionCoordinator,
  agentId: string,
  wsId: string,
): SagaGenerator<void> {
  const hydration = yield* selectTranscriptHydration.effect(agentId);
  if (hydration !== 'loading') return;
  yield* emitOrCycleSnapshot(coordinator, agentId, wsId);
}

/** Shared escalation: replay held → re-emit last snapshot → force-cycle. */
function* emitOrCycleSnapshot(
  coordinator: SubscriptionCoordinator,
  agentId: string,
  wsId: string,
): SagaGenerator<void> {
  const entry = coordinator.subscriptions.get(agentId);
  if (entry?.pendingSnapshot) {
    replayPendingSnapshot(coordinator, agentId);
    return;
  }
  if (entry?.lastTranscript?.fromSnapshot === true) {
    coordinator.events.put({
      kind: 'transcript',
      agentId,
      token: entry.token,
      transcript: entry.lastTranscript,
    });
    return;
  }
  const close = enqueueClose(coordinator, agentId);
  yield* enqueueOpen(coordinator, agentId, wsId, [close]);
}

type ChatSubscribeAction =
  | ReturnType<typeof initializeChatRequested>
  | ReturnType<typeof chatSendStarted>
  | ReturnType<typeof markAgentAsViewed>
  | ReturnType<typeof transcriptHydrationSettled>
  | ReturnType<typeof refreshChatTranscriptRequested>
  | ReturnType<typeof chatTranscriptSnapshotRerequested>
  | ReturnType<typeof clearCurrentlyViewedAgent>
  | ReturnType<typeof upsertSession>
  | ReturnType<typeof bulkUpsertSessions>
  | ReturnType<typeof removeSession>
  | ReturnType<typeof removeWorkspaceSessions>
  | ReturnType<typeof workspaceDeleted>
  | ReturnType<typeof clearAllSessions>;

function* routeLifecycleAction(
  coordinator: SubscriptionCoordinator,
  action: ChatSubscribeAction,
): SagaGenerator<void> {
  if (action.type === initializeChatRequested.type) {
    const { agentId, wsId } = action.payload as ReturnType<
      typeof initializeChatRequested
    >['payload'];
    if (agentId) yield* enqueueOpen(coordinator, agentId, wsId);
  } else if (action.type === chatSendStarted.type) {
    const { agentId } = action.payload as ReturnType<typeof chatSendStarted>['payload'];
    if (coordinator.slots.has(agentId)) coordinator.locallyStartedTurns.add(agentId);
  } else if (action.type === markAgentAsViewed.type) {
    const [agentId] = action.payload as ReturnType<typeof markAgentAsViewed>['payload'];
    // The reducer armed the switch-back reveal gates synchronously with this
    // action (when the transcript hydrated before and no current-subscription
    // snapshot exists); own their bounded fallback here so a snapshot or
    // footer seed that never arrives cannot leave an indefinite skeleton.
    if (
      (yield* selectAwaitingSwitchBackSnapshot.effect(agentId)) ||
      (yield* selectAwaitingUtilityFooter.effect(agentId))
    ) {
      yield* startRevealGateWatcher(coordinator, agentId);
    }
    yield* handleViewed(coordinator, agentId);
  } else if (action.type === transcriptHydrationSettled.type) {
    const [agentId] = action.payload as ReturnType<typeof transcriptHydrationSettled>['payload'];
    // The FIRST settle armed the utility-footer reveal gate (same-paint
    // reveal of transcript + footer on first open); own its bounded wait
    // unless a switch-back watcher already runs for this agent.
    if (
      (yield* selectAwaitingUtilityFooter.effect(agentId)) &&
      !coordinator.revealGateWatchers.get(agentId)?.isRunning()
    ) {
      yield* startRevealGateWatcher(coordinator, agentId);
    }
    enqueueHydrationSettled(coordinator, agentId);
  } else if (action.type === refreshChatTranscriptRequested.type) {
    const [wsId, agentId] = action.payload as ReturnType<
      typeof refreshChatTranscriptRequested
    >['payload'];
    yield* handleTranscriptRefresh(coordinator, agentId, wsId);
  } else if (action.type === chatTranscriptSnapshotRerequested.type) {
    const [wsId, agentId] = action.payload as ReturnType<
      typeof chatTranscriptSnapshotRerequested
    >['payload'];
    yield* handleSnapshotRerequest(coordinator, agentId, wsId);
  } else if (action.type === clearCurrentlyViewedAgent.type) {
    const [scopeAgentId] = action.payload as ReturnType<
      typeof clearCurrentlyViewedAgent
    >['payload'];
    if (scopeAgentId && (yield* isChiefChatAgent(coordinator, scopeAgentId))) {
      enqueueClose(coordinator, scopeAgentId);
    } else if ((yield* selectCurrentlyViewedAgentId.effect()) === null) {
      closeMatchingSlots(coordinator, (_agentId, slot) => slot.wsId !== CHIEF_WORKSPACE_ID);
    }
  } else if (action.type === upsertSession.type) {
    const [session] = action.payload as [AgentSession];
    replayPendingSnapshot(coordinator, session.id);
  } else if (action.type === bulkUpsertSessions.type) {
    const [sessions] = action.payload as [AgentSession[]];
    for (const session of sessions) replayPendingSnapshot(coordinator, session.id);
  } else if (action.type === removeSession.type) {
    const [agentId] = action.payload as ReturnType<typeof removeSession>['payload'];
    enqueueClose(coordinator, agentId, true);
  } else if (action.type === removeWorkspaceSessions.type) {
    const [wsId] = action.payload as ReturnType<typeof removeWorkspaceSessions>['payload'];
    closeMatchingSlots(coordinator, (_agentId, slot) => slot.wsId === wsId, true);
  } else if (action.type === workspaceDeleted.type) {
    const [wsId, agentIds] = action.payload as ReturnType<typeof workspaceDeleted>['payload'];
    for (const agentId of agentIds) resumeAnchors.delete(agentId);
    closeMatchingSlots(
      coordinator,
      (agentId, slot) => slot.wsId === wsId || agentIds.includes(agentId),
      true,
    );
  } else {
    closeMatchingSlots(coordinator, () => true, true);
  }
}

function* watchSubscriptionEvents(coordinator: SubscriptionCoordinator): SagaGenerator<void> {
  while (true) {
    const event = yield* take(coordinator.events);
    yield* handleSubscriptionEvent(coordinator, event);
  }
}

function disposeCoordinator(coordinator: SubscriptionCoordinator): string[] {
  const agentIds = [...coordinator.subscriptions.keys()];
  coordinator.events.close();
  for (const slot of coordinator.slots.values()) {
    slot.desiredToken = undefined;
    slot.channel.close();
    slot.acquisition?.dispose();
  }
  for (const entry of coordinator.subscriptions.values()) entry.acquisition.dispose();
  coordinator.subscriptions.clear();
  coordinator.slots.clear();
  // Watcher tasks are forked children of the root saga — cancellation
  // retires them; only the bookkeeping map needs clearing.
  coordinator.revealGateWatchers.clear();
  return agentIds;
}

/** Root-owned standing chat subscription lifecycle. */
export function* chatSubscribeSaga(): SagaGenerator<void> {
  const coordinator: SubscriptionCoordinator = {
    subscriptions: new Map(),
    slots: new Map(),
    events: createChannel(buffers.expanding<ChatSubscriptionEvent>()),
    locallyStartedTurns: new Set(),
    revealGateWatchers: new Map(),
  };
  const lifecycleActions = yield* actionChannel(
    [
      initializeChatRequested,
      chatSendStarted,
      markAgentAsViewed,
      transcriptHydrationSettled,
      refreshChatTranscriptRequested,
      chatTranscriptSnapshotRerequested,
      clearCurrentlyViewedAgent,
      upsertSession,
      bulkUpsertSessions,
      removeSession,
      removeWorkspaceSessions,
      workspaceDeleted,
      clearAllSessions,
    ],
    buffers.expanding<ChatSubscribeAction>(),
  );
  yield* fork(watchSubscriptionEvents, coordinator);
  try {
    while (true) {
      const action = (yield* take(lifecycleActions)) as ChatSubscribeAction;
      try {
        yield* routeLifecycleAction(coordinator, action);
      } catch (error) {
        logger.error('chat-subscribe saga action failed', error);
      }
    }
  } finally {
    lifecycleActions.close();
    const agentIds = disposeCoordinator(coordinator);
    for (const agentId of agentIds) {
      yield* put(chatLiveStreamPhaseChanged(agentId, null));
      yield* clearStaleStreamingMessageFlags(agentId);
    }
    resumeAnchors.clear();
    coordinator.locallyStartedTurns.clear();
  }
}
