/**
 * Delivery saga — handles delivering events to agents.
 *
 * Replaces the imperative `deliverEvents()` / `deliverQueuedEvents()` /
 * `createEventDeliveryCallback()` logic from AgentEventSubscriptionService.
 *
 * Side effects (sendBackendInitiatedMessage, formatEventNotification) are
 * called via `call()` so they remain mockable in tests.
 */

import { call, put, select, takeEvery, delay, race } from "typed-redux-saga";
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
  selectIsAgentDeleted,
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
// Deliver specific events to an agent (with retry)
// ---------------------------------------------------------------------------

export function* handleDeliverEvents(
  action: ReturnType<typeof requestDeliverEvents>,
) {
  const [wsId, agentId, events] = action.payload;
  if (events.length === 0) return;

  // Guard: skip delivery for deleted agents
  const isDeleted: boolean = yield* select(
    selectIsAgentDeleted.select,
    wsId,
    agentId,
  );
  if (isDeleted) return;

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
      const { result, timeout } = yield* race({
        result: call(sendBackendMessage, agentId, wsId, notification, events),
        timeout: delay(DELIVERY_TIMEOUT_MS),
      });

      if (timeout) {
        yield* put(recordDeliveryTimeout(wsId));
        yield* put(bumpVersion(wsId));
        return;
      }

      if (result!.success) {
        yield* put(recordDeliverySuccess(wsId));
        yield* put(bumpVersion(wsId));

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
        return;
      }

      // Deduplicated delivery — treat as success
      if (result!.errorCode === "DELIVERY_IN_FLIGHT") {
        yield* put(recordDeliverySuccess(wsId));
        yield* put(bumpVersion(wsId));
        return;
      }

      // TRANSIENT ERRORS: Agent is busy (streaming or processing queued messages).
      // Re-enqueue the events so watchAgentIdleForDelivery delivers them when the
      // agent becomes idle. Inline retries are insufficient because streams can take
      // minutes — far longer than the retry window.
      if (result!.errorCode === "ALREADY_STREAMING" || result!.errorCode === "QUEUE_PENDING") {
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
      logger.error(`Delivery attempt ${attempt} threw an exception`, {
        wsId,
        agentId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    if (attempt < MAX_RETRIES) {
      yield* delay(RETRY_DELAY_MS * attempt);
    }
  }

  // All retries exhausted
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

  // Collect oneShot subscription IDs for cleanup after delivery
  const oneShotSubIds = new Set<string>();
  for (const qe of queue) {
    if (qe.oneShot && qe.subscriptionId) {
      oneShotSubIds.add(qe.subscriptionId);
    }
  }

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
// Root delivery saga
// ---------------------------------------------------------------------------

export function* deliverySaga() {
  yield* takeEvery(requestDeliverEvents, handleDeliverEvents);
  yield* takeEvery(requestDeliverQueuedEvents, handleDeliverQueuedEvents);
  yield* watchAgentIdleForDelivery();
}

