/**
 * Agent read service — the sanctioned post-saga on-demand session-load mechanism.
 *
 * The `ensureAgentSessionLoaded` trigger lost its handler when the saga runtime
 * was removed (it used to live in `sagas/ensure-agent-session-saga.ts`), so the
 * AgentCard / WorkspaceHoverCard dispatch sites became no-ops and a selected
 * agent's session/conversation never hydrated on demand. This restores the read
 * path WITHOUT re-adding a saga and WITHOUT changing any call site:
 * `createAgentReadMiddleware()` observes every dispatched action and, on
 * `ensureAgentSessionLoaded`, runs `ensureAgentSession(agentId)` — which fetches
 * `appClient.agents.get` and hydrates the store exactly as the agents-seeder
 * does: `bulkUpsertSessions([session])` populates the agent-session slice
 * (`byAgentId` + messages = the conversation), and `upsertSession(session)`
 * registers the agent id in the workspace-agents index. `upsertSession` alone is
 * NOT enough — the agent-session reducer only consumes `bulkUpsertSessions`.
 *
 * READ-ONLY: this module never invokes an agent mutation (no create/send/stop).
 *
 * Loads are coalesced per agent via an in-flight map so the AgentCard mount
 * effect and the WorkspaceHoverCard per-agent loop collapse rapid re-dispatches
 * into a single `agent.get` fetch.
 *
 * Conversation note: the agent session's `messages` array IS the conversation.
 * On the mock seam this carries the sample transcript; on the live daemon
 * `agent.get` currently returns message COUNTS only (no transcript) and the chat
 * domain is still mock-delegated, so live transcripts are a documented BE gap
 * (Track C chat snapshot) — this service does not fabricate them.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam, the
 * configured store, the slice actions, and the logger (NOT selectors — importing
 * them would evaluate `store.createSelector` while the store module is still
 * mid-initialization through the middleware chain).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { ensureAgentSessionLoaded } from "$store/renderer/slices/workspace-agents/workspace-agents-slice";
import {
  bulkUpsertSessions,
  upsertSession,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("AgentReadService");

/** In-flight loads keyed by agent id; coalesces concurrent requests. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Fetch a single agent's session from the seam and hydrate the store with it.
 * Errors are swallowed (logged only) so a failed read leaves any prior session
 * intact rather than clearing it. Concurrent calls for the same agent share one
 * fetch.
 */
export async function ensureAgentSession(agentId: string): Promise<void> {
  const pending = inFlight.get(agentId);
  if (pending) return pending;

  const run = (async () => {
    try {
      const session = await appClient.agents.get(agentId);
      if (session) {
        // `agent.get` returns AgentLite (PROTOCOL §5.5) — session metadata and
        // message COUNTS only, not the retained transcript. `normalizeAgent`
        // fills the missing `messages` field with `[]`, so dispatching this
        // session as-is would clobber a transcript that `chat-read-service`
        // already hydrated via `agent.getConversation`. Preserve any existing
        // messages so this metadata-only refresh never erases the seq-0 user
        // message (nor any subsequent history).
        const existing = appStore.state.agentSessions?.byAgentId[agentId];
        const merged =
          existing && existing.messages.length > 0
            ? { ...session, messages: existing.messages }
            : session;
        appStore.dispatch(bulkUpsertSessions([merged]));
        appStore.dispatch(upsertSession(merged));
      }
    } catch (error) {
      logger.error("Failed to load agent session", error);
    } finally {
      inFlight.delete(agentId);
    }
  })();

  inFlight.set(agentId, run);
  return run;
}

/**
 * Middleware that gives `ensureAgentSessionLoaded` a real handler: after the
 * action passes through the reducer, it kicks off a (deduped) session load for
 * the target agent. Fire-and-forget — dispatch stays synchronous and never
 * throws. The action payload is the `[wsId, agentId]` tuple.
 */
export function createAgentReadMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === ensureAgentSessionLoaded.type) {
      const agentId = Array.isArray(action.payload) ? action.payload[1] : undefined;
      if (typeof agentId === "string" && agentId.length > 0) {
        void ensureAgentSession(agentId);
      }
    }
    return result;
  };
}
