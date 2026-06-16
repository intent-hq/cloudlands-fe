/**
 * Agent Lock Selectors
 *
 * Selectors for agent/file lock state accessed by workspace ID.
 */

import { store } from "../../store";

// ============================================================================
// Derived selectors
// ============================================================================

/** Select the record of locked agent IDs for a workspace */
export const selectLockedAgentIds = store.createSelector(
  (state, workspaceId: string): Record<string, true> =>
    state.agentLock.byWorkspaceId[workspaceId]?.lockedAgentIds ?? emptyRecord,
);

// Shared empty record to avoid creating new objects on every selector call
const emptyRecord: Record<string, true> = {};

