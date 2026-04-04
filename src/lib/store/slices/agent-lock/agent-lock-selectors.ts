/**
 * Agent Lock Selectors
 *
 * Selectors for agent/file lock state accessed by workspace ID.
 */

import { createSelector } from "../../utils/create-selector";
import { emptyWorkspaceState } from "./agent-lock-slice";
import type { AgentLockWorkspaceState } from "./agent-lock-types";

// ============================================================================
// Per-workspace base selector
// ============================================================================

export const selectAgentLockState = createSelector(
  (state, workspaceId: string): AgentLockWorkspaceState =>
    state.agentLock.byWorkspaceId[workspaceId] ?? emptyWorkspaceState,
);

// ============================================================================
// Derived selectors
// ============================================================================

/** Select the record of locked agent IDs for a workspace */
export const selectLockedAgentIds = createSelector(
  (state, workspaceId: string): Record<string, true> =>
    state.agentLock.byWorkspaceId[workspaceId]?.lockedAgentIds ?? emptyRecord,
);

/** Select the record of locked file paths for a workspace */
export const selectLockedFilePaths = createSelector(
  (state, workspaceId: string): Record<string, true> =>
    state.agentLock.byWorkspaceId[workspaceId]?.lockedFilePaths ?? emptyRecord,
);

/** Check if a specific agent is locked */
export const selectIsAgentLocked = createSelector(
  (state, workspaceId: string, agentId: string): boolean => {
    const ws = state.agentLock.byWorkspaceId[workspaceId];
    if (!ws) return false;
    return agentId in ws.lockedAgentIds;
  },
);

/** Check if a specific file path is locked */
export const selectIsFileLocked = createSelector(
  (state, workspaceId: string, filePath: string): boolean => {
    const ws = state.agentLock.byWorkspaceId[workspaceId];
    if (!ws) return false;
    return filePath in ws.lockedFilePaths;
  },
);

// Shared empty record to avoid creating new objects on every selector call
const emptyRecord: Record<string, true> = {};

