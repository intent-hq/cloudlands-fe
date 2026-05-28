/**
 * Delegation group saga — handles "wait for all" delegation group completion.
 *
 * Replaces the imperative `handleDelegationGroupEvent()` and
 * `queueDelegationGroupEvents()` from AgentEventSubscriptionService.
 *
 * When a delegation group completes (all expected agents completed/deleted),
 * this saga triggers delivery to the parent agent with all accumulated events.
 */

import {
  call,
  put,
  select,
  take,
  takeEvery,
  delay,
} from "typed-redux-saga";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import { Logger } from "../../../../../shared/logger";
import {
  markDelegationAgentCompleted,
  markDelegationAgentDeleted,
  markDelegationDelivered,
  removeDelegationGroup,
  removeSubscription,
  enqueueEvent,
} from "../agent-subscriptions-slice";
import {
  selectAgentStatus,
  selectDelegationGroupRaw,
  selectIsDelegationGroupCompleteRaw,
  selectSubscriptionRaw,
} from "../agent-subscriptions-selectors";
import {
  requestDelegationGroupDelivery,
  requestDeliverEvents,
  requestDeliverQueuedEvents,
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

/**
 * Dedup keys for subset-invariant warnings, keyed on
 * `${groupId}:${sortedMissingIds.join(",")}`. Prevents the saga from flooding
 * the log every time it runs against a desynced tracker/subscription pair.
 * Exported for tests that need to reset state between assertions.
 */
export const subsetInvariantWarningEmitted = new Set<string>();

// ---------------------------------------------------------------------------
// Handle delegation group completion check
// ---------------------------------------------------------------------------

export function* handleDelegationGroupDelivery(
  action: ReturnType<typeof requestDelegationGroupDelivery>,
) {
  const [wsId, groupId] = action.payload;

  logger.warn(`[subscriptions] delegation-group-delivery-entry workspaceId=${wsId} groupId=${groupId} step=entry`);

  // Use raw (uncached) selector to avoid stale reads from createCachedSelector
  const tracker = yield* select(
    selectDelegationGroupRaw,
    wsId,
    groupId,
  );
  if (!tracker) {
    logger.warn(`[subscriptions] delegation-group-delivery-skip workspaceId=${wsId} groupId=${groupId} reason=tracker-not-found step=early-return`);
    return;
  }

  // Subset-invariant check: tracker.expectedAgentIds must be a subset of the
  // subscription's filter.actorIds. A violation means the subscription and
  // tracker have drifted apart (historically caused by the updateSubscription
  // last-writer-wins race fixed in commit 0e0a985c8) and the saga will never
  // deliver events from the missing agents. Logging-only — deduplicated per
  // (groupId, missingIds) pair to avoid flooding.
  const subscription = yield* select(
    selectSubscriptionRaw,
    wsId,
    tracker.subscriptionId,
  );
  if (subscription) {
    const actorIds = subscription.filter.actorIds ?? [];
    const actorIdSet = new Set(actorIds);
    const missingIds = tracker.expectedAgentIds.filter((id) => !actorIdSet.has(id));
    if (missingIds.length > 0) {
      const dedupKey = `${groupId}:${[...missingIds].sort().join(",")}`;
      if (!subsetInvariantWarningEmitted.has(dedupKey)) {
        subsetInvariantWarningEmitted.add(dedupKey);
        logger.warn(
          `[subscriptions] delegation-group-subset-invariant-violation workspaceId=${wsId} groupId=${groupId} parentAgentId=${tracker.parentAgentId} subscriptionId=${tracker.subscriptionId} expectedAgentIds=${JSON.stringify(tracker.expectedAgentIds)} actorIds=${JSON.stringify(actorIds)} missingIds=${JSON.stringify(missingIds)}`,
        );
      }
    }
  }

  // Already delivered — guard against double-delivery
  if (tracker.delivered) {
    logger.warn(`[subscriptions] delegation-group-delivery-skip workspaceId=${wsId} groupId=${groupId} reason=already-delivered subscriptionId=${tracker.subscriptionId} parentAgentId=${tracker.parentAgentId} completedAgents=${tracker.completedAgentIds.length} deletedAgents=${tracker.deletedAgentIds.length} step=early-return`);
    return;
  }

  // Check if all agents have completed — use raw (uncached) selector
  const isComplete: boolean = yield* select(
    selectIsDelegationGroupCompleteRaw,
    wsId,
    groupId,
  );
  if (!isComplete) {
    logger.warn(`[subscriptions] delegation-group-delivery-skip workspaceId=${wsId} groupId=${groupId} reason=not-complete subscriptionId=${tracker.subscriptionId} parentAgentId=${tracker.parentAgentId} expectedAgents=${tracker.expectedAgentIds.length} completedAgents=${tracker.completedAgentIds.length} deletedAgents=${tracker.deletedAgentIds.length} step=early-return`);
    return;
  }

  logger.warn(`[subscriptions] delegation-complete subscriptionId=${tracker.subscriptionId} agentId=${tracker.parentAgentId} workspaceId=${wsId} groupId=${groupId} eventCount=${tracker.events.length} completedAgents=${tracker.completedAgentIds.length} deletedAgents=${tracker.deletedAgentIds.length} step=deliver`);

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
  const parentStatus: string = yield* selectAgentStatus.effect(wsId, parentAgentId);

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
    logger.warn(`[subscriptions] deliver subscriptionId=${subscriptionId} agentId=${agentId} workspaceId=${wsId} groupId=${groupId} eventCount=${events.length} step=deliver`);
    yield* call(
      handleDeliverEvents,
      requestDeliverEvents(wsId, agentId, events),
    );
  } catch (err) {
    logger.error(`[subscriptions] deliver subscriptionId=${subscriptionId} agentId=${agentId} workspaceId=${wsId} groupId=${groupId} step=deliver error=${err instanceof Error ? err.message : String(err)}`);
  }

  // SAFETY NET: Re-enqueue events to the parent agent's queue so they survive
  // cleanup. If handleDeliverEvents succeeded, the delivery dedup cache
  // (filterAlreadyDelivered) will skip these on the next attempt. If it failed
  // (all retries exhausted, timeout, transient error), the events will be
  // retried via watchAgentIdleForDelivery or periodicQueueSweep.
  //
  // Without this, a failed delegation group delivery permanently loses the
  // events — the subscription and group are removed below, and there is no
  // other recovery path. This was the root cause of coordinators not being
  // woken when their delegated agents completed while the workspace was in
  // the background.
  logger.warn(`[subscriptions] re-enqueue-safety subscriptionId=${subscriptionId} agentId=${agentId} workspaceId=${wsId} groupId=${groupId} eventCount=${events.length} step=re-enqueue`);
  for (const event of events) {
    yield* put(enqueueEvent(wsId, agentId, {
      event,
      priority: "high",
      queuedAt: new Date().toISOString(),
      oneShot: false,
    }));
  }

  // Clean up delegation group and subscription regardless of delivery outcome
  // to prevent permanent stuck state
  logger.warn(`[subscriptions] cleanup subscriptionId=${subscriptionId} agentId=${agentId} workspaceId=${wsId} groupId=${groupId} step=cleanup`);
  yield* put(removeDelegationGroup(wsId, groupId));
  if (subscriptionId) {
    yield* put(removeSubscription(wsId, subscriptionId));
  }

  // Trigger delivery of the re-enqueued events. If the agent is idle,
  // watchAgentIdleForDelivery won't fire (it reacts to setAgentStatus
  // transitions, not current state), so we dispatch manually.
  yield* put(requestDeliverQueuedEvents(wsId, agentId));
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

    const status: string = yield* selectAgentStatus.effect(wsId, agentId);
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

  // Budget exhausted — re-enqueue events then clean up
  const totalWaitSeconds = (MAX_BUSY_POLL_ATTEMPTS * BUSY_POLL_INTERVAL_MS) / 1000;
  logger.warn(`[subscriptions] deliver subscriptionId=${subscriptionId} agentId=${agentId} workspaceId=${wsId} groupId=${groupId} step=deliver status=timeout totalWaitSeconds=${totalWaitSeconds}`);

  // Re-enqueue events so they are not permanently lost
  for (const event of events) {
    yield* put(enqueueEvent(wsId, agentId, {
      event,
      priority: "high",
      queuedAt: new Date().toISOString(),
      oneShot: false,
    }));
  }

  yield* put(removeDelegationGroup(wsId, groupId));
  if (subscriptionId) {
    yield* put(removeSubscription(wsId, subscriptionId));
  }

  // Trigger delivery attempt for re-enqueued events
  yield* put(requestDeliverQueuedEvents(wsId, agentId));
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
// Internal delegation-group watcher owned by supervisedDelegationGroupSaga.
//
// supervisedDelegationGroupSaga is the static zero-argument registry entry;
// this watcher stays inside that owner so the crash-recovery loop can restart
// it without moving runtime behavior into the startup registry.
// ---------------------------------------------------------------------------

export function* delegationGroupSaga() {
  yield* takeEvery(
    requestDelegationGroupDelivery,
    handleDelegationGroupDelivery,
  );

  // Block forever so the crash-recovery wrapper in supervisedDelegationGroupSaga
  // doesn't restart us in a tight loop when nothing has gone wrong.
  yield* take("@@NEVER_RESOLVE");
}