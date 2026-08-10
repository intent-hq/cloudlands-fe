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
 * Streaming flags are edge-triggered from `transcript.isStreaming` (the §7.1
 * snapshot activity-flag overlay / synthetic in-flight message, and the delta
 * stream's terminal `streamingComplete` frame): a rising edge sets
 * isStreaming/isProcessing, a falling edge clears all three responding flags.
 * First-emit `false` deliberately writes nothing so a subscription racing a
 * just-started optimistic turn (`chatSendStarted`) cannot clobber "Thinking".
 *
 * SOLE-WRITER INVARIANT: the standing subscription is the sole writer of an
 * agent's transcript MESSAGE state — the firehose events carry no content
 * (the daemon events bridge dispatches content-free chat-state bookkeeping
 * only), and the initial hydration (`chat-read-saga`) writes only the
 * persisted history.
 *
 * The root-owned saga takes each lifecycle action after reducers have applied
 * it, preserving the former post-action state-read semantics.
 */
import { buffers, channel as createChannel, type Channel } from 'redux-saga';
import {
  call,
  join,
  put,
  takeEvery,
  takeLatest,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { ChatLiveStreamPhase, ChatTranscript } from '$lib/client/app-client';
import type { AgentMessage } from '$shared/types';
import { appClient } from '$lib/client';
import {
  chatLiveStreamPhaseChanged,
  chatTranscriptSnapshotApplied,
  initializeChatRequested,
  refreshChatTranscriptRequested,
  transcriptHydrationSettled,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { selectTranscriptHydration } from '$store/renderer/slices/chat-state/chat-state-selectors';
import {
  clearAllSessions,
  removeSession,
  removeWorkspaceSessions,
  replaceMessages,
  updateSession,
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
import { takeLatestInContext, takeLeadingByAgent } from '../../../utils/context-saga-effects';

const logger = createLogger('ChatSubscribeSaga');

interface SubscriptionEntry {
  unsubscribe: () => void;
  token: object;
  /** Workspace the chat was opened under (for removeWorkspaceSessions teardown). */
  wsId?: string;
  /** True once the reconciler has emitted (seq-0 snapshot applied). */
  hasEmitted: boolean;
  /** Last emitted transcript.isStreaming, for edge-triggered flag writes. */
  wasStreaming: boolean;
  /** Last reconciled transcript, re-applied on transcriptHydrationSettled. */
  lastTranscript?: ChatTranscript;
}

type ChatSubscriptionEvent =
  | { kind: 'transcript'; agentId: string; token: object; transcript: ChatTranscript }
  | { kind: 'phase'; agentId: string; token: object; phase: ChatLiveStreamPhase };

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
  agentId: string,
  entry: SubscriptionEntry,
  transcript: ChatTranscript,
  discardStoreOnly = false,
): SagaGenerator<void> {
  const session = yield* selectAgentSession.effect(agentId);
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
    yield* put(replaceMessages(agentId, merged));
  }

  // Consume the streaming edge only when the dispatch actually lands — a
  // pre-hydration emit must not swallow the transition, so the next emit
  // against the hydrated session still sees the edge and dispatches it.
  const streamingChanged = transcript.isStreaming !== entry.wasStreaming;
  if (session && streamingChanged) {
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
  subscriptions: Map<string, SubscriptionEntry>,
  event: ChatSubscriptionEvent,
): SagaGenerator<void> {
  const entry = subscriptions.get(event.agentId);
  if (!entry || entry.token !== event.token) return;
  try {
    if (event.kind === 'phase') {
      yield* put(chatLiveStreamPhaseChanged(event.agentId, event.phase));
      return;
    }
    if (yield* call(isAgentDeletionPending, event.agentId)) return;
    entry.hasEmitted = true;
    entry.lastTranscript = event.transcript;
    // §7.1 `resumed: false` snapshot: the retained transcript MUST be
    // discarded (see applyTranscript). Snapshot emits only — the settled
    // re-apply of the same transcript must not wipe the background
    // older-history pages fetched after it.
    const discardStoreOnly =
      event.transcript.fromSnapshot === true && event.transcript.resumed === false;
    yield* applyTranscript(event.agentId, entry, event.transcript, discardStoreOnly);
    // Seq-0 snapshot applied (single-transfer hydration): seed the firehose
    // stream accumulator with the snapshot's in-flight assistant message so
    // subsequent agent:stream:chunk events pass the regression guard, then
    // record the snapshot metadata for the chat-read saga (it settles
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
  subscriptions: Map<string, SubscriptionEntry>,
  events: Channel<ChatSubscriptionEvent>,
  agentId: string,
  wsId?: string,
): SagaGenerator<void> {
  if (subscriptions.has(agentId)) return;
  if (yield* call(isAgentDeletionPending, agentId)) return;
  const token = {};
  const pending: ChatSubscriptionEvent[] = [];
  let ready = false;
  const emit = (event: ChatSubscriptionEvent) => {
    if (ready) events.put(event);
    else pending.push(event);
  };
  try {
    const sinceMessageId = yield* resolveResumeAnchor(agentId);
    const unsubscribe = yield* call(
      [appClient.chat, appClient.chat.subscribe],
      agentId,
      (transcript: ChatTranscript) => emit({ kind: 'transcript', agentId, token, transcript }),
      (phase: ChatLiveStreamPhase) => emit({ kind: 'phase', agentId, token, phase }),
      sinceMessageId === undefined ? undefined : { sinceMessageId },
    );
    subscriptions.set(agentId, {
      unsubscribe,
      token,
      wsId,
      hasEmitted: false,
      wasStreaming: false,
    });
    ready = true;
    for (const event of pending) events.put(event);
  } catch (error) {
    logger.error('Failed to open chat subscription', error);
  }
}

function* closeSubscription(
  subscriptions: Map<string, SubscriptionEntry>,
  agentId: string,
): SagaGenerator<void> {
  const entry = subscriptions.get(agentId);
  if (!entry) return;
  subscriptions.delete(agentId);
  try {
    yield* call(entry.unsubscribe);
  } catch (error) {
    logger.error('Failed to close chat subscription', error);
  }
  try {
    // Capture the resume anchor BEFORE the streaming flags are normalized
    // below — afterwards a partial row can no longer be told apart.
    const messages = (yield* selectAgentSession.effect(agentId))?.messages ?? [];
    resumeAnchors.set(agentId, newestPersistedMessageId(messages) ?? '');
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

function* closeAllSubscriptions(
  subscriptions: Map<string, SubscriptionEntry>,
): SagaGenerator<void> {
  for (const agentId of [...subscriptions.keys()]) {
    yield* closeSubscription(subscriptions, agentId);
  }
}

function* closeWorkspaceSubscriptions(
  subscriptions: Map<string, SubscriptionEntry>,
  wsId: string,
): SagaGenerator<void> {
  for (const [agentId, entry] of [...subscriptions.entries()]) {
    if (entry.wsId === wsId) {
      yield* closeSubscription(subscriptions, agentId);
      // Workspace-scoped teardown removes the sessions too — a captured
      // anchor must not resume a future unrelated stream.
      resumeAnchors.delete(agentId);
    }
  }
}

/**
 * True when the agent belongs to the chief virtual workspace, per its
 * subscription entry's wsId or (before a subscription exists) its stored
 * session's workspaceId.
 */
function* isChiefChatAgent(
  subscriptions: Map<string, SubscriptionEntry>,
  agentId: string,
): SagaGenerator<boolean> {
  const workspaceId = subscriptions.get(agentId)?.wsId;
  if (workspaceId !== undefined) return workspaceId === CHIEF_WORKSPACE_ID;
  const session = yield* selectAgentSession.effect(agentId);
  return session?.workspaceId === CHIEF_WORKSPACE_ID;
}

/**
 * Close every subscription except the given agent's (agent-switch swap).
 * Realm-scoped (monorepo#1421): chief-workspace and ordinary workspace
 * subscriptions never close each other — the Chief panel stays open (and
 * must keep rendering live) while workspace chats are viewed, and vice
 * versa. Viewing a chief thread still closes other chief threads'.
 */
function* closeOtherSubscriptions(
  subscriptions: Map<string, SubscriptionEntry>,
  agentId: string,
): SagaGenerator<void> {
  const viewedIsChief = yield* isChiefChatAgent(subscriptions, agentId);
  for (const [otherId, entry] of [...subscriptions.entries()]) {
    if (otherId === agentId) continue;
    if ((entry.wsId === CHIEF_WORKSPACE_ID) !== viewedIsChief) continue;
    yield* closeSubscription(subscriptions, otherId);
  }
}

/**
 * Close every non-chief subscription (chat close — the chief panel's
 * lifecycle is independent of the chat area's viewed state).
 */
function* closeNonChiefSubscriptions(
  subscriptions: Map<string, SubscriptionEntry>,
): SagaGenerator<void> {
  for (const [agentId, entry] of [...subscriptions.entries()]) {
    if (entry.wsId !== CHIEF_WORKSPACE_ID) {
      yield* closeSubscription(subscriptions, agentId);
    }
  }
}

function* handleInitialize(
  subscriptions: Map<string, SubscriptionEntry>,
  events: Channel<ChatSubscriptionEvent>,
  action: ReturnType<typeof initializeChatRequested>,
): SagaGenerator<void> {
  const { agentId, wsId } = action.payload;
  if (agentId) yield* openSubscription(subscriptions, events, agentId, wsId);
}

function* handleViewed(
  subscriptions: Map<string, SubscriptionEntry>,
  events: Channel<ChatSubscriptionEvent>,
  action: ReturnType<typeof markAgentAsViewed>,
): SagaGenerator<void> {
  const [agentId] = action.payload;
  yield* closeOtherSubscriptions(subscriptions, agentId);
  const session = yield* selectAgentSession.effect(agentId);
  if (session) yield* openSubscription(subscriptions, events, agentId, session.workspaceId);
}

function* handleHydrationSettled(
  subscriptions: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof transcriptHydrationSettled>,
): SagaGenerator<void> {
  const [agentId] = action.payload;
  const entry = subscriptions.get(agentId);
  if (entry?.hasEmitted && entry.lastTranscript) {
    yield* applyTranscript(agentId, entry, entry.lastTranscript);
  }
}

function* handleClearViewed(
  subscriptions: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof clearCurrentlyViewedAgent>,
): SagaGenerator<void> {
  const [scopeAgentId] = action.payload;
  if (scopeAgentId && (yield* isChiefChatAgent(subscriptions, scopeAgentId))) {
    yield* closeSubscription(subscriptions, scopeAgentId);
  } else if ((yield* selectCurrentlyViewedAgentId.effect()) === null) {
    yield* closeNonChiefSubscriptions(subscriptions);
  }
}

function* handleRemoveSession(
  subscriptions: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof removeSession>,
): SagaGenerator<void> {
  const [agentId] = action.payload;
  yield* closeSubscription(subscriptions, agentId);
  // The session is gone (deletion soft-hide): its close-captured anchor must
  // not resume a future unrelated stream.
  resumeAnchors.delete(agentId);
}

function* handleRemoveWorkspaceSessions(
  subscriptions: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof removeWorkspaceSessions>,
): SagaGenerator<void> {
  yield* closeWorkspaceSubscriptions(subscriptions, action.payload[0]);
}

function* handleWorkspaceDeleted(
  subscriptions: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof workspaceDeleted>,
): SagaGenerator<void> {
  const [wsId, agentIds] = action.payload;
  yield* closeWorkspaceSubscriptions(subscriptions, wsId);
  for (const agentId of agentIds) {
    yield* closeSubscription(subscriptions, agentId);
    resumeAnchors.delete(agentId);
  }
}

function* handleClearAll(
  subscriptions: Map<string, SubscriptionEntry>,
  _action: ReturnType<typeof clearAllSessions>,
): SagaGenerator<void> {
  try {
    yield* closeAllSubscriptions(subscriptions);
  } catch (error) {
    logger.error('chat-subscribe saga action failed', error);
  } finally {
    resumeAnchors.clear();
  }
}

function* safely<T extends unknown[]>(
  worker: (...args: T) => Generator,
  ...args: T
): SagaGenerator<void> {
  try {
    yield* call(worker, ...args);
  } catch (error) {
    logger.error('chat-subscribe saga action failed', error);
  }
}

function* watchInitialize(
  subscriptions: Map<string, SubscriptionEntry>,
  events: Channel<ChatSubscriptionEvent>,
  action: ReturnType<typeof initializeChatRequested>,
): SagaGenerator<void> {
  yield* safely(handleInitialize, subscriptions, events, action);
}

function* watchViewed(
  subscriptions: Map<string, SubscriptionEntry>,
  events: Channel<ChatSubscriptionEvent>,
  action: ReturnType<typeof markAgentAsViewed>,
): SagaGenerator<void> {
  yield* safely(handleViewed, subscriptions, events, action);
}

function* watchHydrationSettled(
  subscriptions: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof transcriptHydrationSettled>,
): SagaGenerator<void> {
  yield* safely(handleHydrationSettled, subscriptions, action);
}

function* watchClearViewed(
  subscriptions: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof clearCurrentlyViewedAgent>,
): SagaGenerator<void> {
  yield* safely(handleClearViewed, subscriptions, action);
}

function* watchRemoveSession(
  subscriptions: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof removeSession>,
): SagaGenerator<void> {
  yield* safely(handleRemoveSession, subscriptions, action);
}

function* watchRemoveWorkspaceSessions(
  subscriptions: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof removeWorkspaceSessions>,
): SagaGenerator<void> {
  yield* safely(handleRemoveWorkspaceSessions, subscriptions, action);
}

function* watchWorkspaceDeleted(
  subscriptions: Map<string, SubscriptionEntry>,
  action: ReturnType<typeof workspaceDeleted>,
): SagaGenerator<void> {
  yield* safely(handleWorkspaceDeleted, subscriptions, action);
}

/** Root-owned standing chat subscription lifecycle. */
export function* chatSubscribeSaga(): SagaGenerator<void> {
  const subscriptions = new Map<string, SubscriptionEntry>();
  const events = createChannel(buffers.expanding<ChatSubscriptionEvent>());
  const eventWatcher = yield* takeLeading(events, handleSubscriptionEvent, subscriptions);
  yield* takeLeadingByAgent(initializeChatRequested, watchInitialize, subscriptions, events);
  yield* takeLatest(markAgentAsViewed, watchViewed, subscriptions, events);
  yield* takeLatestInContext(
    transcriptHydrationSettled,
    (action) => action.payload[0],
    watchHydrationSettled,
    subscriptions,
  );
  yield* takeEvery(clearCurrentlyViewedAgent, watchClearViewed, subscriptions);
  yield* takeEvery(removeSession, watchRemoveSession, subscriptions);
  yield* takeEvery(removeWorkspaceSessions, watchRemoveWorkspaceSessions, subscriptions);
  yield* takeEvery(workspaceDeleted, watchWorkspaceDeleted, subscriptions);
  yield* takeEvery(clearAllSessions, handleClearAll, subscriptions);
  try {
    yield* join(eventWatcher);
  } finally {
    events.close();
    yield* closeAllSubscriptions(subscriptions);
    subscriptions.clear();
    resumeAnchors.clear();
  }
}
