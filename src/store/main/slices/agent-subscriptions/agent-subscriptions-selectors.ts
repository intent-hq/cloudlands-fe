/**
 * Selectors for the agent-subscriptions slice.
 *
 * All selectors use the main-process createSelector (typed to MainStoreState,
 * cached, no Svelte Readable). Passing RendererStoreState is a compile error.
 */

import { createSelector } from "../../utils/create-selector";
import type { MainStoreState } from "../../types";
import type {
  WorkspaceSubscriptionState,
  AgentSubscriptionRecord,
  DelegationGroupTrackerRecord,
  QueuedEventRecord,
  AgentStatus,
  DeliveryStats,
} from "./types";
import { emptyWorkspaceSubscriptionState } from "./types";

// ---------------------------------------------------------------------------
// Workspace-level
// ---------------------------------------------------------------------------

export const selectWorkspaceSubscriptionState = createSelector(
  (state: MainStoreState, wsId: string): WorkspaceSubscriptionState => {
    const slice = (state as any).agentSubscriptions;
    if (!slice) return emptyWorkspaceSubscriptionState;
    return slice.byWorkspaceId[wsId] ?? emptyWorkspaceSubscriptionState;
  },
);

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const selectSubscription = createSelector(
  (state: MainStoreState, wsId: string, subId: string): AgentSubscriptionRecord | undefined => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.subscriptions[subId];
  },
);

export const selectAgentSubscriptions = createSelector(
  (state: MainStoreState, wsId: string, agentId: string): AgentSubscriptionRecord[] => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return Object.values(ws.subscriptions).filter((sub) => sub.agentId === agentId);
  },
);

export const selectAllSubscriptions = createSelector(
  (state: MainStoreState, wsId: string): AgentSubscriptionRecord[] => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return Object.values(ws.subscriptions);
  },
);

// ---------------------------------------------------------------------------
// Agent status
// ---------------------------------------------------------------------------

export const selectAgentStatus = createSelector(
  (state: MainStoreState, wsId: string, agentId: string): AgentStatus => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.agentStatuses[agentId] ?? "idle";
  },
);

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export const selectAgentQueue = createSelector(
  (state: MainStoreState, wsId: string, agentId: string): QueuedEventRecord[] => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.agentQueues[agentId] ?? [];
  },
);

export const selectAgentQueueLength = createSelector(
  (state: MainStoreState, wsId: string, agentId: string): number => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return (ws.agentQueues[agentId] ?? []).length;
  },
);

// ---------------------------------------------------------------------------
// Delegation groups
// ---------------------------------------------------------------------------

export const selectDelegationGroup = createSelector(
  (
    state: MainStoreState,
    wsId: string,
    groupId: string,
  ): DelegationGroupTrackerRecord | undefined => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.delegationGroups[groupId];
  },
);

export const selectDelegationGroupsForParent = createSelector(
  (
    state: MainStoreState,
    wsId: string,
    parentAgentId: string,
  ): DelegationGroupTrackerRecord[] => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return Object.values(ws.delegationGroups).filter(
      (group) => group.parentAgentId === parentAgentId,
    );
  },
);

export const selectIsDelegationGroupComplete = createSelector(
  (state: MainStoreState, wsId: string, groupId: string): boolean => {
    const group = selectDelegationGroup.select(state, wsId, groupId);
    if (!group) return false;
    const doneCount = group.completedAgentIds.length + group.deletedAgentIds.length;
    return doneCount >= group.expectedAgentIds.length;
  },
);

// ---------------------------------------------------------------------------
// One-shot guards
// ---------------------------------------------------------------------------

export const selectIsOneShotFired = createSelector(
  (state: MainStoreState, wsId: string, subscriptionId: string): boolean => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.firedOneShotSubscriptions.includes(subscriptionId);
  },
);

// ---------------------------------------------------------------------------
// Deleted agents
// ---------------------------------------------------------------------------

export const selectIsAgentDeleted = createSelector(
  (state: MainStoreState, wsId: string, agentId: string): boolean => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return agentId in ws.deletedAgents;
  },
);

// ---------------------------------------------------------------------------
// Delivery stats
// ---------------------------------------------------------------------------

export const selectDeliveryStats = createSelector(
  (state: MainStoreState, wsId: string): DeliveryStats => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.deliveryStats;
  },
);

