/**
 * Delivery saga — handles delivering events to agents.
 *
 * Replaces the imperative `deliverEvents()` / `deliverQueuedEvents()` /
 * `createEventDeliveryCallback()` logic from AgentEventSubscriptionService.
 *
 * Side effects (sendBackendInitiatedMessage, formatEventNotification) are
 * called via `call()` so they remain mockable in tests.
 */

import { call, fork, join, put, select, spawn, takeEvery, delay, race, type SagaGenerator } from "typed-redux-saga";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import { Logger } from "../../../../../shared/logger";
import {
  clearAgentQueue,
  enqueueEvent,
  recordDeliveryFailure,
  recordDeliverySuccess,
  recordDeliveryTimeout,
  recordDroppedEvents,
  setAgentStatus,
  bumpVersion,
  type QueuedEventRecord,
} from "../agent-subscriptions-slice";
import { dispatchWorkspaceEvent } from "./ipc-bridge-saga";
import {
  selectAgentQueue,
  selectAgentStatus,
  selectAllWorkspaceIds,
  selectIsAgentDeleted,
  selectWorkspaceSubscriptionState,
} from "../agent-subscriptions-selectors";
import {
  requestDeliverEvents,
  requestDeliverQueuedEvents,
} from "./saga-actions";

const logger = new Logger("DeliverySaga");

// ---------------------------------------------------------------------------
// External service wrappers (injected via `call()` for testability)
// ---------------------------------------------------------------------------

/**
 * Format events into a notification string.
 * Wraps the dynamic import so sagas can `call()` it.
 */
export async function formatNotification(
  events: WorkspaceEvent[],
): Promise<string> {
  const { formatEventNotification } = await import(
    "../../../../../features/events/main/event-notification-formatter"
  );
  return formatEventNotification(events);
}

/**
 * Send a backend-initiated message to an agent.
 * Wraps the dynamic import + call so sagas can `call()` it.
 */
export async function sendBackendMessage(
  agentId: string,
  workspaceId: string,
  notification: string,
  events: WorkspaceEvent[],
): Promise<{ success: boolean; error?: string; errorCode?: string }> {
  const { AgentBackendHandler } = await import(
    "../../../../../features/agent/main/agent-backend-handler.service"
  );
  const backend = AgentBackendHandler.getInstance();

  const eventTypes = [...new Set(events.map((e) => e.type))];
  const eventsData = events.map((event) => ({
    type: event.type,
    data: event.data,
    timestamp: event.timestamp,
  }));

  return backend.sendBackendInitiatedMessage({
    sessionId: agentId,
    message: notification,
    workspaceId,
    messageMetadata: {
      type: "event_notification",
      eventCount: events.length,
      eventTypes,
      events: eventsData,
    },
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const DELIVERY_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Delivery idempotency guard
// ---------------------------------------------------------------------------
// When the saga's race-timeout fires before sendBackendMessage returns, the
// underlying Promise may still complete on the backend and wake the agent.
// The events are also re-enqueued for a second delivery attempt.  Without a
// guard the agent receives the same notification twice.
//
// We record event IDs only after a backend delivery actually succeeds. For the
// timeout path, we keep a detached task alive after the saga returns so a late
// success can still populate the dedup cache without dropping retries when the
// timed-out send eventually fails.
//
// We track recently delivered event IDs per agent in a lightweight module-
// level cache.  Before delivering, we filter out IDs already in the cache.
// Entries expire after DEDUP_TTL_MS to avoid unbounded growth.
// ---------------------------------------------------------------------------

const DEDUP_TTL_MS = 5 * 60_000; // 5 minutes

interface DeliveredEntry {
  deliveredAt: number;
}

/** agentId → (eventId → DeliveredEntry) */
const recentlyDelivered = new Map<string, Map<string, DeliveredEntry>>();

function recordDeliveredEventIds(agentId: string, eventIds: string[]): void {
  let agentCache = recentlyDelivered.get(agentId);
  if (!agentCache) {
    agentCache = new Map();
    recentlyDelivered.set(agentId, agentCache);
  }
  const now = Date.now();
  for (const id of eventIds) {
    agentCache.set(id, { deliveredAt: now });
  }
  // Trim expired entries
  const cutoff = now - DEDUP_TTL_MS;
  for (const [id, entry] of agentCache) {
    if (entry.deliveredAt < cutoff) agentCache.delete(id);
  }
}

function filterAlreadyDelivered(agentId: string, events: WorkspaceEvent[]): WorkspaceEvent[] {
  const agentCache = recentlyDelivered.get(agentId);
  if (!agentCache || agentCache.size === 0) return events;

  const now = Date.now();
  const cutoff = now - DEDUP_TTL_MS;
  return events.filter((e) => {
    const id = (e as any).id as string | undefined;
    if (!id) return true; // keep events without IDs
    const entry = agentCache.get(id);
    if (!entry) return true;
    if (entry.deliveredAt < cutoff) {
      agentCache.delete(id);
      return true;
    }
    return false; // already delivered — skip
  });
}

/** @internal — exposed for tests */
export function clearDeliveryDedupCache(): void {
  recentlyDelivered.clear();
}

function* sendBackendMessageWithLateSuccessDedup(
  agentId: string,
  wsId: string,
  notification: string,
  events: WorkspaceEvent[],
): SagaGenerator<{ success: boolean; error?: string; errorCode?: string }> {
  try {
    const result = yield* call(sendBackendMessage, agentId, wsId, notification, events);
    if (result.success) {
      const deliveredEventIds = events.map((e) => e.id).filter(Boolean) as string[];
      recordDeliveredEventIds(agentId, deliveredEventIds);
    }
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Deliver specific events to an agent (with retry)
// ---------------------------------------------------------------------------

export function* handleDeliverEvents(
  action: ReturnType<typeof requestDeliverEvents>,
) {
  const [wsId, agentId, rawEvents] = action.payload;
  if (rawEvents.length === 0) return;

  // Guard: skip delivery for deleted agents
  const isDeleted: boolean = yield* select(
    selectIsAgentDeleted.select,
    wsId,
    agentId,
  );
  if (isDeleted) return;

  // Idempotency guard: filter out events already delivered by a prior attempt
  // (e.g. the original sendBackendMessage succeeded after the saga timed out)
  const events = filterAlreadyDelivered(agentId, rawEvents);
  if (events.length === 0) {
    logger.debug(`[subscriptions] skip agentId=${agentId} workspaceId=${wsId} step=dedup allEventsAlreadyDelivered=true originalCount=${rawEvents.length}`);
    return;
  }

  const eventIds = events.map((e) => (e as any).id as string | undefined);
  logger.debug(`[subscriptions] deliver agentId=${agentId} workspaceId=${wsId} eventCount=${events.length} eventIds=${eventIds.join(",")} step=deliver`);

  yield* put(bumpVersion(wsId));

  // Format the notification once
  const notification: string = yield* call(formatNotification, events);
  if (!notification) {
    yield* put(recordDroppedEvents(wsId, events.length));
    yield* put(bumpVersion(wsId));
    return;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const sendTask = yield* spawn(
        sendBackendMessageWithLateSuccessDedup,
        agentId,
        wsId,
        notification,
        events,
      );

      const { result, timeout } = yield* race({
        result: join(sendTask),
        timeout: delay(DELIVERY_TIMEOUT_MS),
      });

      if (timeout) {
        // The saga timed out but sendBackendInitiatedMessage is still running
        // (Promises can't be cancelled). The detached send task keeps running,
        // and if it later succeeds it will populate the dedup cache. That lets
        // us avoid duplicate re-delivery without suppressing retries when the
        // timed-out send eventually fails.

        logger.warn(`[subscriptions] re-enqueue agentId=${agentId} workspaceId=${wsId} eventCount=${events.length} step=re-enqueue reason=timeout timeoutMs=${DELIVERY_TIMEOUT_MS}`);
        for (const event of events) {
          yield* put(enqueueEvent(wsId, agentId, {
            event,
            priority: "high",
            queuedAt: new Date().toISOString(),
            oneShot: false,
          }));
        }
        yield* put(recordDeliveryTimeout(wsId));
        yield* put(bumpVersion(wsId));
        return;
      }

      if (result!.success) {
        logger.debug(`[subscriptions] success agentId=${agentId} workspaceId=${wsId} eventCount=${events.length} attempt=${attempt} step=success`);
        yield* put(recordDeliverySuccess(wsId));
        yield* put(bumpVersion(wsId));

        const deliveredEventIds = events.map((e) => e.id).filter(Boolean) as string[];

        // Emit agent:woken-by-subscription domain event for UI listeners
        const eventTypes = [...new Set(events.map((e) => e.type))];
        yield* call(dispatchWorkspaceEvent, "agent:woken-by-subscription", wsId, {
          type: "agent",
          id: agentId,
        }, {
          agentId,
          eventCount: events.length,
          eventTypes,
        });

        // Emit agent:delivery-confirmed for external observers (UI, tests, monitoring)
        yield* call(dispatchWorkspaceEvent, "agent:delivery-confirmed", wsId, {
          type: "system",
          id: "subscription-service",
        }, {
          subscriberAgentId: agentId,
          deliveredEventIds,
        });
        return;
      }

      // TRANSIENT ERRORS: Agent is busy (streaming, processing queued messages,
      // or a prior delivery is still in-flight). Re-enqueue the events so
      // watchAgentIdleForDelivery delivers them when the agent becomes idle.
      // Inline retries are insufficient because streams can take minutes —
      // far longer than the retry window.
      //
      // DELIVERY_IN_FLIGHT previously was treated as "success" (silently dropped),
      // which caused the coordinator to miss second-round wake-ups: when the
      // delivery saga's 30 s race-timeout fires before `sendBackendInitiatedMessage`
      // returns, `pendingBackendDeliveries` still holds the coordinator's ID.
      // A subsequent delivery for a *new* event then hits the guard and gets
      // dropped. Re-enqueueing instead ensures the event survives.
      if (
        result!.errorCode === "ALREADY_STREAMING" ||
        result!.errorCode === "QUEUE_PENDING" ||
        result!.errorCode === "DELIVERY_IN_FLIGHT"
      ) {
        logger.warn(`[subscriptions] re-enqueue agentId=${agentId} workspaceId=${wsId} eventCount=${events.length} errorCode=${result!.errorCode} attempt=${attempt} step=re-enqueue reason=transient`);
        for (const event of events) {
          yield* put(enqueueEvent(wsId, agentId, {
            event,
            priority: "high",
            queuedAt: new Date().toISOString(),
            oneShot: false,
          }));
        }
        yield* put(bumpVersion(wsId));

        // If the agent is already idle, watchAgentIdleForDelivery won't fire
        // (it only triggers on the setAgentStatus ACTION). Dispatch delivery
        // manually with a small delay to avoid infinite recursion if the
        // stream hasn't fully cleaned up yet.
        const currentStatus: string | undefined = yield* select(
          selectAgentStatus.select,
          wsId,
          agentId,
        );
        if (currentStatus === "idle") {
          yield* delay(100);
          yield* put(requestDeliverQueuedEvents(wsId, agentId));
        }
        return;
      }

    } catch (err) {
      logger.error(`[subscriptions] deliver agentId=${agentId} workspaceId=${wsId} attempt=${attempt} step=deliver error=${err instanceof Error ? err.message : String(err)}`);
    }

    if (attempt < MAX_RETRIES) {
      logger.warn(`[subscriptions] retry agentId=${agentId} workspaceId=${wsId} attempt=${attempt} step=retry nextDelayMs=${RETRY_DELAY_MS * attempt}`);
      yield* delay(RETRY_DELAY_MS * attempt);
    }
  }

  // All retries exhausted
  logger.error(`[subscriptions] deliver agentId=${agentId} workspaceId=${wsId} step=deliver status=failed retriesExhausted=true`);
  yield* put(recordDeliveryFailure(wsId));
  yield* put(bumpVersion(wsId));
}

// ---------------------------------------------------------------------------
// Deliver queued events for an agent
// ---------------------------------------------------------------------------

export function* handleDeliverQueuedEvents(
  action: ReturnType<typeof requestDeliverQueuedEvents>,
) {
  const [wsId, agentId] = action.payload;

  const isDeleted: boolean = yield* select(
    selectIsAgentDeleted.select,
    wsId,
    agentId,
  );
  if (isDeleted) {
    yield* put(clearAgentQueue(wsId, agentId));
    return;
  }

  const queue = yield* select(
    selectAgentQueue.select,
    wsId,
    agentId,
  );
  if (queue.length === 0) return;

  // Snapshot and clear the queue atomically
  yield* put(clearAgentQueue(wsId, agentId));

  // Deduplicate by event ID, keeping highest priority
  const priorityOrder = { high: 0, normal: 1, low: 2 } as const;
  const dedupMap = new Map<string, QueuedEventRecord>();
  for (const qe of queue) {
    const eventId = (qe.event as any)?.id as string | undefined;
    if (!eventId) {
      // No ID — keep as-is
      dedupMap.set(`_noId_${dedupMap.size}`, qe);
      continue;
    }
    const existing = dedupMap.get(eventId);
    if (!existing || priorityOrder[qe.priority] < priorityOrder[existing.priority]) {
      dedupMap.set(eventId, qe);
    }
  }

  // Sort by priority then time
  const sorted = Array.from(dedupMap.values()).sort((a, b) => {
    const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pd !== 0) return pd;
    return new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime();
  });

  const events = sorted.map((q) => q.event as unknown as WorkspaceEvent);

  // Deliver
  yield* put(requestDeliverEvents(wsId, agentId, events));
}

// ---------------------------------------------------------------------------
// Watch for agent becoming idle → deliver queued events
// ---------------------------------------------------------------------------

export function* watchAgentIdleForDelivery() {
  yield* takeEvery(setAgentStatus, function* (action) {
    const [wsId, agentId, status] = action.payload;
    if (status !== "idle") return;
    yield* put(requestDeliverQueuedEvents(wsId, agentId));
  });
}

// ---------------------------------------------------------------------------
// Periodic queue sweep — self-healing fallback
// ---------------------------------------------------------------------------

const SWEEP_INTERVAL_MS = 30_000;

/**
 * How long an agent can sit in "responding" status with queued events before
 * the sweep forces a delivery attempt.  sendBackendInitiatedMessage guards
 * (ALREADY_STREAMING / DELIVERY_IN_FLIGHT) prevent double-streaming, so it is
 * safe to attempt delivery even if the status is stale — the worst-case
 * outcome is a benign re-enqueue.
 */
const STALE_RESPONDING_THRESHOLD_MS = 60_000;

/**
 * Periodically scans all agent queues across all workspaces looking for
 * events stuck in a queue while the owning agent is idle **or stuck in a
 * stale "responding" status**.
 *
 * The "responding" check is critical: `_emitAgentIdleEventAsync` is
 * fire-and-forget, so if it fails (or races) the agent's status may
 * remain "responding" indefinitely while the agent is in fact idle.
 * Previously the sweep only delivered for agents with status "idle",
 * which meant a stale "responding" status would permanently block
 * delivery — the root cause of coordinators failing to wake from the
 * second delegated agent.
 */
export function* periodicQueueSweep() {
  while (true) {
    yield* delay(SWEEP_INTERVAL_MS);

    const workspaceIds: string[] = yield* select(selectAllWorkspaceIds.select);

    for (const wsId of workspaceIds) {
      const wsState = yield* select(
        selectWorkspaceSubscriptionState.select,
        wsId,
      );

      for (const agentId of Object.keys(wsState.agentQueues)) {
        const queue = wsState.agentQueues[agentId];
        if (!queue || queue.length === 0) continue;

        const status = wsState.agentStatuses[agentId] ?? "idle";

        if (status === "idle") {
          logger.warn(`[subscriptions] sweep agentId=${agentId} workspaceId=${wsId} queueLength=${queue.length} step=sweep reason=stuck-idle`);
          yield* put(requestDeliverQueuedEvents(wsId, agentId));
          continue;
        }

        // For "responding" agents with queued events, check if the oldest
        // queued event has been waiting longer than the threshold.  If so,
        // the status is likely stale — attempt delivery.  The
        // sendBackendInitiatedMessage guards will safely reject the call
        // with ALREADY_STREAMING / DELIVERY_IN_FLIGHT if the agent is
        // genuinely still streaming, and handleDeliverEvents will
        // re-enqueue automatically.
        if (status === "responding") {
          const oldestQueuedAt = queue[0]?.queuedAt;
          if (oldestQueuedAt) {
            const ageMs = Date.now() - new Date(oldestQueuedAt).getTime();
            if (ageMs >= STALE_RESPONDING_THRESHOLD_MS) {
              logger.warn(
                `[subscriptions] sweep agentId=${agentId} workspaceId=${wsId} queueLength=${queue.length} oldestAgeMs=${ageMs} step=sweep reason=stale-responding`,
              );
              yield* put(requestDeliverQueuedEvents(wsId, agentId));
            }
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Root delivery saga
// ---------------------------------------------------------------------------

export function* deliverySaga() {
  yield* takeEvery(requestDeliverEvents, handleDeliverEvents);
  yield* takeEvery(requestDeliverQueuedEvents, handleDeliverQueuedEvents);
  yield* watchAgentIdleForDelivery();
  yield* fork(periodicQueueSweep);
}

