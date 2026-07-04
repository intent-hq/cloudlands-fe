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
 * the session (`appClient.agents.get`) AND the real transcript
 * (`appClient.agents.getConversation`, daemon `agent.getConversation` §5.5), then
 * hydrates the store exactly as the agents-seeder does: `bulkUpsertSessions`
 * populates the agent-session slice (`byAgentId` + messages = the conversation),
 * and `upsertSession` registers the agent id in the workspace-agents index.
 * `bulkUpsertSessions` is the action the agent-session reducer consumes to
 * populate `messages` (it normalizes/sorts/dedups/prunes on ingest).
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
 * Hard safety cap on the number of `agent.getConversation` pages fetched per
 * hydration — the daemon clamps `limit` to 200, so at 500 pages we've asked
 * for up to 100k messages, well past any realistic transcript. Prevents a
 * pathological loop from spinning forever if the daemon ever returned a
 * cursor that never terminated.
 */
const MAX_TRANSCRIPT_PAGES = 500;

/**
 * Page through `agent.getConversation` until `nextToken` is null, accumulating
 * every returned message. Guards against pathological loops by (a) stopping if
 * the daemon repeats a token and (b) capping total pages via
 * `MAX_TRANSCRIPT_PAGES`. Order within the returned array doesn't matter —
 * the agent-session reducer normalizes/sorts/dedups on ingest.
 */
async function fetchAllConversationMessages(agentId: string): Promise<AgentMessage[]> {
  const all: AgentMessage[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_TRANSCRIPT_PAGES; page++) {
    const response = await appClient.agents.getConversation(agentId, undefined, pageToken);
    all.push(...response.messages);
    const next = response.nextToken;
    if (!next) return all;
    if (seenTokens.has(next)) {
      logger.warn("Aborting transcript pagination: nextToken repeated", { agentId });
      return all;
    }
    seenTokens.add(next);
    pageToken = next;
  }
  logger.warn("Aborting transcript pagination: page cap reached", {
    agentId,
    maxPages: MAX_TRANSCRIPT_PAGES,
  });
  return all;
}

/**
 * Fetch a single agent's session AND its real transcript from the seam, then
 * hydrate the store with `{ ...session, messages }`. Errors are swallowed
 * (logged only) so a failed read never clears an existing transcript. Concurrent
 * calls for the same agent share one fetch.
 */
export async function loadChatTranscript(agentId: string): Promise<void> {
  const pending = inFlight.get(agentId);
  if (pending) return pending;

  const run = (async () => {
    try {
      const [session, messages] = await Promise.all([
        appClient.agents.get(agentId),
        fetchAllConversationMessages(agentId),
      ]);
      if (session) {
        // Render BE state as-is: the daemon is the single source of truth for
        // streaming/responding flags. If a chat opens with "Thinking", that is
        // because the daemon snapshot actually reports a turn is in-flight;
        // any orphan/stale healing belongs in the daemon, not the renderer.
        const sessionWithMessages = { ...session, messages };
        appStore.dispatch(bulkUpsertSessions([sessionWithMessages]));
        appStore.dispatch(upsertSession(sessionWithMessages));
      }
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
