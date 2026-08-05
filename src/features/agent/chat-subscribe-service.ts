/**
 * Chat subscribe service — feeds the STANDING `chat.subscribe` transcript
 * (PROTOCOL §7.1) into the agent-session slice so ChatPanel renders from the
 * live-reconciled stream, sibling to `chat-read-service.ts`.
 *
 * `createChatSubscribeMiddleware()` observes every dispatched action:
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
 * only), and the initial hydration (`chat-read-service`) writes only the
 * persisted history. `hasLiveChatSubscription` reports whether this agent's
 * subscription has emitted its seq-0 snapshot, which consumers (e.g. the
 * bridge's agent:message refetch gate) use to skip redundant fetches.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, slice actions, the shared dedup util, and the logger
 * (NOT selectors).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import type { AgentMessage } from "$shared/types";
import type { ChatTranscript, Unsubscribe } from "$lib/client/app-client";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
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
import { isAgentDeletionPending } from "./utils/pending-agent-deletions";

const logger = createLogger("ChatSubscribeService");

interface SubscriptionEntry {
  unsubscribe: Unsubscribe;
  /** Workspace the chat was opened under (for removeWorkspaceSessions teardown). */
  wsId?: string;
  /** True once the reconciler has emitted (seq-0 snapshot applied). */
  hasEmitted: boolean;
  /** Last emitted transcript.isStreaming, for edge-triggered flag writes. */
  wasStreaming: boolean;
  /** Last reconciled transcript, re-applied on transcriptHydrationSettled. */
  lastTranscript?: ChatTranscript;
}

/** Standing subscriptions keyed by agent id — at most one per agent. */
const subscriptions = new Map<string, SubscriptionEntry>();

/**
 * True while the standing subscription for this agent is live AND has emitted
 * at least once (seq-0 snapshot applied).
 */
export function hasLiveChatSubscription(agentId: string): boolean {
  return subscriptions.get(agentId)?.hasEmitted === true;
}

type StoredSessionLite = {
  workspaceId?: string;
  messages?: AgentMessage[];
  isStreaming?: boolean;
  isProcessing?: boolean;
};

/** Dependency-light one-time read of the store's session (no selector import). */
function readSession(agentId: string): StoredSessionLite | undefined {
  const state = appStore.state as {
    agentSessions?: { byAgentId: Record<string, StoredSessionLite> };
  };
  return state.agentSessions?.byAgentId[agentId];
}

/** Dependency-light one-time read of the viewed agent (no selector import). */
function readCurrentlyViewedAgentId(): string | null {
  const state = appStore.state as {
    unreadTracking?: { currentlyViewedAgentId: string | null };
  };
  return state.unreadTracking?.currentlyViewedAgentId ?? null;
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
function applyTranscript(
  agentId: string,
  entry: SubscriptionEntry,
  transcript: ChatTranscript,
): void {
  const session = readSession(agentId);
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
    appStore.dispatch(replaceMessages(agentId, merged));
  }

  // Consume the streaming edge only when the dispatch actually lands — a
  // pre-hydration emit must not swallow the transition, so the next emit
  // against the hydrated session still sees the edge and dispatches it.
  const streamingChanged = transcript.isStreaming !== entry.wasStreaming;
  if (session && streamingChanged) {
    entry.wasStreaming = transcript.isStreaming;
    appStore.dispatch(
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
 * Open the standing subscription for an agent. Idempotent per agent id; a
 * no-op while a soft-hidden deletion is pending (the daemon still knows the
 * agent, so subscribing would resurrect the deleted session's state).
 */
export function openChatSubscription(agentId: string, wsId?: string): void {
  if (subscriptions.has(agentId)) return;
  if (isAgentDeletionPending(agentId)) return;
  const entry: SubscriptionEntry = {
    unsubscribe: () => {},
    wsId,
    hasEmitted: false,
    wasStreaming: false,
  };
  subscriptions.set(agentId, entry);
  try {
    entry.unsubscribe = appClient.chat.subscribe(
      agentId,
      (transcript) => {
        // The entry may have been superseded by teardown while a push was in
        // flight — only the registered entry may write.
        if (subscriptions.get(agentId) !== entry) return;
        // Deletion became pending after the subscription opened: tear down
        // instead of resurrecting the soft-hidden session.
        if (isAgentDeletionPending(agentId)) {
          closeChatSubscription(agentId);
          return;
        }
        entry.hasEmitted = true;
        entry.lastTranscript = transcript;
        try {
          applyTranscript(agentId, entry, transcript);
        } catch (error) {
          logger.error("Failed to apply chat.subscribe transcript", error);
        }
      },
      (phase) => {
        // Mirror the live client's observational phase reports (already
        // deduped there) into the chat-state slice. Same superseded-entry
        // guard as the transcript path.
        if (subscriptions.get(agentId) !== entry) return;
        appStore.dispatch(chatLiveStreamPhaseChanged(agentId, phase));
      },
    );
  } catch (error) {
    subscriptions.delete(agentId);
    logger.error("Failed to open chat subscription", error);
  }
}

/**
 * Clear stale message-level streaming flags left behind when the standing
 * subscription closes mid-turn (navigate-away): nothing else rewrites the
 * stream-owned partial message, so its `isStreaming: true` /
 * `streamingComplete: false` would otherwise keep reporting a stream-owned
 * buffer that no longer grows — freezing the AgentCard tier-1 preview and
 * masking the push-applied `lastAgentResponse` that IS advancing. The
 * message content is untouched; a re-view's seq-0 snapshot re-canonicalizes
 * everything (same message id).
 */
function clearStaleStreamingMessageFlags(agentId: string): void {
  const messages = readSession(agentId)?.messages;
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
  appStore.dispatch(replaceMessages(agentId, normalized));
}

/** Close (and forget) the standing subscription for an agent. Idempotent. */
export function closeChatSubscription(agentId: string): void {
  const entry = subscriptions.get(agentId);
  if (!entry) return;
  subscriptions.delete(agentId);
  try {
    entry.unsubscribe();
  } catch (error) {
    logger.error("Failed to close chat subscription", error);
  }
  try {
    // No subscription ⇒ no phase: a closed stream must never leave a stale
    // pre-live phase behind (it would re-show the hydration indicator).
    appStore.dispatch(chatLiveStreamPhaseChanged(agentId, null));
  } catch (error) {
    logger.error("Failed to reset live stream phase", error);
  }
  try {
    clearStaleStreamingMessageFlags(agentId);
  } catch (error) {
    logger.error("Failed to clear stale streaming message flags", error);
  }
}

function closeAllChatSubscriptions(): void {
  for (const agentId of [...subscriptions.keys()]) closeChatSubscription(agentId);
}

function closeWorkspaceChatSubscriptions(wsId: string): void {
  for (const [agentId, entry] of [...subscriptions.entries()]) {
    if (entry.wsId === wsId) closeChatSubscription(agentId);
  }
}

/**
 * True when the agent belongs to the chief virtual workspace, per its
 * subscription entry's wsId or (before a subscription exists) its stored
 * session's workspaceId.
 */
function isChiefChatAgent(agentId: string): boolean {
  return (
    subscriptions.get(agentId)?.wsId === CHIEF_WORKSPACE_ID ||
    readSession(agentId)?.workspaceId === CHIEF_WORKSPACE_ID
  );
}

/**
 * Close every subscription except the given agent's (agent-switch swap).
 * Realm-scoped (monorepo#1421): chief-workspace and ordinary workspace
 * subscriptions never close each other — the Chief panel stays open (and
 * must keep rendering live) while workspace chats are viewed, and vice
 * versa. Viewing a chief thread still closes other chief threads'.
 */
function closeOtherChatSubscriptions(agentId: string): void {
  const viewedIsChief = isChiefChatAgent(agentId);
  for (const [otherId, entry] of [...subscriptions.entries()]) {
    if (otherId === agentId) continue;
    if ((entry.wsId === CHIEF_WORKSPACE_ID) !== viewedIsChief) continue;
    closeChatSubscription(otherId);
  }
}

/**
 * Close every non-chief subscription (chat close — the chief panel's
 * lifecycle is independent of the chat area's viewed state).
 */
function closeNonChiefChatSubscriptions(): void {
  for (const [agentId, entry] of [...subscriptions.entries()]) {
    if (entry.wsId !== CHIEF_WORKSPACE_ID) closeChatSubscription(agentId);
  }
}

/** Test-only: dispose everything and reset module state. */
export function __resetChatSubscribeServiceForTests(): void {
  closeAllChatSubscriptions();
}

/**
 * Middleware wiring the subscription lifecycle to the store's action stream.
 * Runs after the reducer so state reads observe the post-action state.
 */
export function createChatSubscribeMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!action || typeof action !== "object") return result;
    const { type } = action as { type?: unknown };
    try {
      if (type === initializeChatRequested.type) {
        const payload = (action as { payload?: { agentId?: unknown; wsId?: unknown } }).payload;
        const agentId = payload && typeof payload === "object" ? payload.agentId : undefined;
        const wsId = payload && typeof payload === "object" ? payload.wsId : undefined;
        if (typeof agentId === "string" && agentId.length > 0) {
          openChatSubscription(agentId, typeof wsId === "string" ? wsId : undefined);
        }
      } else if (type === markAgentAsViewed.type) {
        const [agentId] = (action as { payload: [string] }).payload;
        if (typeof agentId === "string" && agentId.length > 0) {
          closeOtherChatSubscriptions(agentId);
          // (Re)open for the newly viewed agent when its session is already
          // known — ChatPanel's initializeChatRequested covers first-open.
          if (readSession(agentId)) {
            openChatSubscription(agentId, readSession(agentId)?.workspaceId);
          }
        }
      } else if (type === transcriptHydrationSettled.type) {
        // A slower full-history hydrate (chat-read-service) may have landed a
        // paged fetch that predates a row this stream already finalized —
        // clobbering it (the persisted row is not stream-owned, so the read
        // side's isStreaming guard cannot preserve it). Re-assert the
        // canonical reconciled transcript against the post-hydrate store.
        // The reducer for this action has already run, and applyTranscript's
        // streaming edge is keyed on entry.wasStreaming, so a re-apply with
        // the same transcript never re-dispatches a consumed flag edge.
        const [agentId] = (action as { payload: [string] }).payload;
        if (typeof agentId === "string") {
          const entry = subscriptions.get(agentId);
          if (entry?.hasEmitted && entry.lastTranscript) {
            applyTranscript(agentId, entry, entry.lastTranscript);
          }
        }
      } else if (type === clearCurrentlyViewedAgent.type) {
        const [scopeAgentId] = (action as { payload: [string?] }).payload ?? [];
        if (typeof scopeAgentId === "string" && isChiefChatAgent(scopeAgentId)) {
          // The swap exempts chief-workspace subscriptions, so this scoped
          // clear (ChiefCard collapse / thread-switch destroy) is their only
          // viewed-lifecycle teardown — close exactly this subscription, even
          // while another agent remains viewed. No close-all: the chief
          // panel closing says nothing about the chat area (monorepo#1421).
          closeChatSubscription(scopeAgentId);
        } else if (readCurrentlyViewedAgentId() === null) {
          // Runs post-reducer: a scoped clear from a background/deactivating
          // panel that does not match the viewed agent is a reducer no-op, so
          // an agent still being viewed means the chat did NOT close — keep
          // its standing subscription (monorepo#1215). Chief subscriptions
          // are spared: their panel is still open (monorepo#1421).
          closeNonChiefChatSubscriptions();
        }
      } else if (type === removeSession.type) {
        const [agentId] = (action as { payload: [string] }).payload;
        if (typeof agentId === "string") closeChatSubscription(agentId);
      } else if (type === removeWorkspaceSessions.type) {
        const [wsId] = (action as { payload: [string] }).payload;
        if (typeof wsId === "string") closeWorkspaceChatSubscriptions(wsId);
      } else if (type === workspaceDeleted.type) {
        const [wsId, agentIds] = (action as { payload: [string, string[]] }).payload;
        if (typeof wsId === "string") closeWorkspaceChatSubscriptions(wsId);
        if (Array.isArray(agentIds)) {
          for (const agentId of agentIds) {
            if (typeof agentId === "string") closeChatSubscription(agentId);
          }
        }
      } else if (type === clearAllSessions.type) {
        closeAllChatSubscriptions();
      }
    } catch (error) {
      logger.error("chat-subscribe middleware failed", error);
    }
    return result;
  };
}
