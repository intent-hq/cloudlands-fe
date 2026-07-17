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
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import type { AgentMessage } from "$shared/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { initializeChatRequested } from "$store/renderer/slices/chat-state/chat-state-slice";
import {
  bulkUpsertSessions,
  upsertSession,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { createLogger } from "$lib/utils/client-logger";

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
  const pending = inFlight.get(agentId);
  if (pending) return pending;

  const run = (async () => {
    try {
      const session = await appClient.agents.get(agentId);
      if (!session) return;

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

      // Render BE state as-is: the daemon is the single source of truth for
      // streaming/responding flags. If a chat opens with "Thinking", that is
      // because the daemon snapshot actually reports a turn is in-flight;
      // any orphan/stale healing belongs in the daemon, not the renderer.
      const sessionWithMessages = { ...session, messages: allMessages };
      appStore.dispatch(bulkUpsertSessions([sessionWithMessages]));
      appStore.dispatch(upsertSession(sessionWithMessages));
    } catch (error) {
      logger.error("Failed to load agent conversation transcript", error);
    } finally {
      inFlight.delete(agentId);
    }
  })();

  inFlight.set(agentId, run);
  return run;
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
