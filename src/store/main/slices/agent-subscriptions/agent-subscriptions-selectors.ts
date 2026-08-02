/**
 * Selectors for the agent-subscriptions slice.
 *
 * Plain selectors invoked with an explicit main-process state snapshot.
 */

import { createMainSelector } from "../../create-main-selector";
import type {
  WorkspaceSubscriptionState,
  AgentSubscriptionRecord,
  DelegationGroupTrackerRecord,
  QueuedEventRecord,
  AgentStatus,
} from "./types";
import { emptyWorkspaceSubscriptionState } from "./types";

// ---------------------------------------------------------------------------
// Workspace-level
// ---------------------------------------------------------------------------

export const selectWorkspaceSubscriptionState = createMainSelector(
  (state, wsId: string): WorkspaceSubscriptionState => {
    const slice = state?.agentSubscriptions;
    return slice.byWorkspaceId[wsId] ?? emptyWorkspaceSubscriptionState;
  },
);

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const selectSubscription = createMainSelector(
  (state, wsId: string, subId: string): AgentSubscriptionRecord | undefined => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.subscriptions[subId];
  },
);

export const selectAgentSubscriptions = createMainSelector(
  (state, wsId: string, agentId: string): AgentSubscriptionRecord[] => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return Object.values(ws.subscriptions).filter((sub) => sub.agentId === agentId);
  },
);

export const selectAllSubscriptions = createMainSelector(
  (state, wsId: string): AgentSubscriptionRecord[] => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return Object.values(ws.subscriptions);
  },
);

// ---------------------------------------------------------------------------
// Agent status
// ---------------------------------------------------------------------------

export const selectAgentStatus = createMainSelector(
  (state, wsId: string, agentId: string): AgentStatus => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.agentStatuses[agentId] ?? "idle";
  },
);

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export const selectAgentQueue = createMainSelector(
  (state, wsId: string, agentId: string): QueuedEventRecord[] => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.agentQueues[agentId] ?? [];
  },
);

export const selectAgentQueueLength = createMainSelector(
  (state, wsId: string, agentId: string): number => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return (ws.agentQueues[agentId] ?? []).length;
  },
);

// ---------------------------------------------------------------------------
// Delegation groups
// ---------------------------------------------------------------------------

export const selectDelegationGroup = createMainSelector(
  (
    state,
    wsId: string,
    groupId: string,
  ): DelegationGroupTrackerRecord | undefined => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.delegationGroups[groupId];
  },
);

export const selectDelegationGroupsForParent = createMainSelector(
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

export const selectIsDelegationGroupComplete = createMainSelector(
  (state, wsId: string, groupId: string): boolean => {
    const group = selectDelegationGroup.select(state, wsId, groupId);
    if (!group) return false;
    return getDelegationGroupCompletionSummary(group).isComplete;
  },
);

// ---------------------------------------------------------------------------
// Deleted agents
// ---------------------------------------------------------------------------

export const selectIsAgentDeleted = createMainSelector(
  (state, wsId: string, agentId: string): boolean => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return agentId in ws.deletedAgents;
  },
);

// ---------------------------------------------------------------------------
// All workspace IDs (for periodic sweeps)
// ---------------------------------------------------------------------------

export const selectAllWorkspaceIds = createMainSelector(
  (state): string[] => {
    const slice = state?.agentSubscriptions;
    if (!slice) return [];
    return Object.keys(slice.byWorkspaceId);
  },
);

