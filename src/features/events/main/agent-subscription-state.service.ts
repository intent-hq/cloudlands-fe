import {
  addSubscription,
  agentSubscriptionsReducer,
  markAgentDeleted,
  removeAllSubscriptions,
  removeSubscription,
  setAgentStatus,
  setDelegationGroup,
  subscribeToDelegationGroup,
  initialState,
} from '../../../store/main/slices/agent-subscriptions/agent-subscriptions-slice';
import type {
  AgentStatus,
  AgentSubscriptionRecord,
  AgentSubscriptionsState,
  DelegationGroupTrackerRecord,
  WorkspaceSubscriptionState,
} from '../../../store/main/slices/agent-subscriptions/types';
import { emptyWorkspaceSubscriptionState } from '../../../store/main/slices/agent-subscriptions/types';

let state: AgentSubscriptionsState = initialState;

function reduce(action: { type: string; payload?: unknown }): void {
  state = agentSubscriptionsReducer(state, action);
}

export function getWorkspaceSubscriptionState(workspaceId: string): WorkspaceSubscriptionState {
  return state.byWorkspaceId[workspaceId] ?? emptyWorkspaceSubscriptionState;
}

export function getAgentSubscriptions(
  workspaceId: string,
  agentId: string,
): AgentSubscriptionRecord[] {
  return Object.values(getWorkspaceSubscriptionState(workspaceId).subscriptions).filter(
    (subscription) => subscription.agentId === agentId,
  );
}

export function getDelegationGroupsForParent(
  workspaceId: string,
  agentId: string,
): DelegationGroupTrackerRecord[] {
  return Object.values(getWorkspaceSubscriptionState(workspaceId).delegationGroups).filter(
    (group) => group.parentAgentId === agentId,
  );
}

export function getAgentSubscriptionStatus(workspaceId: string, agentId: string): AgentStatus {
  return getWorkspaceSubscriptionState(workspaceId).agentStatuses[agentId] ?? 'idle';
}

export function isAgentDeleted(workspaceId: string, agentId: string): boolean {
  return agentId in getWorkspaceSubscriptionState(workspaceId).deletedAgents;
}

export const agentSubscriptionState = {
  add: (workspaceId: string, subscription: AgentSubscriptionRecord) =>
    reduce(addSubscription(workspaceId, subscription)),
  subscribeToGroup: (workspaceId: string, seed: AgentSubscriptionRecord) =>
    reduce(subscribeToDelegationGroup(workspaceId, seed)),
  remove: (workspaceId: string, subscriptionId: string) =>
    reduce(removeSubscription(workspaceId, subscriptionId)),
  removeAll: (workspaceId: string, agentId: string) =>
    reduce(removeAllSubscriptions(workspaceId, agentId)),
  setStatus: (workspaceId: string, agentId: string, status: AgentStatus) =>
    reduce(setAgentStatus(workspaceId, agentId, status)),
  setDelegationGroup: (workspaceId: string, tracker: DelegationGroupTrackerRecord) =>
    reduce(setDelegationGroup(workspaceId, tracker)),
  markDeleted: (workspaceId: string, agentId: string, deletedAt: number) =>
    reduce(markAgentDeleted(workspaceId, agentId, deletedAt)),
};

/** @internal Test-only reset for the process-local service. */
export function resetAgentSubscriptionState(): void {
  state = initialState;
}
