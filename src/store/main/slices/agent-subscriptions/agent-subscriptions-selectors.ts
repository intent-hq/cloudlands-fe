/**
 * Selectors for the agent-subscriptions slice.
 *
 * Selectors are created from the configured main-process StreamingStore.
 * Passing RendererStoreState is a compile error.
 */

import { store } from "../../configured-store";
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

export const selectWorkspaceSubscriptionState = store.createSelector(
  (state, wsId: string): WorkspaceSubscriptionState => {
    const slice = state?.agentSubscriptions;
    return slice.byWorkspaceId[wsId] ?? emptyWorkspaceSubscriptionState;
  },
);

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const selectSubscription = store.createSelector(
  (state, wsId: string, subId: string): AgentSubscriptionRecord | undefined => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.subscriptions[subId];
  },
);

export const selectAgentSubscriptions = store.createSelector(
  (state, wsId: string, agentId: string): AgentSubscriptionRecord[] => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return Object.values(ws.subscriptions).filter((sub) => sub.agentId === agentId);
  },
);

export const selectAllSubscriptions = store.createSelector(
  (state, wsId: string): AgentSubscriptionRecord[] => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return Object.values(ws.subscriptions);
  },
);

// ---------------------------------------------------------------------------
// Agent status
// ---------------------------------------------------------------------------

export const selectAgentStatus = store.createSelector(
  (state, wsId: string, agentId: string): AgentStatus => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.agentStatuses[agentId] ?? "idle";
  },
);

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export const selectAgentQueue = store.createSelector(
  (state, wsId: string, agentId: string): QueuedEventRecord[] => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.agentQueues[agentId] ?? [];
  },
);

export const selectAgentQueueLength = store.createSelector(
  (state, wsId: string, agentId: string): number => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return (ws.agentQueues[agentId] ?? []).length;
  },
);

// ---------------------------------------------------------------------------
// Delegation groups
// ---------------------------------------------------------------------------

export const selectDelegationGroup = store.createSelector(
  (
    state,
    wsId: string,
    groupId: string,
  ): DelegationGroupTrackerRecord | undefined => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.delegationGroups[groupId];
  },
);

export const selectDelegationGroupsForParent = store.createSelector(
  (
    state,
    wsId: string,
    parentAgentId: string,
  ): DelegationGroupTrackerRecord[] => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return Object.values(ws.delegationGroups).filter(
      (group) => group.parentAgentId === parentAgentId,
    );
  },
);

export function getDelegationGroupCompletionSummary(
  group: DelegationGroupTrackerRecord,
): { doneCount: number; expectedCount: number; isComplete: boolean } {
  const expectedIds = new Set(group.expectedAgentIds);
  const doneIds = new Set<string>();
  for (const agentId of group.completedAgentIds) {
    if (expectedIds.has(agentId)) doneIds.add(agentId);
  }
  for (const agentId of group.deletedAgentIds) {
    if (expectedIds.has(agentId)) doneIds.add(agentId);
  }

  const expectedCount = expectedIds.size;
  const doneCount = doneIds.size;
  const isComplete = expectedCount > 0 && (
    group.awaitMode === "any"
      ? doneCount >= 1
      : doneCount >= expectedCount
  );
  return { doneCount, expectedCount, isComplete };
}

export const selectIsDelegationGroupComplete = store.createSelector(
  (state, wsId: string, groupId: string): boolean => {
    const group = selectDelegationGroup.select(state, wsId, groupId);
    if (!group) return false;
    return getDelegationGroupCompletionSummary(group).isComplete;
  },
);

// ---------------------------------------------------------------------------
// One-shot guards
// ---------------------------------------------------------------------------

export const selectIsOneShotFired = store.createSelector(
  (state, wsId: string, subscriptionId: string): boolean => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.firedOneShotSubscriptions.includes(subscriptionId);
  },
);

// ---------------------------------------------------------------------------
// Deleted agents
// ---------------------------------------------------------------------------

export const selectIsAgentDeleted = store.createSelector(
  (state, wsId: string, agentId: string): boolean => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return agentId in ws.deletedAgents;
  },
);

// ---------------------------------------------------------------------------
// All workspace IDs (for periodic sweeps)
// ---------------------------------------------------------------------------

export const selectAllWorkspaceIds = store.createSelector(
  (state): string[] => {
    const slice = state?.agentSubscriptions;
    if (!slice) return [];
    return Object.keys(slice.byWorkspaceId);
  },
);

// ---------------------------------------------------------------------------
// Subscriptions signature (structural snapshot for change detection)
// ---------------------------------------------------------------------------

/**
 * A DelegationGroupTracker with the `events` array removed. Used inside the
 * subscriptions signature so that `appendDelegationGroupEvent` (which only
 * grows `events`) does not trigger the subscriptions-changed emitter.
 */
interface TrackerCore {
  groupId: string;
  parentAgentId: string;
  parentAgentName: string;
  awaitMode: "any" | "all";
  expectedAgentIds: string[];
  completedAgentIds: string[];
  deletedAgentIds: string[];
  subscriptionId: string;
  delivered: boolean;
}

/**
 * Composite per-workspace signature of the subscriptions slice. Every field
 * except `delegationGroups[*].events` participates; a change to any of these
 * fields causes the subscriptions-changed emitter saga to fire exactly once.
 */
export interface SubscriptionsSignature {
  subscriptions: Record<string, AgentSubscriptionRecord>;
  delegationGroups: Record<string, TrackerCore>;
  agentStatuses: Record<string, AgentStatus>;
  deliveryStats: DeliveryStats;
  deletedAgents: Record<string, number>;
  firedOneShotSubscriptions: string[];
}

export const selectSubscriptionsSignature = store.createSelector(
  (state, wsId: string): SubscriptionsSignature | null => {
    const slice = state.agentSubscriptions;
    const ws = slice.byWorkspaceId[wsId];
    if (!ws) return null;
    const delegationGroups: Record<string, TrackerCore> = {};
    for (const [id, tracker] of Object.entries(
      ws.delegationGroups as Record<string, DelegationGroupTrackerRecord>,
    )) {
      const { events: _events, ...core } = tracker;
      delegationGroups[id] = core;
    }
    return {
      subscriptions: ws.subscriptions,
      delegationGroups,
      agentStatuses: ws.agentStatuses,
      deliveryStats: ws.deliveryStats,
      deletedAgents: ws.deletedAgents,
      firedOneShotSubscriptions: ws.firedOneShotSubscriptions,
    };
  },
);

