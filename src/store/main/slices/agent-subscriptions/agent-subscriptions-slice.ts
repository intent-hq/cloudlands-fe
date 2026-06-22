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

import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";
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
  AgentSubscriptionsState,
} from "./types";
import {
  emptyWorkspaceSubscriptionState,
  initialState,
} from "./types";


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

export const removeSubscription = createAction<[wsId: string, subscriptionId: string]>(
  "agentSubscriptions/removeSubscription"
);

/**
 * Atomically find-or-create the delegation-group subscription for a
 * `(parentAgentId, groupId)` pair and extend its filter + tracker with
 * `delegatedAgentId`.
 *
 * `seed` is the fully-formed `AgentSubscriptionRecord` the caller would use
 * if no prior subscription existed. When a matching subscription is already
 * present, the reducer IGNORES `seed.id`/`seed.createdAt` and instead adds
 * the delegated agent (add-to-set) to the existing sub's `filter.actorIds`
 * and `filter.delegationGroup.expectedAgentIds`. The delegation-group
 * tracker in `delegationGroups[groupId]` is created or extended in the same
 * reducer case, so the subscription and tracker can never drift apart.
 *
 * This action replaces the two-step `addSubscription` + `setDelegationGroup`
 * sequence that was vulnerable to races when N concurrent callers all
 * observed the same "no existing subscription" snapshot and each dispatched
 * a fresh `addSubscription`, producing N duplicate subscriptions for the
 * same `groupId`.
 */
export const subscribeToDelegationGroup = createAction<
  [wsId: string, seed: AgentSubscriptionRecord]
>("agentSubscriptions/subscribeToDelegationGroup");

export const removeAllSubscriptions = createAction<[wsId: string, agentId: string]>(
  "agentSubscriptions/removeAllSubscriptions"
);

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
export const recordDeliverySuccess = createAction<
  [wsId: string, observedAt?: string],
  [wsId: string, observedAt: string]
>(
  "agentSubscriptions/recordDeliverySuccess",
  (wsId, observedAt) => [wsId, observedAt ?? new Date().toISOString()]
);

export const recordDeliveryFailure = createAction<
  [wsId: string, observedAt?: string],
  [wsId: string, observedAt: string]
>(
  "agentSubscriptions/recordDeliveryFailure",
  (wsId, observedAt) => [wsId, observedAt ?? new Date().toISOString()]
);

export const recordDeliveryTimeout = createAction<
  [wsId: string, observedAt?: string],
  [wsId: string, observedAt: string]
>(
  "agentSubscriptions/recordDeliveryTimeout",
  (wsId, observedAt) => [wsId, observedAt ?? new Date().toISOString()]
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

// --- Workspace cleanup ---
export const clearWorkspace = createAction<[wsId: string]>(
  "agentSubscriptions/clearWorkspace"
);

// --- Saga workflow triggers ---

/** Request immediate delivery of specific events to an agent. */
export const requestDeliverEvents = createAction<
  [wsId: string, agentId: string, events: WorkspaceEvent[]]
>("agentSubscriptions/requestDeliverEvents");

/** Request delivery of all queued events for an agent. */
export const requestDeliverQueuedEvents = createAction<
  [wsId: string, agentId: string]
>("agentSubscriptions/requestDeliverQueuedEvents");

/** Signal that a delegation group may be complete and ready for delivery. */
export const requestDelegationGroupDelivery = createAction<
  [wsId: string, groupId: string]
>("agentSubscriptions/requestDelegationGroupDelivery");

/** Request async validation of subscriptions against agent persistence. */
export const requestValidateSubscriptions = createAction<[wsId: string]>(
  "agentSubscriptions/requestValidateSubscriptions"
);

/** Request eviction of stale deleted agents. */
export const requestEvictStaleAgents = createAction<[wsId: string]>(
  "agentSubscriptions/requestEvictStaleAgents"
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
  .with(subscribeToDelegationGroup, (state, { payload: [wsId, seed] }) => {
    const groupId = seed.filter.delegationGroup?.groupId;
    if (!groupId) return state;
    const delegatedAgentId = seed.filter.delegationGroup?.expectedAgentIds[0];
    if (!delegatedAgentId) return state;
    const ws = getWorkspaceState(state, wsId);

    const existing = Object.values(ws.subscriptions).find(
      s => s.agentId === seed.agentId && s.filter.delegationGroup?.groupId === groupId,
    );

    let nextSubscriptions = ws.subscriptions;
    let canonicalSubId: string;

    if (existing) {
      canonicalSubId = existing.id;
      const currentActorIds = existing.filter.actorIds ?? [];
      const dg = existing.filter.delegationGroup!;
      const actorAlready = currentActorIds.includes(delegatedAgentId);
      const dgAlready = dg.expectedAgentIds.includes(delegatedAgentId);
      if (!actorAlready || !dgAlready) {
        const nextActorIds = actorAlready
          ? currentActorIds
          : [...currentActorIds, delegatedAgentId];
        const nextExpected = dgAlready
          ? dg.expectedAgentIds
          : [...dg.expectedAgentIds, delegatedAgentId];
        nextSubscriptions = {
          ...ws.subscriptions,
          [existing.id]: {
            ...existing,
            filter: {
              ...existing.filter,
              actorIds: nextActorIds,
              delegationGroup: { ...dg, expectedAgentIds: nextExpected },
            },
          },
        };
      }
    } else {
      canonicalSubId = seed.id;
      nextSubscriptions = { ...ws.subscriptions, [seed.id]: seed };
    }

    const existingTracker = ws.delegationGroups[groupId];
    let nextDelegationGroups = ws.delegationGroups;
    if (existingTracker) {
      if (!existingTracker.expectedAgentIds.includes(delegatedAgentId)) {
        nextDelegationGroups = {
          ...ws.delegationGroups,
          [groupId]: {
            ...existingTracker,
            expectedAgentIds: [...existingTracker.expectedAgentIds, delegatedAgentId],
          },
        };
      }
    } else {
      const dgSeed = seed.filter.delegationGroup!;
      nextDelegationGroups = {
        ...ws.delegationGroups,
        [groupId]: {
          groupId,
          parentAgentId: seed.agentId,
          parentAgentName: seed.agentName,
          awaitMode: dgSeed.awaitMode,
          expectedAgentIds: [delegatedAgentId],
          completedAgentIds: [],
          deletedAgentIds: [],
          events: [],
          subscriptionId: canonicalSubId,
          delivered: false,
        },
      };
    }

    if (
      nextSubscriptions === ws.subscriptions &&
      nextDelegationGroups === ws.delegationGroups
    ) {
      return state;
    }
    return setWorkspaceState(state, wsId, {
      ...ws,
      subscriptions: nextSubscriptions,
      delegationGroups: nextDelegationGroups,
    });
  })
  .with(removeSubscription, (state, { payload: [wsId, subscriptionId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!ws.subscriptions[subscriptionId]) return state;

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

    const { [agentId]: _q, ...queues } = ws.agentQueues;

    const { [agentId]: _s, ...statuses } = ws.agentStatuses;
    return setWorkspaceState(state, wsId, {
      ...ws,
      subscriptions: subs,
      delegationGroups: groups,
      agentQueues: queues,
      agentStatuses: statuses,
    });
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

    const { [groupId]: _removed, ...rest } = ws.delegationGroups;
    return setWorkspaceState(state, wsId, { ...ws, delegationGroups: rest });
  })
  .with(markDelegationAgentCompleted, (state, { payload: [wsId, groupId, agentId] }) => {
    const ws = getWorkspaceState(state, wsId);
    const tracker = ws.delegationGroups[groupId];
    if (!tracker) return state;
    if (!tracker.expectedAgentIds.includes(agentId)) return state;
    if (tracker.completedAgentIds.includes(agentId)) return state;
    if (tracker.deletedAgentIds.includes(agentId)) return state;
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
    if (!tracker.expectedAgentIds.includes(agentId)) return state;
    if (tracker.deletedAgentIds.includes(agentId)) return state;
    if (tracker.completedAgentIds.includes(agentId)) return state;
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
  .with(recordDeliverySuccess, (state, { payload: [wsId, observedAt] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      deliveryStats: {
        ...ws.deliveryStats,
        totalDeliveries: ws.deliveryStats.totalDeliveries + 1,
        successfulDeliveries: ws.deliveryStats.successfulDeliveries + 1,
        lastDeliveryTime: observedAt,
      },
    });
  })
  .with(recordDeliveryFailure, (state, { payload: [wsId, observedAt] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      deliveryStats: {
        ...ws.deliveryStats,
        totalDeliveries: ws.deliveryStats.totalDeliveries + 1,
        failedDeliveries: ws.deliveryStats.failedDeliveries + 1,
        lastFailureTime: observedAt,
      },
    });
  })
  .with(recordDeliveryTimeout, (state, { payload: [wsId, observedAt] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      deliveryStats: {
        ...ws.deliveryStats,
        totalDeliveries: ws.deliveryStats.totalDeliveries + 1,
        timeoutDeliveries: ws.deliveryStats.timeoutDeliveries + 1,
        lastFailureTime: observedAt,
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

    const { [agentId]: _removed, ...rest } = ws.deletedAgents;
    return setWorkspaceState(state, wsId, { ...ws, deletedAgents: rest });
  })
  // --- Workspace cleanup ---
  .with(clearWorkspace, (state, { payload: [wsId] }) => {
    return clearWorkspaceState(state, wsId);
  });
