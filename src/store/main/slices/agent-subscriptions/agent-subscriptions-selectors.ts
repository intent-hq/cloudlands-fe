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
import { getRawValue } from "../../../utils/create-cached-selector";

// ---------------------------------------------------------------------------
// Workspace-level
// ---------------------------------------------------------------------------

export const selectWorkspaceSubscriptionState = createSelector(
  (state: MainStoreState, wsId: string): WorkspaceSubscriptionState => {
    const slice = state?.agentSubscriptions;
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
    if (group.awaitMode === "any") {
      return doneCount >= 1;
    }
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
// All workspace IDs (for periodic sweeps)
// ---------------------------------------------------------------------------

export const selectAllWorkspaceIds = createSelector(
  (state: MainStoreState): string[] => {
    const slice = state?.agentSubscriptions;
    if (!slice) return [];
    return Object.keys(slice.byWorkspaceId);
  },
);

// ---------------------------------------------------------------------------
// Raw (uncached) subscription read — used by matching saga to avoid stale
// reads caused by createCachedSelector proxy interactions.
// ---------------------------------------------------------------------------

export function selectAllSubscriptionsRaw(state: MainStoreState, wsId: string): AgentSubscriptionRecord[] {
  const slice = state?.agentSubscriptions;
  if (!slice) return [];
  const ws = slice.byWorkspaceId[wsId];
  if (!ws) return [];
  return Object.values(ws.subscriptions);
}

/**
 * Raw (uncached) subscription read — used by delegation-group-saga to
 * avoid stale reads caused by createCachedSelector proxy interactions.
 */
export function selectSubscriptionRaw(
  state: MainStoreState,
  wsId: string,
  subId: string,
): AgentSubscriptionRecord | undefined {
  const slice = state.agentSubscriptions;
  const ws = slice.byWorkspaceId[wsId];
  if (!ws) return undefined;
  return ws.subscriptions[subId];
}

/**
 * Raw (uncached) delegation group read — used by delegation-group-saga to
 * avoid stale reads caused by createCachedSelector proxy interactions.
 */
export function selectDelegationGroupRaw(
  state: MainStoreState,
  wsId: string,
  groupId: string,
): DelegationGroupTrackerRecord | undefined {
  const slice = state.agentSubscriptions;
  const ws = slice.byWorkspaceId[wsId];
  if (!ws) return undefined;
  return ws.delegationGroups[groupId];
}

/**
 * Raw (uncached) delegation group completion check — used by delegation-group-saga
 * to avoid stale reads caused by createCachedSelector proxy interactions.
 */
export function selectIsDelegationGroupCompleteRaw(
  state: MainStoreState,
  wsId: string,
  groupId: string,
): boolean {
  const group = selectDelegationGroupRaw(state, wsId, groupId);
  if (!group) return false;
  const doneCount = group.completedAgentIds.length + group.deletedAgentIds.length;
  if (group.awaitMode === "any") {
    return doneCount >= 1;
  }
  return doneCount >= group.expectedAgentIds.length;
}

// ---------------------------------------------------------------------------
// Delivery stats
// ---------------------------------------------------------------------------

export const selectDeliveryStats = createSelector(
  (state: MainStoreState, wsId: string): DeliveryStats => {
    const ws = selectWorkspaceSubscriptionState.select(state, wsId);
    return ws.deliveryStats;
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
export interface TrackerCore {
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

export const selectSubscriptionsSignature = createSelector(
  (state: MainStoreState, wsId: string): SubscriptionsSignature | null => {
    const slice = state.agentSubscriptions;
    const ws = slice.byWorkspaceId[wsId];
    if (!ws) return null;
    const delegationGroups: Record<string, TrackerCore> = {};
    for (const [id, tracker] of Object.entries(
      ws.delegationGroups as Record<string, DelegationGroupTrackerRecord>,
    )) {
      const { events: _events, ...core } = getRawValue(tracker);
      delegationGroups[id] = core;
    }
    return {
      subscriptions: getRawValue(ws.subscriptions),
      delegationGroups,
      agentStatuses: getRawValue(ws.agentStatuses),
      deliveryStats: getRawValue(ws.deliveryStats),
      deletedAgents: getRawValue(ws.deletedAgents),
      firedOneShotSubscriptions: getRawValue(ws.firedOneShotSubscriptions),
    };
  },
);

