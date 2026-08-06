/**
 * Selectors for the unread-tracking Redux slice.
 */

import { store } from "../../store";
import type { DividerSession } from "./unread-tracking-types";

/**
 * The latched "New messages" divider viewing session for an agent, or `null`
 * when no viewing session has started yet. A non-null `{ anchorId: null }`
 * means the session started with no divider (none may appear this session).
 */
export const selectDividerSession = store.createSelector<
  [agentId: string],
  DividerSession | null
>((state, agentId) => {
  return state.unreadTracking.dividerSessionByAgentId[agentId] ?? null;
});
