/**
 * Delegation group saga — handles "wait for all" delegation group completion.
 *
 * Replaces the imperative `handleDelegationGroupEvent()` and
 * `queueDelegationGroupEvents()` from AgentEventSubscriptionService.
 *
 * When a delegation group completes (all expected agents completed/deleted),
 * this saga triggers delivery to the parent agent with all accumulated events.
 */

import { call, put, select, takeEvery, delay } from "typed-redux-saga";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import { Logger } from "../../../../../shared/logger";
import {
  markDelegationAgentCompleted,
  markDelegationAgentDeleted,
  markDelegationDelivered,
  removeDelegationGroup,
  removeSubscription,
  bumpVersion,
} from "../agent-subscriptions-slice";
import {
  selectDelegationGroup,
  selectAgentStatus,
  selectIsDelegationGroupComplete,
} from "../agent-subscriptions-selectors";
import {
  requestDelegationGroupDelivery,
  requestDeliverEvents,
  requestPersist,
} from "./saga-actions";
import { handleDeliverEvents } from "./delivery-saga";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const logger = new Logger("DelegationGroupSaga");

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MAX_IDLE_RETRIES = 3;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const IDLE_RETRY_DELAY_MS = 2000;
const MAX_BUSY_POLL_ATTEMPTS = 120;
const BUSY_POLL_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Handle delegation group completion check
// ---------------------------------------------------------------------------

export function* handleDelegationGroupDelivery(
  action: ReturnType<typeof requestDelegationGroupDelivery>,
) {
  const [wsId, groupId] = action.payload;

  const tracker = yield* select(
    selectDelegationGroup.select,
    wsId,
    groupId,
  );
  if (!tracker) return;

  // Already delivered — guard against double-delivery
  if (tracker.delivered) return;

  // Check if all agents have completed
  const isComplete: boolean = yield* select(
    selectIsDelegationGroupComplete.select,
    wsId,
    groupId,
  );
  if (!isComplete) return;

  logger.debug(`[subscriptions] delegation-complete subscriptionId=${tracker.subscriptionId} agentId=${tracker.parentAgentId} workspaceId=${wsId} groupId=${groupId} eventCount=${tracker.events.length} completedAgents=${tracker.completedAgentIds.length} deletedAgents=${tracker.deletedAgentIds.length} step=deliver`);

  // Mark as delivered to prevent re-entry
  yield* put(markDelegationDelivered(wsId, groupId));

  // Add completion metadata to events
  const completionStatus =
    tracker.deletedAgentIds.length > 0 ? "partial" : "completed";
  const eventsWithMetadata = tracker.events.map((e) => ({
    ...e,
    metadata: {
      ...(e as any).metadata,
      delegationGroupId: groupId,
      completionStatus,
      deletedAgentCount: tracker.deletedAgentIds.length,
    },
  })) as unknown as WorkspaceEvent[];

  const parentAgentId = tracker.parentAgentId;

  // Check parent agent status
  const parentStatus: string = yield* select(
    selectAgentStatus.select,
    wsId,
    parentAgentId,
  );

  if (parentStatus === "idle") {
    // Deliver immediately with bounded retry
    yield* call(
      deliverWithRetry,
      wsId,
      parentAgentId,
      eventsWithMetadata,
      groupId,
      tracker.subscriptionId,
    );
  } else {
    // Parent is busy — poll until idle with bounded attempts
    yield* call(
      pollAndDeliver,
      wsId,
      parentAgentId,
      eventsWithMetadata,
      groupId,
      tracker.subscriptionId,
    );
  }
}

// ---------------------------------------------------------------------------
// Delivery helpers
// ---------------------------------------------------------------------------

function* deliverWithRetry(
  wsId: string,
  agentId: string,
  events: WorkspaceEvent[],
  groupId: string,
  subscriptionId: string,
) {
  // Call delivery directly so we block until it completes (or fails).
  // This ensures cleanup only happens after the delivery attempt finishes.
  try {
    logger.debug(`[subscriptions] deliver subscriptionId=${subscriptionId} agentId=${agentId} workspaceId=${wsId} groupId=${groupId} eventCount=${events.length} step=deliver`);
    yield* call(
      handleDeliverEvents,
      requestDeliverEvents(wsId, agentId, events),
    );
  } catch (err) {
    logger.error(`[subscriptions] deliver subscriptionId=${subscriptionId} agentId=${agentId} workspaceId=${wsId} groupId=${groupId} step=deliver error=${err instanceof Error ? err.message : String(err)}`);
  }

  // Clean up delegation group and subscription regardless of delivery outcome
  // to prevent permanent stuck state
  logger.debug(`[subscriptions] cleanup subscriptionId=${subscriptionId} agentId=${agentId} workspaceId=${wsId} groupId=${groupId} step=cleanup`);
  yield* put(removeDelegationGroup(wsId, groupId));
  if (subscriptionId) {
    yield* put(removeSubscription(wsId, subscriptionId));
  }
  yield* put(bumpVersion(wsId));
  yield* put(requestPersist(wsId));
}

function* pollAndDeliver(
  wsId: string,
  agentId: string,
  events: WorkspaceEvent[],
  groupId: string,
  subscriptionId: string,
) {
  for (let attempt = 0; attempt < MAX_BUSY_POLL_ATTEMPTS; attempt++) {
    yield* delay(BUSY_POLL_INTERVAL_MS);

    const status: string = yield* select(
      selectAgentStatus.select,
      wsId,
      agentId,
    );
    if (status === "idle") {
      yield* call(
        deliverWithRetry,
        wsId,
        agentId,
        events,
        groupId,
        subscriptionId,
      );
      return;
    }
  }

  // Budget exhausted — log warning and clean up to prevent lingering UI
  const totalWaitSeconds = (MAX_BUSY_POLL_ATTEMPTS * BUSY_POLL_INTERVAL_MS) / 1000;
  logger.warn(`[subscriptions] deliver subscriptionId=${subscriptionId} agentId=${agentId} workspaceId=${wsId} groupId=${groupId} step=deliver status=timeout totalWaitSeconds=${totalWaitSeconds}`);
  yield* put(removeDelegationGroup(wsId, groupId));
  if (subscriptionId) {
    yield* put(removeSubscription(wsId, subscriptionId));
  }
  yield* put(bumpVersion(wsId));
  yield* put(requestPersist(wsId));
}


// ---------------------------------------------------------------------------
// Watch for delegation agent completion → check group
// ---------------------------------------------------------------------------

export function* watchDelegationAgentCompleted() {
  yield* takeEvery(markDelegationAgentCompleted, function* (action) {
    const [wsId, groupId] = action.payload;
    yield* put(requestDelegationGroupDelivery(wsId, groupId));
  });
}

export function* watchDelegationAgentDeleted() {
  yield* takeEvery(markDelegationAgentDeleted, function* (action) {
    const [wsId, groupId] = action.payload;
    yield* put(requestDelegationGroupDelivery(wsId, groupId));
  });
}

// ---------------------------------------------------------------------------
// Root delegation group saga
// ---------------------------------------------------------------------------

export function* delegationGroupSaga() {
  yield* takeEvery(
    requestDelegationGroupDelivery,
    handleDelegationGroupDelivery,
  );
  yield* watchDelegationAgentCompleted();
  yield* watchDelegationAgentDeleted();
}