/**
 * Saga trigger actions for the agent-subscriptions slice.
 *
 * These actions are dispatched by external code (services, IPC handlers) to
 * trigger saga workflows. They have no reducer — sagas `takeEvery` on them.
 */

import { createAction } from "../../../utils/create-action";
import type { WorkspaceEvent } from "../../../../../features/events/types";

// ---------------------------------------------------------------------------
// Delivery triggers
// ---------------------------------------------------------------------------

/** Request immediate delivery of specific events to an agent. */
export const requestDeliverEvents = createAction<
  [wsId: string, agentId: string, events: WorkspaceEvent[]]
>("agentSubscriptions/requestDeliverEvents");

/** Request delivery of all queued events for an agent. */
export const requestDeliverQueuedEvents = createAction<
  [wsId: string, agentId: string]
>("agentSubscriptions/requestDeliverQueuedEvents");

// ---------------------------------------------------------------------------
// Delegation group triggers
// ---------------------------------------------------------------------------

/** Signal that a delegation group may be complete and ready for delivery. */
export const requestDelegationGroupDelivery = createAction<
  [wsId: string, groupId: string]
>("agentSubscriptions/requestDelegationGroupDelivery");

/** Request async validation of subscriptions against agent persistence. */
export const requestValidateSubscriptions = createAction<[wsId: string]>(
  "agentSubscriptions/requestValidateSubscriptions"
);

// ---------------------------------------------------------------------------
// Cleanup triggers
// ---------------------------------------------------------------------------

/** Request eviction of stale deleted agents. */
export const requestEvictStaleAgents = createAction<[wsId: string]>(
  "agentSubscriptions/requestEvictStaleAgents"
);

