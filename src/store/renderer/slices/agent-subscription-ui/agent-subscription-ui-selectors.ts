/**
 * Selectors for the agent-subscription-ui slice.
 */

import { store } from "../../store";
import {
  makeKey,
  emptyEntry,
} from './agent-subscription-ui-slice';
import type {
  AgentSubscriptionUIEntry,
  Subscription,
  DelegationGroupStatus,
  WaitingState,
  WokenUpInfo,
} from './agent-subscription-ui-types';

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

const selectEntry = store.createSelector<[workspaceId: string, agentId: string], AgentSubscriptionUIEntry>(
  (state, workspaceId, agentId) => {
    const key = makeKey(workspaceId, agentId);
    return state.agentSubscriptionUI.entries[key] ?? emptyEntry;
  },
);

// ---------------------------------------------------------------------------
// Public selectors
// ---------------------------------------------------------------------------

/** All subscriptions for a given agent */
export const selectAgentSubscriptions = store.createSelector<[workspaceId: string, agentId: string], Subscription[]>(
  (state, workspaceId, agentId) => {
    return selectEntry.select(state, workspaceId, agentId).subscriptions;
  },
);

/** Delegation groups for a given agent */
export const selectDelegationGroups = store.createSelector<
  [workspaceId: string, agentId: string],
  DelegationGroupStatus[]
>((state, workspaceId, agentId) => {
  return selectEntry.select(state, workspaceId, agentId).delegationGroups;
});

/** Current waiting state ('idle' | 'waiting' | 'woken') */
export const selectWaitingState = store.createSelector<[workspaceId: string, agentId: string], WaitingState>(
  (state, workspaceId, agentId) => {
    return selectEntry.select(state, workspaceId, agentId).waitingState;
  },
);

/** Woken-up info or null */
export const selectWokenUpInfo = store.createSelector<[workspaceId: string, agentId: string], WokenUpInfo | null>(
  (state, workspaceId, agentId) => {
    return selectEntry.select(state, workspaceId, agentId).wokenUpInfo;
  },
);

/**
 * Whether to show the subscription row in the UI.
 * True if there are any subscriptions or delegation groups,
 * or if the entry is in the 'completed' transitional state.
 */
export const selectShowSubscriptionRow = store.createSelector<[workspaceId: string, agentId: string], boolean>(
  (state, workspaceId, agentId) => {
    const entry = selectEntry.select(state, workspaceId, agentId);
    if (entry.waitingState === 'completed') return true;
    return entry.subscriptions.length > 0 || entry.delegationGroups.length > 0;
  },
);

/**
 * All agent IDs that have entries in the subscription UI for a given workspace.
 * Used by sagas to refresh all tracked agents on system-level events.
 */
export const selectTrackedAgentIds = store.createSelector<[workspaceId: string], string[]>(
  (state, workspaceId) => {
    const prefix = `${workspaceId}:`;
    const agentIds: string[] = [];
    for (const key of Object.keys(state.agentSubscriptionUI.entries)) {
      if (key.startsWith(prefix)) {
        agentIds.push(key.slice(prefix.length));
      }
    }
    return agentIds;
  },
);

/**
 * Completion status across all delegation groups.
 * Returns { total, completed } counting all expected agents.
 */
export const selectCompletionStatus = store.createSelector<
  [workspaceId: string, agentId: string],
  { total: number; completed: number }
>((state, workspaceId, agentId) => {
  const groups = selectDelegationGroups.select(state, workspaceId, agentId);
  let total = 0;
  let completed = 0;
  for (const group of groups) {
    total += group.expectedAgentIds.length;
    completed += group.completedAgentIds.length + group.deletedAgentIds.length;
  }
  return { total, completed };
});
