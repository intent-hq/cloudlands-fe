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
 * the session (`appClient.agents.get`) AND the real transcript via the
 * `chat.subscribe` seq-0 snapshot (PROTOCOL §7.1, `appClient.chat.subscribeSnapshot`).
 * The snapshot merges the newest `agent.getConversation` page with the
 * synthetic in-flight assistant message (`isStreaming: true`) when a turn is
 * currently streaming, so switching away and back to a chat mid-turn rehydrates
 * the interim response instead of clobbering it with persisted-only history.
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
      const [session, snapshot] = await Promise.all([
        appClient.agents.get(agentId),
        appClient.chat.subscribeSnapshot(agentId),
      ]);
      if (session) {
        // Render BE state as-is: the daemon is the single source of truth for
        // streaming/responding flags. If a chat opens with "Thinking", that is
        // because the daemon snapshot actually reports a turn is in-flight;
        // any orphan/stale healing belongs in the daemon, not the renderer.
        const sessionWithMessages = { ...session, messages: snapshot.messages };
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
