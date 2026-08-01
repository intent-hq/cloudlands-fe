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
 * PAIRING WITH THE STANDING SUBSCRIPTION (chat-subscribe-service): the same
 * `initializeChatRequested` also opens a standing `chat.subscribe` whose seq-0
 * snapshot covers the newest page + live-turn slot. This read pages the FULL
 * history (the snapshot is only the newest page); the standing stream owns
 * the in-flight message and reconciles live deltas after hydration.
 *
 * ONE guard that ownership split requires: `agent.getConversation` returns
 * PERSISTED rows only (PROTOCOL §5.5) — the live partial turn exists solely
 * in the subscription's snapshot/deltas (§7.1). When this read completes
 * AFTER the seq-0 snapshot landed (the common mid-turn re-entry ordering),
 * its full-list upsert would clobber the snapshot-delivered in-flight
 * assistant message with a list that cannot contain it. So the hydrate keeps
 * any stream-owned message (`isStreaming: true`) already in the store whose
 * id is absent from the fetched pages. A turn that FINALIZED during the read
 * is not covered by that guard (the persisted row is no longer stream-owned),
 * so the subscription re-asserts its last reconciled transcript on this
 * module's `transcriptHydrationSettled` dispatch — a fetch whose pages
 * predate the finalize cannot silently drop the finalized row.
 *
 * READ-ONLY: this module never invokes an agent mutation (no create/send/stop).
 *
 * Loads are coalesced per agent via an in-flight map: a request arriving while
 * a load is already in flight shares the in-flight read. Post-hydration
 * convergence is owned by the standing subscription — its settle-time
 * re-apply plus its delta reconcile — so no follow-up rerun is scheduled.
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
import { isAgentDeletionPending } from "./utils/pending-agent-deletions";

const logger = createLogger("ChatReadService");

/** In-flight loads keyed by agent id; coalesces concurrent requests. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Keep stream-owned messages the persisted read cannot see: any message
 * already in the store with `isStreaming: true` whose id is absent from the
 * fetched pages was delivered by the standing chat.subscribe snapshot/deltas
 * (the daemon's live-turn slot, never persisted mid-turn) and must survive
 * this full-list hydrate. Fetched rows win on id collision — a finalized
 * turn persists under the same message id. State is read directly off
 * `appStore.state` (dependency-light per src/store AGENTS.md — no selector
 * imports in middleware-adjacent services).
 */
function withPreservedStreamOwnedMessages(
  agentId: string,
  fetched: AgentMessage[],
): AgentMessage[] {
  const state = appStore.state as {
    agentSessions?: { byAgentId: Record<string, { messages?: AgentMessage[] }> };
  };
  const existingMessages = state.agentSessions?.byAgentId[agentId]?.messages;
  if (!existingMessages || existingMessages.length === 0) return fetched;
  const fetchedIds = new Set(fetched.map((message) => message.id));
  const streamOwned = existingMessages.filter(
    (message) => message.isStreaming === true && !fetchedIds.has(message.id),
  );
  if (streamOwned.length === 0) return fetched;
  return [...fetched, ...streamOwned];
}

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
  if (pending) {
    // Share the in-flight read. Post-hydration convergence (a turn finalizing
    // after paging began, live growth during the read) is owned by the
    // standing chat.subscribe delta reconcile, so no rerun is scheduled.
    return pending;
  }

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

      // Final re-check before the store upserts: the deletion may have become
      // pending during transcript paging above.
      if (isAgentDeletionPending(agentId)) return;

      // The live-turn slot and any messages that arrive during/after this
      // read are owned by the standing chat.subscribe stream
      // (chat-subscribe-service): its seq-0 snapshot covers the in-flight
      // message and its deltas reconcile subsequent growth.
      //
      // Guard (mid-turn re-entry regression): this read fetched PERSISTED
      // rows only, so it can never contain the live partial turn. If the
      // snapshot already hydrated a stream-owned message (`isStreaming:
      // true`) that the fetched pages lack, keep it — replacing the list
      // wholesale would blank the already-streamed text until the next
      // delta. A turn that finalized during the read persists under the
      // SAME id, so the fetched (final) copy wins and nothing stale stays.
      //
      // Render BE state as-is: the daemon is the single source of truth for
      // streaming/responding flags. If a chat opens with "Thinking", that is
      // because the daemon snapshot actually reports a turn is in-flight;
      // any orphan/stale healing belongs in the daemon, not the renderer.
      const mergedMessages = withPreservedStreamOwnedMessages(agentId, allMessages);
      const sessionWithMessages = { ...session, messages: mergedMessages };
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
