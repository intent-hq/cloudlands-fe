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
 *    session exists — so switching chats never leaks registrations.
 *  - `clearCurrentlyViewedAgent` (chat close / panel destroy) closes all.
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
 * SOLE-WRITER INVARIANT: while a subscription is live for an agent (i.e. it
 * has emitted at least once — `hasLiveChatSubscription`), it is the sole
 * writer of that agent's transcript MESSAGE state. The firehose transcript
 * path (`agent-stream-service`) consults `hasLiveChatSubscription` and skips
 * its message writes, keeping only its chat-state finalize bookkeeping —
 * otherwise the FE-preassigned placeholder id and the daemon-keyed §7.1
 * message would double-apply as duplicate assistant rows. Until the first
 * emit lands (or if the subscribe fails), the firehose path still applies, so
 * a failed registration degrades to the previous behavior instead of a dead
 * transcript.
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
import { initializeChatRequested } from "$store/renderer/slices/chat-state/chat-state-slice";
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
}

/** Standing subscriptions keyed by agent id — at most one per agent. */
const subscriptions = new Map<string, SubscriptionEntry>();

/**
 * True while the standing subscription for this agent is live AND has emitted
 * at least once. The firehose transcript writer (`agent-stream-service`) must
 * skip message writes while this holds (sole-writer invariant).
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

  const streamingChanged = transcript.isStreaming !== entry.wasStreaming;
  entry.wasStreaming = transcript.isStreaming;
  if (session && streamingChanged) {
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
    entry.unsubscribe = appClient.chat.subscribe(agentId, (transcript) => {
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
      try {
        applyTranscript(agentId, entry, transcript);
      } catch (error) {
        logger.error("Failed to apply chat.subscribe transcript", error);
      }
    });
  } catch (error) {
    subscriptions.delete(agentId);
    logger.error("Failed to open chat subscription", error);
  }
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
}

function closeAllChatSubscriptions(): void {
  for (const agentId of [...subscriptions.keys()]) closeChatSubscription(agentId);
}

function closeWorkspaceChatSubscriptions(wsId: string): void {
  for (const [agentId, entry] of [...subscriptions.entries()]) {
    if (entry.wsId === wsId) closeChatSubscription(agentId);
  }
}

/** Close every subscription except the given agent's (agent-switch swap). */
function closeOtherChatSubscriptions(agentId: string): void {
  for (const otherId of [...subscriptions.keys()]) {
    if (otherId !== agentId) closeChatSubscription(otherId);
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
      } else if (type === clearCurrentlyViewedAgent.type) {
        closeAllChatSubscriptions();
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
