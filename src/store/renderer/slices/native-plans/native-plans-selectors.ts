/**
 * Native Plans Selectors
 *
 * Source-priority gate for the workspace-task fallback card (monorepo#3249):
 * a native ACP plan for the session always wins over the fallback.
 */
import { store } from "../../store";
import type { NativePlanEntry } from "./native-plans-types";

/** Native plan entries for an ACP session id (empty when none). */
export const selectNativePlanEntries = store.createSelector(
  (state, sessionId: string): NativePlanEntry[] =>
    state.nativePlans?.bySessionId[sessionId]?.entries ?? [],
);

/**
 * True when a native ACP plan exists for the agent's session. Plans are keyed
 * by the ACP session id, so both the agent id itself and the session's
 * `acpSessionId` (when known) are checked.
 */
export const selectHasNativePlanForAgent = store.createSelector(
  (state, agentId: string): boolean => {
    if (!agentId) return false;
    const bySessionId = state.nativePlans?.bySessionId ?? {};
    if (bySessionId[agentId]) return true;
    const acpSessionId = state.agentSessions?.byAgentId[agentId]?.acpSessionId;
    return typeof acpSessionId === "string" && acpSessionId in bySessionId;
  },
);
