/**
 * Chat read service — the sanctioned post-saga on-demand transcript-load
 * mechanism, sibling to `agent-read-service.ts`.
 *
 * `ChatPanel.svelte` dispatches `initializeChatRequested(agentId, { wsId,
 * options })` on mount and on workspace rebind, but its saga was removed when the
 * saga runtime went away — so the dispatch became a no-op and a real agent's
 * conversation never hydrated, showing an empty transcript. This restores the
 * read path WITHOUT re-adding a saga and WITHOUT changing the dispatch site:
 * `createChatReadMiddleware()` observes every dispatched action and, on
 * `initializeChatRequested`, runs `loadChatTranscript(agentId)` — which fetches
 * the session (`appClient.agents.get`) AND the FULL transcript by paging through
 * `agent.getConversation` (PROTOCOL §5.5, up to 200 messages per page, looping
 * on `nextToken` until the complete conversation is assembled). The daemon's
 * AgentLite projection (from `agents.get`) returns only message COUNTS, so
 * `getConversation` is the sole source of the actual message content.
 * `bulkUpsertSessions` populates the agent-session slice (`byAgentId` + messages
 * = the conversation), and `upsertSession` registers the agent id in the
 * workspace-agents index.
 *
 * READ-ONLY: this module never invokes an agent mutation (no create/send/stop).
 *
 * Loads are coalesced per agent via an in-flight map so the ChatPanel mount
 * effect and rebind re-dispatch collapse rapid triggers into one fetch.
 *
 * Errors are swallowed (logged only) so a failed read leaves any prior session
 * intact rather than clobbering it with an empty transcript. If `agents.get`
 * returns null we skip entirely (do not fabricate a session).
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam, the
 * configured store, the slice actions, and the logger (NOT selectors — importing
 * them would evaluate `store.createSelector` while the store module is still
 * mid-initialization through the middleware chain).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import type { AgentMessage } from "$shared/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  initializeChatRequested,
  transcriptHydrationStarted,
  transcriptHydrationSettled,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import {
  bulkUpsertSessions,
  upsertSession,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { createLogger } from "$lib/utils/client-logger";
import { seedStreamFromSnapshot } from "$features/events/daemon-events-bridge.client";
import { isAgentDeletionPending } from "./utils/pending-agent-deletions";

const logger = createLogger("ChatReadService");

/** In-flight loads keyed by agent id; coalesces concurrent requests. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Fetch a single agent's session AND its FULL transcript from the seam, then
 * hydrate the store with `{ ...session, messages }`. Pages through
 * agent.getConversation to assemble the complete transcript (the daemon
 * returns up to 200 messages per page). Errors are swallowed (logged only) so
 * a failed read never clears an existing transcript. Concurrent calls for the
 * same agent share one fetch.
 */
export async function loadChatTranscript(agentId: string): Promise<void> {
  // A soft-hidden deletion is pending (undo window still open): the daemon
  // still returns the agent, so hydrating would re-upsert the deleted
  // session. Skip entirely.
  if (isAgentDeletionPending(agentId)) return;
  const pending = inFlight.get(agentId);
  if (pending) return pending;

  // Create a placeholder promise that we'll resolve once the actual work is done
  let resolveRun!: () => void;
  const runPromise = new Promise<void>((resolve) => {
    resolveRun = resolve;
  });

  // Register in inFlight BEFORE dispatching to prevent re-entrant calls
  inFlight.set(agentId, runPromise);

  // Dispatch loading status synchronously now that we're registered
  // Wrap in try/catch to ensure cleanup if dispatch throws
  try {
    appStore.dispatch(transcriptHydrationStarted(agentId));
  } catch (error) {
    // If dispatch throws, clean up inFlight but do NOT resolve the promise
    // (coalesced callers should see the failure, not a fake success)
    inFlight.delete(agentId);
    throw error;
  }

  // Actually perform the work
  (async () => {
    try {
      const session = await appClient.agents.get(agentId);
      if (!session) return;
      // Re-check after the fetch: a deletion may have become pending while
      // `agent.get` was in flight; hydrating now would resurrect the
      // soft-hidden session (and paging the transcript would be wasted work).
      if (isAgentDeletionPending(agentId)) return;

      // Fetch the FULL transcript by paging through agent.getConversation.
      // Request 200 messages per page (daemon max) and loop on nextToken.
      // This fixes the flicker/truncation bug where chat.subscribeSnapshot
      // (which returns only the newest ~50 messages) was used for initial
      // load, causing transcripts with > 50 messages to be truncated.
      const allMessages: AgentMessage[] = [];
      let nextToken: string | null = null;
      const pageLimit = 200;

      do {
        const page = await appClient.agents.getConversation(
          agentId,
          pageLimit,
          nextToken || undefined,
        );
        // getConversation returns oldest→newest within each page, so prepend
        // each page to maintain overall newest-first order when accumulating.
        allMessages.unshift(...page.messages);
        nextToken = page.nextToken;
      } while (nextToken !== null);

      // REJOIN-STREAM FIX: chat.subscribe snapshot merges the live-turn slot
      // (CS-0 D5), while agent.getConversation returns persisted-only. Fetch
      // the snapshot and merge any in-flight assistant message into the hydrated
      // transcript so reopening a mid-turn chat shows the partial response
      // immediately instead of waiting for the next chunk/tool-call.
      const snapshot = await appClient.chat.subscribeSnapshot(agentId);

      // Final re-check before any side effects: the deletion may have become
      // pending during transcript paging / snapshot fetch above. This guards
      // both the store upserts below and seedStreamFromSnapshot (the bridge
      // accumulator must not be seeded for a deleted agent).
      if (isAgentDeletionPending(agentId)) return;

      const inFlightMessage = snapshot.messages.find(
        (m) =>
          m.role === "assistant" &&
          typeof m.isStreaming === "boolean" &&
          m.isStreaming === true,
      );

      // Merge in-flight message when present: dedup by message id, persisted
      // copy wins (the snapshot's in-flight entry may carry stale metadata
      // but fresher content blocks). If the persisted set already contains
      // the same message id, skip the snapshot's copy to preserve finalized
      // metadata.
      let finalMessages = allMessages;
      if (inFlightMessage && typeof inFlightMessage.id === "string") {
        const persistedIds = new Set(
          allMessages.map((m) => (typeof m.id === "string" ? m.id : null)).filter(Boolean),
        );
        if (!persistedIds.has(inFlightMessage.id)) {
          // Append in-flight message (allMessages is oldest-first after the
          // unshift-per-page accumulation, so the newest in-flight assistant
          // goes at the end).
          finalMessages = [...allMessages, inFlightMessage];
          // Seed the bridge stream accumulator so subsequent agent:stream:chunk
          // events build on the hydrated prefix instead of starting empty
          // (which would fail the regression guard until the candidate outgrows
          // the partial). The snapshot's in-flight assistant carries the full
          // content-blocks array built by chat_snapshot's CS-0 D5 merge.
          seedStreamFromSnapshot(agentId, inFlightMessage, session.workspaceId);
        }
      }

      // Render BE state as-is: the daemon is the single source of truth for
      // streaming/responding flags. If a chat opens with "Thinking", that is
      // because the daemon snapshot actually reports a turn is in-flight;
      // any orphan/stale healing belongs in the daemon, not the renderer.
      const sessionWithMessages = { ...session, messages: finalMessages };
      appStore.dispatch(bulkUpsertSessions([sessionWithMessages]));
      appStore.dispatch(upsertSession(sessionWithMessages));
    } catch (error) {
      logger.error("Failed to load agent conversation transcript", error);
      // Errors are swallowed (don't reject the promise)
    } finally {
      // Always mark as settled, whether success or error (errors are swallowed)
      // Wrap cleanup in try/finally to ensure inFlight.delete and resolveRun
      // run even if the dispatch throws
      try {
        appStore.dispatch(transcriptHydrationSettled(agentId));
      } finally {
        inFlight.delete(agentId);
        resolveRun();
      }
    }
  })();

  return runPromise;
}

/**
 * Middleware that gives `initializeChatRequested` a real handler: after the
 * action passes through the reducer, it kicks off a (deduped) transcript load
 * for the target agent. Fire-and-forget — dispatch stays synchronous and never
 * throws. The action payload is `{ agentId, wsId, options }`.
 */
export function createChatReadMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === initializeChatRequested.type) {
      const payload = action.payload as { agentId?: unknown } | undefined;
      const agentId =
        payload && typeof payload === "object" ? payload.agentId : undefined;
      if (typeof agentId === "string" && agentId.length > 0) {
        void loadChatTranscript(agentId);
      }
    }
    return result;
  };
}
