/**
 * Matching saga — watches `workspaceEventAccepted` and routes matching events
 * to the appropriate delivery mechanism (immediate, queued, or delegation group).
 *
 * Replaces the missing event→subscription matching logic that was never migrated
 * from the old `AgentEventSubscriptionService.createEventDeliveryCallback()`.
 */

import { cancel, cancelled, delay, fork, put, select, take, takeEvery } from "typed-redux-saga";
import type { Task } from "redux-saga";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import { workspaceEventAccepted } from "../../workspace-events/workspace-events-slice";
import {
  addSubscription,
  appendDelegationGroupEvent,
  bumpVersion,
  enqueueEvent,
  markDelegationAgentCompleted,
  markDelegationAgentDeleted,
  markOneShotFired,
  removeSubscription,
  type QueuedEventRecord,
} from "../agent-subscriptions-slice";
import {
  selectAgentQueueLength,
  selectAgentStatus,
  selectAllSubscriptionsRaw,
  selectDelegationGroup,
  selectIsAgentDeleted,
  selectIsOneShotFired,
  selectWorkspaceSubscriptionState,
} from "../agent-subscriptions-selectors";
import { requestDeliverQueuedEvents } from "./saga-actions";
import { buildSweepCatchUpEventId, recordDeliveredEventIds, sweepCatchUpSeen } from "./delivery-saga";
import { Logger } from "../../../../../shared/logger";
const logger = new Logger("MatchingSaga");
import type {
  AgentSubscriptionRecord,
  AgentEventFilter,
  AgentStatus,
  SerializableDataMatcher,
} from "../types";

// ---------------------------------------------------------------------------
// Filter matching
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-notation field path on an object.
 * e.g. getNestedValue(event, "data.path") → event.data.path
 */
function getNestedValue(obj: Record<string, any>, field: string): unknown {
  const parts = field.split(".");
  let value: any = obj;
  for (const part of parts) {
    if (value == null || typeof value !== "object") return undefined;
    value = value[part];
  }
  return value;
}

/**
 * Check whether a single SerializableDataMatcher matches an event.
 */
function matchesDataMatcher(
  event: WorkspaceEvent,
  matcher: SerializableDataMatcher,
): boolean {
  const actual = getNestedValue(event as unknown as Record<string, any>, matcher.field);

  switch (matcher.operator) {
    case "equals":
      return actual === matcher.value;

    case "contains":
      if (typeof actual === "string" && typeof matcher.value === "string") {
        return actual.includes(matcher.value);
      }
      return false;

    case "starts_with":
      if (typeof actual === "string" && typeof matcher.value === "string") {
        return actual.startsWith(matcher.value);
      }
      return false;

    case "ends_with":
      if (typeof actual === "string" && typeof matcher.value === "string") {
        return actual.endsWith(matcher.value);
      }
      return false;

    case "matches": {
      if (typeof actual !== "string") return false;
      const regexValue = matcher.value as { pattern: string; flags: string };
      if (
        typeof regexValue === "object" &&
        regexValue !== null &&
        "pattern" in regexValue
      ) {
        try {
          const regex = new RegExp(regexValue.pattern, regexValue.flags);
          return regex.test(actual);
        } catch {
          return false;
        }
      }
      // Fall back to string value as pattern
      if (typeof matcher.value === "string") {
        try {
          return new RegExp(matcher.value).test(actual);
        } catch {
          return false;
        }
      }
      return false;
    }

    default:
      return false;
  }
}

/**
 * Check whether a workspace event matches a subscription's filter criteria.
 */
function matchesFilter(
  event: WorkspaceEvent,
  filter: AgentEventFilter,
): boolean {
  // eventTypes: if specified, event.type must match at least one entry.
  // Supports category wildcards like "agent:*" which match any event type
  // starting with the prefix (e.g. "agent:idle", "agent:completed").
  if (filter.eventTypes?.length) {
    const matched = filter.eventTypes.some((filterType) => {
      if (filterType.endsWith(":*")) {
        const prefix = filterType.slice(0, -1); // "agent:*" → "agent:"
        return event.type.startsWith(prefix);
      }
      return filterType === event.type;
    });
    if (!matched) return false;
  }

  // actorIds: if specified, event.actor.id must be in the list
  if (filter.actorIds?.length) {
    if (!event.actor?.id || !filter.actorIds.includes(event.actor.id)) {
      return false;
    }
  }

  // excludeActorIds: event.actor.id must NOT be in the list
  if (filter.excludeActorIds?.length) {
    if (event.actor?.id && filter.excludeActorIds.includes(event.actor.id)) {
      return false;
    }
  }

  // actorTypes: if specified, event.actor.type must be in the list
  if (filter.actorTypes?.length) {
    if (!event.actor?.type || !filter.actorTypes.includes(event.actor.type)) {
      return false;
    }
  }

  // since: if specified, skip events with timestamp before filter.since
  if (filter.since) {
    const eventTime = new Date(event.timestamp).getTime();
    const sinceTime = new Date(filter.since).getTime();
    if (eventTime < sinceTime) return false;
  }

  // dataMatchers: if specified, ALL matchers must match (AND logic)
  if (filter.dataMatchers?.length) {
    const allMatch = filter.dataMatchers.every((matcher) =>
      matchesDataMatcher(event, matcher),
    );
    if (!allMatch) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Delegation event type helpers
// ---------------------------------------------------------------------------

const DELEGATION_COMPLETION_EVENTS = new Set([
  "agent:idle",
  "agent:completed",
  "agent:failed",
]);

const DELEGATION_DELETION_EVENTS = new Set(["agent:deleted"]);

// ---------------------------------------------------------------------------
// Batch timer management
// ---------------------------------------------------------------------------

/**
 * Tracks active batch flush timers per agent. Key is `${wsId}:${agentId}`.
 * Exported for testing purposes only.
 */
export const activeBatchTimers = new Map<string, Task>();

/**
 * Worker that waits for `batchWindowMs` then triggers queued event delivery.
 * If the queue was already drained (e.g. by batchMaxEvents), the delivery
 * saga handles it gracefully (no-op on empty queue).
 */
export function* batchFlushWorker(
  wsId: string,
  agentId: string,
  batchWindowMs: number,
) {
  const key = `${wsId}:${agentId}`;
  try {
    yield* delay(batchWindowMs);
    yield* put(requestDeliverQueuedEvents(wsId, agentId));
  } finally {
    activeBatchTimers.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Synchronous guard for oneShot subscriptions being processed.
 * Prevents the race where two concurrent handleMatchEvent forks both read
 * selectIsOneShotFired as false before either dispatches markOneShotFired.
 * @internal Exported for testing purposes only.
 */
export const processingOneShots = new Set<string>();

// Events emitted by the saga infrastructure itself — skip to prevent loops.
const INTERNAL_OBSERVABILITY_EVENTS = new Set([
  "agent:woken-by-subscription",
  "agent:subscribed",
  "agent:unsubscribed",
  "agent:subscriptions-changed",
  "agent:delivery-confirmed",
]);

/** Agent lifecycle event types that warrant WARN-level diagnostic logging. */
const AGENT_LIFECYCLE_EVENTS = new Set([
  "agent:idle",
  "agent:failed",
  "agent:completed",
  "agent:deleted",
]);

export function* handleMatchEvent(
  action: ReturnType<typeof workspaceEventAccepted>,
) {
  const [event] = action.payload;
  const wsId = event.workspaceId;
  if (!wsId) return;

  // Guard against feedback loops from internally-emitted observability events
  if (INTERNAL_OBSERVABILITY_EVENTS.has(event.type)) return;

  const isAgentLifecycle = AGENT_LIFECYCLE_EVENTS.has(event.type);

  if (isAgentLifecycle) {
    logger.warn(`[subscriptions] handleMatchEvent entry eventType=${event.type} actor=${event.actor?.id} wsId=${wsId}`);
  }

  // Track oneShot IDs claimed during this invocation so we can release them
  // if the code throws before reaching the normal cleanup path.
  const claimedOneShotIds = new Set<string>();

  try {

  const subscriptions: AgentSubscriptionRecord[] = yield* select(
    selectAllSubscriptionsRaw,
    wsId,
  );

  if (subscriptions.length === 0) {
    if (isAgentLifecycle) {
      logger.warn(`[subscriptions] no-subscriptions eventType=${event.type} actor=${event.actor?.id?.substring(0, 20)} wsId=${wsId}`);
    }
    return;
  }

  for (const sub of subscriptions) {
    // Skip subscriptions belonging to deleted agents
    const isDeleted: boolean = yield* select(
      selectIsAgentDeleted.select,
      wsId,
      sub.agentId,
    );
    if (isDeleted) {
      if (isAgentLifecycle) {
        logger.warn(`[subscriptions] skip-deleted subscriptionId=${sub.id} agentId=${sub.agentId} eventType=${event.type} wsId=${wsId}`);
      }
      continue;
    }

    // Check filter match (synchronous — no yield points, so no interleaving)
    if (!matchesFilter(event, sub.filter)) continue;

    // Skip already-fired oneShot subscriptions.
    // The synchronous `processingOneShots` guard closes the race window where
    // two concurrent forks (from takeEvery) both read selectIsOneShotFired as
    // false before either dispatches markOneShotFired.  Because saga forks run
    // cooperatively on a single thread, the Set check cannot be preempted.
    // Placed AFTER matchesFilter (which is sync) so we only claim the oneShot
    // when the event actually matches, avoiding permanent lockout on non-matches.
    if (sub.filter.oneShot) {
      if (processingOneShots.has(sub.id)) {
        if (isAgentLifecycle) {
          logger.warn(`[subscriptions] skip-oneshot-processing subscriptionId=${sub.id} agentId=${sub.agentId} eventType=${event.type} wsId=${wsId}`);
        }
        continue;
      }
      // Claim this oneShot synchronously BEFORE the yield* select below.
      // Without this, two concurrent forks (from takeEvery) could both pass
      // the has() check, both observe isFired=false from the selector, and
      // both proceed to deliver the same oneShot event.
      processingOneShots.add(sub.id);
      claimedOneShotIds.add(sub.id);
      const isFired: boolean = yield* select(
        selectIsOneShotFired.select,
        wsId,
        sub.id,
      );
      if (isFired) {
        if (isAgentLifecycle) {
          logger.warn(`[subscriptions] skip-oneshot-fired subscriptionId=${sub.id} agentId=${sub.agentId} eventType=${event.type} wsId=${wsId}`);
        }
        processingOneShots.delete(sub.id);
        claimedOneShotIds.delete(sub.id);
        continue;
      }
    }

    // --- Matched! Route the event. ---
    const eventId = (event as any).id as string | undefined;
    const logMatch = isAgentLifecycle ? logger.warn.bind(logger) : logger.info.bind(logger);
    logMatch(`[subscriptions] match subscriptionId=${sub.id} eventId=${eventId} agentId=${sub.agentId} workspaceId=${wsId} eventType=${event.type} step=match`);
    const filter = sub.filter;

    // --- Sweep catch-up dedup guard (consume-once) ---
    // If the periodic sweep already delivered a catch-up for this exact
    // subscription+actor+eventType combo, skip delivery of the real event
    // to prevent double-waking the subscriber.  The sweepCatchUpSeen set
    // is populated by periodicQueueSweep after it enqueues a synthetic
    // catch-up.  The entry is consumed (deleted) here so that only the
    // immediate real event is suppressed — future state transitions for
    // the same agent (e.g. idle → busy → idle) will be delivered normally.
    if (!filter.delegationGroup && filter.actorIds?.length && event.actor?.id) {
      const sweepDedupeKey = `${sub.id}:${event.actor.id}:${event.type}`;
      if (sweepCatchUpSeen.has(sweepDedupeKey)) {
        sweepCatchUpSeen.delete(sweepDedupeKey); // consume-once: allow future transitions
        const logSweepSkip = isAgentLifecycle ? logger.warn.bind(logger) : logger.info.bind(logger);
        logSweepSkip(
          `[subscriptions] skip-sweep-already-delivered subscriptionId=${sub.id} eventId=${eventId} agentId=${sub.agentId} workspaceId=${wsId} eventType=${event.type} step=skip reason=sweep-catchup-already-fired`,
        );
        continue;
      }
    }

    // 1. Delegation group routing
    if (filter.delegationGroup) {
      const groupId = filter.delegationGroup.groupId;
      const actorId = event.actor?.id;

      // Append every matched event to the group tracker so it is
      // available when handleDelegationGroupDelivery delivers to the parent.
      const logDelegation = isAgentLifecycle ? logger.warn.bind(logger) : logger.info.bind(logger);
      logDelegation(`[subscriptions] enqueue-delegation subscriptionId=${sub.id} eventId=${eventId} agentId=${sub.agentId} workspaceId=${wsId} groupId=${groupId} step=enqueue`);
      yield* put(appendDelegationGroupEvent(wsId, groupId, event));

      if (actorId) {
        if (DELEGATION_DELETION_EVENTS.has(event.type)) {
          yield* put(markDelegationAgentDeleted(wsId, groupId, actorId));
        } else if (DELEGATION_COMPLETION_EVENTS.has(event.type)) {
          yield* put(markDelegationAgentCompleted(wsId, groupId, actorId));
        }
      }
      // Cross-record the deterministic sweep-catchup ID so the periodic
      // sweep does not re-deliver events the matching saga already routed
      // through the delegation group path.
      if (filter.actorIds?.length && event.actor?.id) {
        const sweepCatchUpId = buildSweepCatchUpEventId(sub.id, event.actor.id, event.type);
        recordDeliveredEventIds(sub.agentId, [sweepCatchUpId]);
      }

      // Delegation group delivery is handled by delegation-group-saga
      // which watches both markDelegationAgentCompleted and markDelegationAgentDeleted.
      continue;
    }

    // 2. Queue the event for delivery.
    // Always queue regardless of agent status so the existing
    // watchAgentIdleForDelivery drain mechanism handles delivery,
    // respecting batchWindow / batchMaxEvents if set.
    const queuedEvent: QueuedEventRecord = {
      event,
      queuedAt: new Date().toISOString(),
      priority: filter.priority ?? "normal",
      subscriptionId: sub.id,
      oneShot: filter.oneShot ?? false,
    };
    logger.debug(`[subscriptions] enqueue subscriptionId=${sub.id} eventId=${eventId} agentId=${sub.agentId} workspaceId=${wsId} step=enqueue`);
    yield* put(enqueueEvent(wsId, sub.agentId, queuedEvent));

    // Cross-record the deterministic sweep-catchup ID in the dedup cache
    // so that if the periodic sweep also fires for this same subscription+
    // actor combo, the catch-up event will be filtered out as a duplicate.
    if (filter.actorIds?.length && event.actor?.id) {
      const sweepCatchUpId = buildSweepCatchUpEventId(sub.id, event.actor.id, event.type);
      recordDeliveredEventIds(sub.agentId, [sweepCatchUpId]);
    }

    // If the agent is already idle, trigger delivery — respecting
    // batchWindow / batchMaxEvents when configured.
    const agentStatus: string = yield* select(
      selectAgentStatus.select,
      wsId,
      sub.agentId,
    );

    if (agentStatus === "idle") {
      const hasBatchSettings = filter.batchWindow != null || filter.batchMaxEvents != null;

      if (hasBatchSettings) {
        const batchKey = `${wsId}:${sub.agentId}`;

        // Check batchMaxEvents: if the queue has reached the threshold,
        // deliver immediately (cancel any pending timer).
        if (filter.batchMaxEvents != null) {
          const queueLength: number = yield* select(
            selectAgentQueueLength.select,
            wsId,
            sub.agentId,
          );
          if (queueLength >= filter.batchMaxEvents) {
            const existingTimer = activeBatchTimers.get(batchKey);
            if (existingTimer) {
              yield* cancel(existingTimer);
              activeBatchTimers.delete(batchKey);
            }
            yield* put(requestDeliverQueuedEvents(wsId, sub.agentId));
            // Skip to oneShot handling below
          } else if (filter.batchWindow != null) {
            // Not enough events yet, ensure a timer is running
            if (!activeBatchTimers.has(batchKey)) {
              const task: Task = yield* fork(
                batchFlushWorker,
                wsId,
                sub.agentId,
                filter.batchWindow,
              );
              activeBatchTimers.set(batchKey, task);
            }
          }
          // If only batchMaxEvents (no batchWindow) and threshold not reached,
          // don't deliver — events accumulate until threshold or agent status change.
        } else if (filter.batchWindow != null) {
          // Only batchWindow set: start a timer if not already running
          if (!activeBatchTimers.has(batchKey)) {
            const task: Task = yield* fork(
              batchFlushWorker,
              wsId,
              sub.agentId,
              filter.batchWindow,
            );
            activeBatchTimers.set(batchKey, task);
          }
        }
      } else {
        // No batch settings — deliver immediately (original behavior)
        yield* put(requestDeliverQueuedEvents(wsId, sub.agentId));
      }
    }

    // 3. Handle oneShot cleanup
    if (filter.oneShot) {
      logger.debug(`[subscriptions] cleanup subscriptionId=${sub.id} eventId=${eventId} agentId=${sub.agentId} workspaceId=${wsId} step=cleanup reason=oneShot`);
      yield* put(markOneShotFired(wsId, sub.id));
      yield* put(removeSubscription(wsId, sub.id));
      yield* put(bumpVersion(wsId));
      processingOneShots.delete(sub.id);
      claimedOneShotIds.delete(sub.id);
    }
  }
  } catch (error) {
    logger.error(`[subscriptions] handleMatchEvent crashed eventType=${event.type} workspaceId=${wsId}`, { error });
  } finally {
    // Release any oneShot claims that weren't cleaned up before the throw
    // or on saga cancellation.
    for (const id of claimedOneShotIds) {
      processingOneShots.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Catch-up: check if watched agents already match at subscribe time
// ---------------------------------------------------------------------------

/**
 * Map agent statuses to the event types they imply.
 * Only terminal/idle states should trigger catch-up — never "responding".
 */
const STATUS_TO_EVENT_TYPE: Partial<Record<AgentStatus, string>> = {
  idle: "agent:idle",
  failed: "agent:failed",
  completed: "agent:completed",
};

/**
 * Synthesize a minimal catch-up WorkspaceEvent for an agent that already
 * satisfies a subscription's filter criteria at the time the subscription
 * is created. The event is intentionally lightweight — we don't have the
 * full response summary since the real event was already emitted and lost.
 */
function synthesizeCatchUpEvent(
  wsId: string,
  actorId: string,
  eventType: string,
): WorkspaceEvent {
  return {
    id: `catchup_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    workspaceId: wsId,
    timestamp: new Date().toISOString(),
    type: eventType,
    actor: { type: "agent", id: actorId },
    data: {
      agentId: actorId,
      agentName: "",
      reason: "stream_complete",
      catchUp: true,
    },
  } as unknown as WorkspaceEvent;
}

/**
 * When a new subscription is added, check if any of the watched agents
 * already have a status that matches the subscription's event type filter.
 * If so, synthesize a catch-up event and route it through the normal
 * delivery pipeline (queue or delegation group).
 *
 * This fixes the race where a sub-agent finishes before the coordinator
 * creates its subscription, causing the coordinator to wait forever.
 */
export function* handleNewSubscriptionCatchUp(
  action: ReturnType<typeof addSubscription>,
) {
  const [wsId, record] = action.payload;
  const filter = record.filter;

  // Only apply catch-up for subscriptions watching specific agents
  if (!filter.actorIds?.length) return;

  // Only apply catch-up for subscriptions that watch agent lifecycle events
  if (!filter.eventTypes?.length) return;

  // Read the workspace state once so we can check agentStatuses directly.
  // selectAgentStatus defaults to "idle" for unknown agents, which would
  // falsely trigger catch-up for newly-created agents that haven't reported
  // status yet.  By reading the map directly we skip agents with no entry.
  const wsState = yield* select(selectWorkspaceSubscriptionState.select, wsId);

  for (const actorId of filter.actorIds) {
    // Check if the agent was deleted — deletedAgents is tracked separately
    // from agentStatuses, so we check it explicitly.
    const isDeleted = actorId in wsState.deletedAgents;
    const status = wsState.agentStatuses[actorId];

    // Determine the matching event type: deleted agents → "agent:deleted",
    // otherwise map from the status.
    const matchingEventType = isDeleted
      ? "agent:deleted"
      : status
        ? STATUS_TO_EVENT_TYPE[status]
        : undefined;
    if (!matchingEventType) continue;

    // Check if this event type matches the subscription's event type filter
    // (supports wildcards like "agent:*")
    const typeMatches = filter.eventTypes.some((filterType) => {
      if (filterType.endsWith(":*")) {
        const prefix = filterType.slice(0, -1);
        return matchingEventType.startsWith(prefix);
      }
      return filterType === matchingEventType;
    });
    if (!typeMatches) continue;

    // Agent already matches — synthesize a catch-up event
    const catchUpEvent = synthesizeCatchUpEvent(wsId, actorId, matchingEventType);

    // Route through delegation group or direct queue
    if (filter.delegationGroup) {
      const groupId = filter.delegationGroup.groupId;

      // Verify the group exists before appending
      const group = yield* select(selectDelegationGroup.select, wsId, groupId);
      if (!group) continue;

      yield* put(appendDelegationGroupEvent(wsId, groupId, catchUpEvent));

      // Give the renderer time to observe the subscription before resolving
      yield* delay(1500);

      if (matchingEventType === "agent:deleted") {
        yield* put(markDelegationAgentDeleted(wsId, groupId, actorId));
      } else {
        yield* put(markDelegationAgentCompleted(wsId, groupId, actorId));
      }
      // delegation-group-saga watches markDelegationAgentCompleted/Deleted
      // and will trigger requestDelegationGroupDelivery automatically
    } else {
      // Queue the event for direct delivery
      const queuedEvent: QueuedEventRecord = {
        event: catchUpEvent,
        queuedAt: new Date().toISOString(),
        priority: filter.priority ?? "normal",
        subscriptionId: record.id,
        oneShot: filter.oneShot ?? false,
      };
      yield* put(enqueueEvent(wsId, record.agentId, queuedEvent));

      // Give the renderer time to observe the subscription before resolving
      yield* delay(1500);

      // Trigger immediate delivery since the subscribing agent is presumably
      // idle (it just created the subscription)
      yield* put(requestDeliverQueuedEvents(wsId, record.agentId));

      // Handle oneShot cleanup
      if (filter.oneShot) {
        yield* put(markOneShotFired(wsId, record.id));
        yield* put(removeSubscription(wsId, record.id));
        yield* put(bumpVersion(wsId));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Root matching saga
// ---------------------------------------------------------------------------

export function* matchingSaga() {
  try {
    yield* takeEvery(workspaceEventAccepted, handleMatchEvent);
    yield* takeEvery(addSubscription, handleNewSubscriptionCatchUp);

    // Block indefinitely so the crash-recovery wrapper in
    // agentSubscriptionsSaga only restarts when this saga actually throws.
    // Without this, matchingSaga returns immediately after the non-blocking
    // takeEvery registrations, causing the while(true) wrapper to re-register
    // duplicate watchers every ~1 second.
    yield* take("@@matching-saga/NEVER_RESOLVE");
  } finally {
    if (yield* cancelled()) {
      // Cancel any pending batch flush timers and clear the map
      for (const task of activeBatchTimers.values()) {
        yield* cancel(task);
      }
      activeBatchTimers.clear();
      processingOneShots.clear();
    }
  }
}

