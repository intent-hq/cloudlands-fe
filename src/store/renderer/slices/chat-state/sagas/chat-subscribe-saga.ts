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
import { END, buffers, eventChannel, type EventChannel, type Task } from "redux-saga";
import { call, cancel, fork, put, take, type SagaGenerator } from "typed-redux-saga";
import type { AgentMessage } from "$shared/types";
import type {
  ChatLiveStreamPhase,
  ChatTranscript,
} from "$lib/client/app-client";
import { appClient } from "$lib/client";
import {
  chatLiveStreamPhaseChanged,
  initializeChatRequested,
  transcriptHydrationSettled,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import {
  clearAllSessions,
  removeSession,
  removeWorkspaceSessions,
  replaceMessages,
  updateSession,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { workspaceDeleted } from "$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice";
import {
  clearCurrentlyViewedAgent,
  markAgentAsViewed,
} from "$store/renderer/slices/unread-tracking/unread-tracking-slice";
import { deduplicateAgentMessages } from "$shared/utils/message-dedup";
import { CHIEF_WORKSPACE_ID } from "$shared/types/branded-ids";
import { createLogger } from "$lib/utils/client-logger";
import { isAgentDeletionPending } from "$features/agent/utils/pending-agent-deletions";
import { selectAgentSession } from "$store/renderer/slices/agent-session/agent-session-selectors";
import { selectCurrentlyViewedAgentId } from "$store/renderer/slices/unread-tracking/unread-tracking-selectors";

const logger = createLogger("ChatSubscribeSaga");

interface SubscriptionEntry {
  task?: Task;
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
  | { kind: "transcript"; transcript: ChatTranscript }
  | { kind: "phase"; phase: ChatLiveStreamPhase };

function createChatSubscriptionChannel(agentId: string): EventChannel<ChatSubscriptionEvent> {
  return eventChannel<ChatSubscriptionEvent>((emit) => {
    return appClient.chat.subscribe(
      agentId,
      (transcript) => emit({ kind: "transcript", transcript }),
      (phase) => emit({ kind: "phase", phase }),
    );
  }, buffers.expanding<ChatSubscriptionEvent>());
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
 */
function* applyTranscript(
  agentId: string,
  entry: SubscriptionEntry,
  transcript: ChatTranscript,
): SagaGenerator<void> {
  const session = yield* selectAgentSession.effect(agentId);
  if (session) {
    const transcriptIds = new Set<string>();
    for (const message of transcript.messages) {
      if (typeof message.id === "string") transcriptIds.add(message.id);
      if (typeof message.appMessageId === "string") transcriptIds.add(message.appMessageId);
    }
    const storeOnly = (session.messages ?? []).filter(
      (message) =>
        !(typeof message.id === "string" && transcriptIds.has(message.id)) &&
        !(typeof message.appMessageId === "string" && transcriptIds.has(message.appMessageId)),
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

function* runChatSubscription(
  subscriptions: Map<string, SubscriptionEntry>,
  agentId: string,
  entry: SubscriptionEntry,
): SagaGenerator<void> {
  let channel: EventChannel<ChatSubscriptionEvent>;
  try {
    channel = yield* call(createChatSubscriptionChannel, agentId);
  } catch (error) {
    if (subscriptions.get(agentId) === entry) subscriptions.delete(agentId);
    logger.error("Failed to open chat subscription", error);
    return;
  }

  try {
    while (true) {
      const event: ChatSubscriptionEvent = yield* take(channel);
      if (event === (END as unknown as ChatSubscriptionEvent)) break;
      try {
        if (event.kind === "phase") {
          yield* put(chatLiveStreamPhaseChanged(agentId, event.phase));
          continue;
        }
        if (yield* call(isAgentDeletionPending, agentId)) return;
        entry.hasEmitted = true;
        entry.lastTranscript = event.transcript;
        yield* applyTranscript(agentId, entry, event.transcript);
      } catch (error) {
        logger.error("Failed to process chat subscription event", error);
      }
    }
  } finally {
    try {
      channel.close();
    } catch (error) {
      logger.error("Failed to close chat subscription", error);
    }
    if (subscriptions.get(agentId) === entry) subscriptions.delete(agentId);
    try {
      yield* put(chatLiveStreamPhaseChanged(agentId, null));
    } catch (error) {
      logger.error("Failed to reset live stream phase", error);
    }
    try {
      yield* clearStaleStreamingMessageFlags(agentId);
    } catch (error) {
      logger.error("Failed to clear stale streaming message flags", error);
    }
  }
}

function* openSubscription(
  subscriptions: Map<string, SubscriptionEntry>,
  agentId: string,
  wsId?: string,
): SagaGenerator<void> {
  if (subscriptions.has(agentId)) return;
  if (yield* call(isAgentDeletionPending, agentId)) return;
  const entry: SubscriptionEntry = { wsId, hasEmitted: false, wasStreaming: false };
  subscriptions.set(agentId, entry);
  entry.task = yield* fork(runChatSubscription, subscriptions, agentId, entry);
}

function* closeSubscription(
  subscriptions: Map<string, SubscriptionEntry>,
  agentId: string,
): SagaGenerator<void> {
  const entry = subscriptions.get(agentId);
  if (!entry) return;
  subscriptions.delete(agentId);
  if (entry.task) yield* cancel(entry.task);
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
    if (entry.wsId === wsId) yield* closeSubscription(subscriptions, agentId);
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

type ChatSubscribeAction = { type: string; payload?: unknown };

function* handleChatSubscribeAction(
  subscriptions: Map<string, SubscriptionEntry>,
  action: ChatSubscribeAction,
): SagaGenerator<void> {
  if (action.type === initializeChatRequested.type) {
    const payload = action.payload as { agentId?: unknown; wsId?: unknown } | undefined;
    const agentId = payload?.agentId;
    const wsId = payload?.wsId;
    if (typeof agentId === "string" && agentId.length > 0) {
      yield* openSubscription(
        subscriptions,
        agentId,
        typeof wsId === "string" ? wsId : undefined,
      );
    }
  } else if (action.type === markAgentAsViewed.type) {
    const [agentId] = action.payload as [string];
    if (typeof agentId === "string" && agentId.length > 0) {
      yield* closeOtherSubscriptions(subscriptions, agentId);
      // (Re)open for the newly viewed agent when its session is already
      // known — ChatPanel's initializeChatRequested covers first-open.
      const session = yield* selectAgentSession.effect(agentId);
      if (session) {
        yield* openSubscription(subscriptions, agentId, session.workspaceId);
      }
    }
  } else if (action.type === transcriptHydrationSettled.type) {
    // A slower full-history hydrate (chat-read saga) may have landed a paged
    // fetch that predates a row this stream already finalized — clobbering it.
    // Re-assert the canonical transcript against the post-hydrate store.
    const [agentId] = action.payload as [string];
    if (typeof agentId === "string") {
      const entry = subscriptions.get(agentId);
      if (entry?.hasEmitted && entry.lastTranscript) {
        yield* applyTranscript(agentId, entry, entry.lastTranscript);
      }
    }
  } else if (action.type === clearCurrentlyViewedAgent.type) {
    const [scopeAgentId] = (action.payload as [string?] | undefined) ?? [];
    if (
      typeof scopeAgentId === "string" &&
      (yield* isChiefChatAgent(subscriptions, scopeAgentId))
    ) {
      yield* closeSubscription(subscriptions, scopeAgentId);
    } else if ((yield* selectCurrentlyViewedAgentId.effect()) === null) {
      // Post-reducer: an ignored scoped clear leaves an agent viewed, so keep
      // its subscription. Chief subscriptions have an independent lifecycle.
      yield* closeNonChiefSubscriptions(subscriptions);
    }
  } else if (action.type === removeSession.type) {
    const [agentId] = action.payload as [string];
    if (typeof agentId === "string") yield* closeSubscription(subscriptions, agentId);
  } else if (action.type === removeWorkspaceSessions.type) {
    const [wsId] = action.payload as [string];
    if (typeof wsId === "string") yield* closeWorkspaceSubscriptions(subscriptions, wsId);
  } else if (action.type === workspaceDeleted.type) {
    const [wsId, agentIds] = action.payload as [string, string[]];
    if (typeof wsId === "string") yield* closeWorkspaceSubscriptions(subscriptions, wsId);
    if (Array.isArray(agentIds)) {
      for (const agentId of agentIds) {
        if (typeof agentId === "string") {
          yield* closeSubscription(subscriptions, agentId);
        }
      }
    }
  } else if (action.type === clearAllSessions.type) {
    yield* closeAllSubscriptions(subscriptions);
  }
}

/** Root-owned standing chat subscription lifecycle. */
export function* chatSubscribeSaga(): SagaGenerator<void> {
  const subscriptions = new Map<string, SubscriptionEntry>();
  try {
    while (true) {
      const action: ChatSubscribeAction = yield* take([
        initializeChatRequested,
        markAgentAsViewed,
        transcriptHydrationSettled,
        clearCurrentlyViewedAgent,
        removeSession,
        removeWorkspaceSessions,
        workspaceDeleted,
        clearAllSessions,
      ]);
      try {
        yield* handleChatSubscribeAction(subscriptions, action);
      } catch (error) {
        logger.error("chat-subscribe saga action failed", error);
      }
    }
  } finally {
    yield* closeAllSubscriptions(subscriptions);
    subscriptions.clear();
  }
}
