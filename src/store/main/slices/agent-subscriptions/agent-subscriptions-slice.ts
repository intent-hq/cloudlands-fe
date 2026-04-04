/**
 * Agent Subscriptions Redux Slice
 *
 * Manages serializable state for agent event subscriptions, including:
 * - Subscription registry (per workspace)
 * - Agent event queues
 * - Agent statuses
 * - Delegation group trackers
 * - Delivery health stats
 * - Deleted agent tracking
 * - One-shot subscription tracking
 */

import { createAction } from "../../utils/create-action";
import { createReducer } from "../../../utils/create-reducer";
import { createWorkspaceScopedHelpers } from "../../../utils/workspace-scoped";
import type { WorkspaceEvent } from "../../../../features/events/types";

// All types consolidated in ./types.ts — re-export for existing consumers
export type {
  SerializableDataMatcher,
  DelegationGroup,
  AgentEventFilter,
  AgentStatus,
  AgentSubscriptionRecord,
  QueuedEventRecord,
  DelegationGroupTrackerRecord,
  DeliveryStats,
  WorkspaceSubscriptionState,
  AgentSubscriptionsState,
} from "./types";

export { emptyDeliveryStats, emptyWorkspaceSubscriptionState, initialState } from "./types";

import type {
  AgentStatus,
  AgentSubscriptionRecord,
  QueuedEventRecord,
  DelegationGroupTrackerRecord,
  WorkspaceSubscriptionState,
  AgentSubscriptionsState,
} from "./types";
import { emptyWorkspaceSubscriptionState, initialState } from "./types";


// ============================================================================
// Constants
// ============================================================================

/** Maximum number of events stored per delegation group to prevent unbounded growth. */
export const MAX_DELEGATION_GROUP_EVENTS = 500;

// ============================================================================
// Actions
// ============================================================================

// --- Subscription lifecycle ---
export const addSubscription = createAction<[wsId: string, subscription: AgentSubscriptionRecord]>(
  "agentSubscriptions/addSubscription"
);

export const updateSubscription = createAction<[wsId: string, subscription: AgentSubscriptionRecord]>(
  "agentSubscriptions/updateSubscription"
);

export const removeSubscription = createAction<[wsId: string, subscriptionId: string]>(
  "agentSubscriptions/removeSubscription"
);

export const removeAllSubscriptions = createAction<[wsId: string, agentId: string]>(
  "agentSubscriptions/removeAllSubscriptions"
);

// --- Snapshot / bulk replacement ---
export const setSubscriptionsSnapshot = createAction<
  [wsId: string, snapshot: WorkspaceSubscriptionState]
>("agentSubscriptions/setSubscriptionsSnapshot");

// --- Agent status ---
export const setAgentStatus = createAction<[wsId: string, agentId: string, status: AgentStatus]>(
  "agentSubscriptions/setAgentStatus"
);

// --- Agent queues ---
export const enqueueEvent = createAction<[wsId: string, agentId: string, event: QueuedEventRecord]>(
  "agentSubscriptions/enqueueEvent"
);

export const clearAgentQueue = createAction<[wsId: string, agentId: string]>(
  "agentSubscriptions/clearAgentQueue"
);

// --- Delegation groups ---
export const setDelegationGroup = createAction<
  [wsId: string, tracker: DelegationGroupTrackerRecord]
>("agentSubscriptions/setDelegationGroup");

export const removeDelegationGroup = createAction<[wsId: string, groupId: string]>(
  "agentSubscriptions/removeDelegationGroup"
);

export const markDelegationAgentCompleted = createAction<
  [wsId: string, groupId: string, agentId: string]
>("agentSubscriptions/markDelegationAgentCompleted");

export const markDelegationAgentDeleted = createAction<
  [wsId: string, groupId: string, agentId: string]
>("agentSubscriptions/markDelegationAgentDeleted");

export const addAgentToDelegationGroup = createAction<
  [wsId: string, groupId: string, agentId: string]
>("agentSubscriptions/addAgentToDelegationGroup");

export const appendDelegationGroupEvent = createAction<
  [wsId: string, groupId: string, event: WorkspaceEvent]
>("agentSubscriptions/appendDelegationGroupEvent");

export const markDelegationDelivered = createAction<[wsId: string, groupId: string]>(
  "agentSubscriptions/markDelegationDelivered"
);

// --- One-shot tracking ---
export const markOneShotFired = createAction<[wsId: string, subscriptionId: string]>(
  "agentSubscriptions/markOneShotFired"
);

// --- Delivery stats ---
export const recordDeliverySuccess = createAction<[wsId: string]>(
  "agentSubscriptions/recordDeliverySuccess"
);

export const recordDeliveryFailure = createAction<[wsId: string]>(
  "agentSubscriptions/recordDeliveryFailure"
);

export const recordDeliveryTimeout = createAction<[wsId: string]>(
  "agentSubscriptions/recordDeliveryTimeout"
);

export const recordDroppedEvents = createAction<[wsId: string, count: number]>(
  "agentSubscriptions/recordDroppedEvents"
);

// --- Deleted agent tracking ---
export const markAgentDeleted = createAction<[wsId: string, agentId: string, deletedAt: number]>(
  "agentSubscriptions/markAgentDeleted"
);

export const evictDeletedAgent = createAction<[wsId: string, agentId: string]>(
  "agentSubscriptions/evictDeletedAgent"
);

// --- Version bump ---
export const bumpVersion = createAction<[wsId: string]>(
  "agentSubscriptions/bumpVersion"
);

// --- Workspace cleanup ---
export const clearWorkspace = createAction<[wsId: string]>(
  "agentSubscriptions/clearWorkspace"
);

// ============================================================================
// Workspace-scoped helpers
// ============================================================================

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceSubscriptionState);

// ============================================================================
// Reducer
// ============================================================================

export const agentSubscriptionsReducer = createReducer<AgentSubscriptionsState>(initialState)
  // --- Subscription lifecycle ---
  .with(addSubscription, (state, { payload: [wsId, subscription] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      subscriptions: { ...ws.subscriptions, [subscription.id]: subscription },
    });
  })
  .with(updateSubscription, (state, { payload: [wsId, subscription] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!ws.subscriptions[subscription.id]) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      subscriptions: { ...ws.subscriptions, [subscription.id]: subscription },
    });
  })
  .with(removeSubscription, (state, { payload: [wsId, subscriptionId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!ws.subscriptions[subscriptionId]) return state;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [subscriptionId]: _removed, ...rest } = ws.subscriptions;
    return setWorkspaceState(state, wsId, {
      ...ws,
      subscriptions: rest,
      firedOneShotSubscriptions: ws.firedOneShotSubscriptions.filter(id => id !== subscriptionId),
    });
  })
  .with(removeAllSubscriptions, (state, { payload: [wsId, agentId] }) => {
    const ws = getWorkspaceState(state, wsId);
    const subs: Record<string, AgentSubscriptionRecord> = {};
    for (const [id, sub] of Object.entries(ws.subscriptions)) {
      if (sub.agentId !== agentId) subs[id] = sub;
    }
    // Also clean up delegation groups where this agent is parent
    const groups: Record<string, DelegationGroupTrackerRecord> = {};
    for (const [gId, g] of Object.entries(ws.delegationGroups)) {
      if (g.parentAgentId !== agentId) groups[gId] = g;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [agentId]: _q, ...queues } = ws.agentQueues;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [agentId]: _s, ...statuses } = ws.agentStatuses;
    return setWorkspaceState(state, wsId, {
      ...ws,
      subscriptions: subs,
      delegationGroups: groups,
      agentQueues: queues,
      agentStatuses: statuses,
    });
  })
  // --- Snapshot ---
  .with(setSubscriptionsSnapshot, (state, { payload: [wsId, snapshot] }) => {
    return setWorkspaceState(state, wsId, snapshot);
  })
  // --- Agent status ---
  .with(setAgentStatus, (state, { payload: [wsId, agentId, status] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.agentStatuses[agentId] === status) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      agentStatuses: { ...ws.agentStatuses, [agentId]: status },
    });
  })
  // --- Agent queues ---
  .with(enqueueEvent, (state, { payload: [wsId, agentId, event] }) => {
    const ws = getWorkspaceState(state, wsId);
    const existing = ws.agentQueues[agentId] ?? [];
    return setWorkspaceState(state, wsId, {
      ...ws,
      agentQueues: { ...ws.agentQueues, [agentId]: [...existing, event] },
    });
  })
  .with(clearAgentQueue, (state, { payload: [wsId, agentId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!ws.agentQueues[agentId]?.length) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      agentQueues: { ...ws.agentQueues, [agentId]: [] },
    });
  })
  // --- Delegation groups ---
  .with(setDelegationGroup, (state, { payload: [wsId, tracker] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      delegationGroups: { ...ws.delegationGroups, [tracker.groupId]: tracker },
    });
  })
  .with(removeDelegationGroup, (state, { payload: [wsId, groupId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!ws.delegationGroups[groupId]) return state;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [groupId]: _removed, ...rest } = ws.delegationGroups;
    return setWorkspaceState(state, wsId, { ...ws, delegationGroups: rest });
  })
  .with(markDelegationAgentCompleted, (state, { payload: [wsId, groupId, agentId] }) => {
    const ws = getWorkspaceState(state, wsId);
    const tracker = ws.delegationGroups[groupId];
    if (!tracker) return state;
    if (tracker.completedAgentIds.includes(agentId)) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      delegationGroups: {
        ...ws.delegationGroups,
        [groupId]: {
          ...tracker,
          completedAgentIds: [...tracker.completedAgentIds, agentId],
        },
      },
    });
  })
  .with(markDelegationAgentDeleted, (state, { payload: [wsId, groupId, agentId] }) => {
    const ws = getWorkspaceState(state, wsId);
    const tracker = ws.delegationGroups[groupId];
    if (!tracker) return state;
    if (tracker.deletedAgentIds.includes(agentId)) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      delegationGroups: {
        ...ws.delegationGroups,
        [groupId]: {
          ...tracker,
          deletedAgentIds: [...tracker.deletedAgentIds, agentId],
        },
      },
    });
  })
  .with(addAgentToDelegationGroup, (state, { payload: [wsId, groupId, agentId] }) => {
    const ws = getWorkspaceState(state, wsId);
    const tracker = ws.delegationGroups[groupId];
    if (!tracker) return state;
    if (tracker.expectedAgentIds.includes(agentId)) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      delegationGroups: {
        ...ws.delegationGroups,
        [groupId]: {
          ...tracker,
          expectedAgentIds: [...tracker.expectedAgentIds, agentId],
        },
      },
    });
  })
  .with(appendDelegationGroupEvent, (state, { payload: [wsId, groupId, event] }) => {
    const ws = getWorkspaceState(state, wsId);
    const tracker = ws.delegationGroups[groupId];
    if (!tracker) return state;
    const updatedEvents = [...tracker.events, event];
    // Cap events array to prevent unbounded growth
    const cappedEvents = updatedEvents.length > MAX_DELEGATION_GROUP_EVENTS
      ? updatedEvents.slice(-MAX_DELEGATION_GROUP_EVENTS)
      : updatedEvents;
    return setWorkspaceState(state, wsId, {
      ...ws,
      delegationGroups: {
        ...ws.delegationGroups,
        [groupId]: {
          ...tracker,
          events: cappedEvents,
        },
      },
    });
  })
  .with(markDelegationDelivered, (state, { payload: [wsId, groupId] }) => {
    const ws = getWorkspaceState(state, wsId);
    const tracker = ws.delegationGroups[groupId];
    if (!tracker || tracker.delivered) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      delegationGroups: {
        ...ws.delegationGroups,
        [groupId]: { ...tracker, delivered: true },
      },
    });
  })
  // --- One-shot tracking ---
  .with(markOneShotFired, (state, { payload: [wsId, subscriptionId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.firedOneShotSubscriptions.includes(subscriptionId)) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      firedOneShotSubscriptions: [...ws.firedOneShotSubscriptions, subscriptionId],
    });
  })
  // --- Delivery stats ---
  .with(recordDeliverySuccess, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      deliveryStats: {
        ...ws.deliveryStats,
        totalDeliveries: ws.deliveryStats.totalDeliveries + 1,
        successfulDeliveries: ws.deliveryStats.successfulDeliveries + 1,
      },
    });
  })
  .with(recordDeliveryFailure, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      deliveryStats: {
        ...ws.deliveryStats,
        totalDeliveries: ws.deliveryStats.totalDeliveries + 1,
        failedDeliveries: ws.deliveryStats.failedDeliveries + 1,
      },
    });
  })
  .with(recordDeliveryTimeout, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      deliveryStats: {
        ...ws.deliveryStats,
        totalDeliveries: ws.deliveryStats.totalDeliveries + 1,
        timeoutDeliveries: ws.deliveryStats.timeoutDeliveries + 1,
      },
    });
  })
  .with(recordDroppedEvents, (state, { payload: [wsId, count] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      deliveryStats: {
        ...ws.deliveryStats,
        droppedEvents: ws.deliveryStats.droppedEvents + count,
      },
    });
  })
  // --- Deleted agent tracking ---
  .with(markAgentDeleted, (state, { payload: [wsId, agentId, deletedAt] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      deletedAgents: { ...ws.deletedAgents, [agentId]: deletedAt },
    });
  })
  .with(evictDeletedAgent, (state, { payload: [wsId, agentId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!(agentId in ws.deletedAgents)) return state;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [agentId]: _removed, ...rest } = ws.deletedAgents;
    return setWorkspaceState(state, wsId, { ...ws, deletedAgents: rest });
  })
  // --- Version bump ---
  .with(bumpVersion, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, version: ws.version + 1 });
  })
  // --- Workspace cleanup ---
  .with(clearWorkspace, (state, { payload: [wsId] }) => {
    return clearWorkspaceState(state, wsId);
  });
