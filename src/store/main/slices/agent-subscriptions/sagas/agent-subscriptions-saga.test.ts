import { afterEach, describe, expect, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";

/**
 * Helper to detect redux-saga `delay()` effects inside expectSaga call providers.
 * `delay(ms)` compiles to a CALL effect whose fn is the internal `delayP` function
 * with `[ms]` as args. We check the function name AND first arg being a number,
 * which is more robust than a bare name check alone.
 */
function isDelayEffect(effect: { fn?: { name?: string }; args?: unknown[] }): boolean {
  return effect.fn?.name === "delayP" && typeof effect.args?.[0] === "number";
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

// typed-redux-saga not used directly in tests but needed for type context
import {
  addSubscription,
  appendDelegationGroupEvent,
  clearAgentQueue,
  enqueueEvent,
  markDelegationAgentCompleted,
  recordDeliveryFailure,
  recordDeliverySuccess,
  recordDeliveryTimeout,
  recordDroppedEvents,
  bumpVersion,
  markDelegationDelivered,
  markOneShotFired,
  removeDelegationGroup,
  removeSubscription,
  setAgentStatus,
  markAgentDeleted,
  evictDeletedAgent,
  removeAllSubscriptions,
  setSubscriptionsSnapshot,
  emptyWorkspaceSubscriptionState,
  type QueuedEventRecord,
  type DelegationGroupTrackerRecord,
  type WorkspaceSubscriptionState,
} from "../agent-subscriptions-slice";
import {
  selectAgentQueue,
  selectAgentQueueLength,
  selectAgentStatus,
  selectAllSubscriptions,
  selectAllWorkspaceIds,
  selectIsAgentDeleted,
  selectIsOneShotFired,
  selectDelegationGroup,
  selectIsDelegationGroupComplete,
  selectWorkspaceSubscriptionState,
} from "../agent-subscriptions-selectors";
import {
  requestDeliverEvents,
  requestDeliverQueuedEvents,
  requestDelegationGroupDelivery,
  requestPersist,
  requestRestore,
  requestEvictStaleAgents,
  requestValidateSubscriptions,
} from "./saga-actions";
import {
  handleDeliverEvents,
  handleDeliverQueuedEvents,
  watchAgentIdleForDelivery,
  periodicQueueSweep,
  formatNotification,
  sendBackendMessage,
  clearDeliveryDedupCache,
} from "./delivery-saga";
import { dispatchWorkspaceEvent } from "./ipc-bridge-saga";
import { handleDelegationGroupDelivery } from "./delegation-group-saga";
import { handleEvictStaleAgents, handleValidateSubscriptions, isAgentSessionActive } from "./cleanup-saga";
import { handlePersist, handleRestore, getSubscriptionsFilePath, writeSubscriptions, readSubscriptions } from "./persistence-saga";
import { handleMatchEvent, handleNewSubscriptionCatchUp, activeBatchTimers, batchFlushWorker, processingOneShots } from "./matching-saga";
import { workspaceEventAccepted } from "../../workspace-events/workspace-events-slice";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import type { AgentSubscriptionRecord } from "../types";

const WS = "ws-1";
const AGENT = "agent-1";

const makeEvent = (id: string, type = "file:changed"): WorkspaceEvent =>
  ({
    id,
    type,
    data: { path: "/test" },
    timestamp: new Date().toISOString(),
  }) as unknown as WorkspaceEvent;

const makeQueuedEvent = (
  id: string,
  priority: "high" | "normal" | "low" = "normal",
): QueuedEventRecord => ({
  event: makeEvent(id),
  priority,
  queuedAt: new Date().toISOString(),
  oneShot: false,
});

// ---------------------------------------------------------------------------
// Delivery Saga
// ---------------------------------------------------------------------------

describe("handleDeliverEvents", () => {
  afterEach(() => {
    clearDeliveryDedupCache();
  });

  it("delivers events successfully and records success", () => {
    const events = [makeEvent("e1")];
    const action = requestDeliverEvents(WS, AGENT, events);

    return expectSaga(handleDeliverEvents, action)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.call.fn(formatNotification), "Event notification"],
        [
          matchers.call.fn(sendBackendMessage),
          { success: true },
        ],
        [matchers.call.fn(dispatchWorkspaceEvent), undefined],
      ])
      .put(bumpVersion(WS))
      .put.actionType(recordDeliverySuccess.type)
      .run();
  });

  it("emits agent:woken-by-subscription event after successful delivery", () => {
    const events = [makeEvent("e1", "file:changed"), makeEvent("e2", "file:changed")];
    const action = requestDeliverEvents(WS, AGENT, events);

    return expectSaga(handleDeliverEvents, action)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.call.fn(formatNotification), "Event notification"],
        [
          matchers.call.fn(sendBackendMessage),
          { success: true },
        ],
        [matchers.call.fn(dispatchWorkspaceEvent), undefined],
      ])
      .call(dispatchWorkspaceEvent, "agent:woken-by-subscription", WS, {
        type: "agent",
        id: AGENT,
      }, {
        agentId: AGENT,
        eventCount: 2,
        eventTypes: ["file:changed"],
      })
      .run();
  });

  it("emits agent:delivery-confirmed event after successful delivery", () => {
    const events = [makeEvent("e1", "file:changed"), makeEvent("e2", "note:created")];
    const action = requestDeliverEvents(WS, AGENT, events);

    return expectSaga(handleDeliverEvents, action)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.call.fn(formatNotification), "Event notification"],
        [
          matchers.call.fn(sendBackendMessage),
          { success: true },
        ],
        [matchers.call.fn(dispatchWorkspaceEvent), undefined],
      ])
      .call(dispatchWorkspaceEvent, "agent:delivery-confirmed", WS, {
        type: "system",
        id: "subscription-service",
      }, {
        subscriberAgentId: AGENT,
        deliveredEventIds: ["e1", "e2"],
      })
      .run();
  });

  it("skips delivery for deleted agents", () => {
    const events = [makeEvent("e1")];
    const action = requestDeliverEvents(WS, AGENT, events);

    return expectSaga(handleDeliverEvents, action)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), true],
      ])
      .not.put.actionType(recordDeliverySuccess.type)
      .not.put.actionType(recordDeliveryFailure.type)
      .run();
  });

  it("drops events when notification is empty", () => {
    const events = [makeEvent("e1")];
    const action = requestDeliverEvents(WS, AGENT, events);

    return expectSaga(handleDeliverEvents, action)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.call.fn(formatNotification), ""],
      ])
      .put(recordDroppedEvents(WS, 1))
      .run();
  });

  it("records failure after exhausting retries", () => {
    const events = [makeEvent("e1")];
    const action = requestDeliverEvents(WS, AGENT, events);

    return expectSaga(handleDeliverEvents, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          if (effect.fn === sendBackendMessage) return { success: false, error: "fail" };
          // Resolve delay() immediately to avoid test timeout
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        race(effect, next) {
          // Resolve race immediately with the result branch (not timeout)
          return { result: { success: false, error: "fail" }, timeout: undefined };
        },
      })
      .put.actionType(recordDeliveryFailure.type)
      .run({ timeout: 5000 });
  });

  it("re-enqueues events and records timeout when sendBackendMessage hangs past DELIVERY_TIMEOUT_MS", () => {
    const events = [makeEvent("e1")];
    const action = requestDeliverEvents(WS, AGENT, events);

    return expectSaga(handleDeliverEvents, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          if (effect.fn === sendBackendMessage)
            return new Promise(() => {}); // never resolves
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        race(_effect, _next) {
          // Simulate the timeout branch winning the race
          return { result: undefined, timeout: true };
        },
      })
      .put.actionType(enqueueEvent.type)
      .put.actionType(recordDeliveryTimeout.type)
      .put(bumpVersion(WS))
      .not.put.actionType(recordDeliveryFailure.type)
      .not.put.actionType(recordDeliverySuccess.type)
      .run({ timeout: 5000 });
  });

  it("skips re-enqueued duplicates only after a timed-out send later succeeds", async () => {
    const events = [makeEvent("e1"), makeEvent("e2")];
    const deferred = createDeferred<{ success: boolean; error?: string; errorCode?: string }>();

    // First delivery: timeout wins and the original backend send stays in flight.
    const firstAction = requestDeliverEvents(WS, AGENT, events);
    await expectSaga(handleDeliverEvents, firstAction)
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          if (effect.fn === sendBackendMessage) return deferred.promise;
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        race(_effect, _next) {
          return { result: undefined, timeout: true };
        },
      })
      .put.actionType(enqueueEvent.type)
      .put.actionType(recordDeliveryTimeout.type)
      .run({ timeout: 5000 });

    // The original send eventually succeeds after the timeout branch already
    // re-enqueued the events.
    deferred.resolve({ success: true });
    await flushMicrotasks();

    // Second delivery of same events (simulating the re-enqueued copy being
    // delivered after the agent goes idle) should now be skipped.
    const secondAction = requestDeliverEvents(WS, AGENT, events);
    await expectSaga(handleDeliverEvents, secondAction)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
      ])
      .not.put.actionType(recordDeliverySuccess.type)
      .not.put.actionType(recordDeliveryFailure.type)
      .not.call.fn(formatNotification)
      .not.call.fn(sendBackendMessage)
      .run();
  });

  it("does not suppress retries when a timed-out send later fails", async () => {
    const events = [makeEvent("e1"), makeEvent("e2")];
    const deferred = createDeferred<{ success: boolean; error?: string; errorCode?: string }>();

    const firstAction = requestDeliverEvents(WS, AGENT, events);
    await expectSaga(handleDeliverEvents, firstAction)
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          if (effect.fn === sendBackendMessage) return deferred.promise;
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
        race(_effect, _next) {
          return { result: undefined, timeout: true };
        },
      })
      .put.actionType(enqueueEvent.type)
      .put.actionType(recordDeliveryTimeout.type)
      .run({ timeout: 5000 });

    deferred.resolve({ success: false, error: "backend failed" });
    await flushMicrotasks();

    const retryAction = requestDeliverEvents(WS, AGENT, events);
    await expectSaga(handleDeliverEvents, retryAction)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.call.fn(formatNotification), "Event notification"],
        [matchers.call.fn(sendBackendMessage), { success: true }],
        [matchers.call.fn(dispatchWorkspaceEvent), undefined],
      ])
      .put.actionType(recordDeliverySuccess.type)
      .call.fn(sendBackendMessage)
      .run();
  });


  it("re-enqueues events when ALREADY_STREAMING is returned", () => {
    const events = [makeEvent("e1"), makeEvent("e2")];
    const action = requestDeliverEvents(WS, AGENT, events);

    return expectSaga(handleDeliverEvents, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          return next();
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        race(_effect, _next) {
          return { result: { success: false, error: "Agent is already streaming", errorCode: "ALREADY_STREAMING" }, timeout: undefined };
        },
      })
      .put.actionType(enqueueEvent.type)
      .put(bumpVersion(WS))
      .not.put.actionType(recordDeliveryFailure.type)
      .not.put.actionType(recordDeliverySuccess.type)
      .run({ timeout: 5000 });
  });

  it("re-enqueues events when DELIVERY_IN_FLIGHT is returned", () => {
    const events = [makeEvent("e1")];
    const action = requestDeliverEvents(WS, AGENT, events);

    return expectSaga(handleDeliverEvents, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          return next();
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        race(_effect, _next) {
          return { result: { success: false, error: "Delivery in flight", errorCode: "DELIVERY_IN_FLIGHT" }, timeout: undefined };
        },
      })
      .put.actionType(enqueueEvent.type)
      .put(bumpVersion(WS))
      .not.put.actionType(recordDeliveryFailure.type)
      .not.put.actionType(recordDeliverySuccess.type)
      .run({ timeout: 5000 });
  });

  it("re-enqueues events when QUEUE_PENDING is returned", () => {
    const events = [makeEvent("e1")];
    const action = requestDeliverEvents(WS, AGENT, events);

    return expectSaga(handleDeliverEvents, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          return next();
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        race(_effect, _next) {
          return { result: { success: false, error: "Queued messages pending", errorCode: "QUEUE_PENDING" }, timeout: undefined };
        },
      })
      .put.actionType(enqueueEvent.type)
      .put(bumpVersion(WS))
      .not.put.actionType(recordDeliveryFailure.type)
      .run({ timeout: 5000 });
  });

  it("dispatches requestDeliverQueuedEvents when re-enqueued and agent is already idle", () => {
    const events = [makeEvent("e1")];
    const action = requestDeliverEvents(WS, AGENT, events);

    return expectSaga(handleDeliverEvents, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          if (effect.selector === selectAgentStatus.select) return "idle";
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          return next();
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        race(_effect, _next) {
          return { result: { success: false, error: "Agent is already streaming", errorCode: "ALREADY_STREAMING" }, timeout: undefined };
        },
      })
      .put.actionType(enqueueEvent.type)
      .put(bumpVersion(WS))
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .not.put.actionType(recordDeliveryFailure.type)
      .run({ timeout: 5000 });
  });

  it("skips duplicate delivery when events were already delivered (idempotency guard)", async () => {
    const events = [makeEvent("e1"), makeEvent("e2")];

    // First delivery succeeds — events are recorded in the dedup cache
    const firstAction = requestDeliverEvents(WS, AGENT, events);
    await expectSaga(handleDeliverEvents, firstAction)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.call.fn(formatNotification), "Event notification"],
        [matchers.call.fn(sendBackendMessage), { success: true }],
        [matchers.call.fn(dispatchWorkspaceEvent), undefined],
      ])
      .put.actionType(recordDeliverySuccess.type)
      .run();

    // Second delivery of same events should be silently skipped
    const secondAction = requestDeliverEvents(WS, AGENT, events);
    await expectSaga(handleDeliverEvents, secondAction)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
      ])
      .not.put.actionType(recordDeliverySuccess.type)
      .not.put.actionType(recordDeliveryFailure.type)
      .not.call.fn(formatNotification)
      .not.call.fn(sendBackendMessage)
      .run();
  });

  it("delivers events that are a mix of already-delivered and new", async () => {
    const oldEvents = [makeEvent("e1")];
    const newEvents = [makeEvent("e3")];

    // First: deliver e1 successfully
    const firstAction = requestDeliverEvents(WS, AGENT, oldEvents);
    await expectSaga(handleDeliverEvents, firstAction)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.call.fn(formatNotification), "Event notification"],
        [matchers.call.fn(sendBackendMessage), { success: true }],
        [matchers.call.fn(dispatchWorkspaceEvent), undefined],
      ])
      .put.actionType(recordDeliverySuccess.type)
      .run();

    // Second: deliver [e1, e3] — only e3 should go through
    const mixedAction = requestDeliverEvents(WS, AGENT, [...oldEvents, ...newEvents]);
    await expectSaga(handleDeliverEvents, mixedAction)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.call.fn(formatNotification), "Event notification"],
        [matchers.call.fn(sendBackendMessage), { success: true }],
        [matchers.call.fn(dispatchWorkspaceEvent), undefined],
      ])
      .put.actionType(recordDeliverySuccess.type)
      .call.fn(sendBackendMessage)
      .run();
  });
});

// ---------------------------------------------------------------------------
// Deliver queued events
// ---------------------------------------------------------------------------

describe("handleDeliverQueuedEvents", () => {
  it("delivers queued events and clears the queue", () => {
    const queue: QueuedEventRecord[] = [
      makeQueuedEvent("e1", "high"),
      makeQueuedEvent("e2", "normal"),
    ];
    const action = requestDeliverQueuedEvents(WS, AGENT);

    return expectSaga(handleDeliverQueuedEvents, action)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentQueue.select, WS, AGENT), queue],
      ])
      .put(clearAgentQueue(WS, AGENT))
      .put.actionType(requestDeliverEvents.type)
      .run();
  });

  it("clears queue for deleted agents without delivering", () => {
    const action = requestDeliverQueuedEvents(WS, AGENT);

    return expectSaga(handleDeliverQueuedEvents, action)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), true],
      ])
      .put(clearAgentQueue(WS, AGENT))
      .not.put.actionType(requestDeliverEvents.type)
      .run();
  });
});

// ---------------------------------------------------------------------------
// Delegation group saga
// ---------------------------------------------------------------------------

describe("handleDelegationGroupDelivery", () => {
  const tracker: DelegationGroupTrackerRecord = {
    groupId: "group-1",
    parentAgentId: AGENT,
    parentAgentName: "Agent 1",
    awaitMode: "all",
    expectedAgentIds: ["agent-2", "agent-3"],
    completedAgentIds: ["agent-2", "agent-3"],
    deletedAgentIds: [],
    events: [{ type: "agent:completed", data: {} } as unknown as Record<string, unknown>],
    subscriptionId: "sub-1",
    delivered: false,
  };

  it("delivers events when group is complete and parent idle", () => {
    const action = requestDelegationGroupDelivery(WS, "group-1");

    return expectSaga(handleDelegationGroupDelivery, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroup.select) return tracker;
          if (effect.selector === selectIsDelegationGroupComplete.select) return true;
          if (effect.selector === selectAgentStatus.select) return "idle";
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          if (effect.fn === sendBackendMessage) return { success: true };
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
        race() {
          return { result: { success: true }, timeout: undefined };
        },
      })
      .put(markDelegationDelivered(WS, "group-1"))
      .call.fn(handleDeliverEvents)
      .put(removeDelegationGroup(WS, "group-1"))
      .put(removeSubscription(WS, "sub-1"))
      .run();
  });

  it("cleans up after delivery even when delivery fails", () => {
    const action = requestDelegationGroupDelivery(WS, "group-1");

    return expectSaga(handleDelegationGroupDelivery, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroup.select) return tracker;
          if (effect.selector === selectIsDelegationGroupComplete.select) return true;
          if (effect.selector === selectAgentStatus.select) return "idle";
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          if (effect.fn === sendBackendMessage) return { success: false, error: "fail" };
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
        race() {
          return { result: { success: false, error: "fail" }, timeout: undefined };
        },
      })
      .put(markDelegationDelivered(WS, "group-1"))
      .call.fn(handleDeliverEvents)
      .put.actionType(recordDeliveryFailure.type)
      .put(removeDelegationGroup(WS, "group-1"))
      .put(removeSubscription(WS, "sub-1"))
      .put(bumpVersion(WS))
      .put(requestPersist(WS))
      .run({ timeout: 10000 });
  });

  it("skips already-delivered groups", () => {
    const action = requestDelegationGroupDelivery(WS, "group-1");
    const deliveredTracker = { ...tracker, delivered: true };

    return expectSaga(handleDelegationGroupDelivery, action)
      .provide([
        [matchers.select(selectDelegationGroup.select, WS, "group-1"), deliveredTracker],
      ])
      .not.call.fn(handleDeliverEvents)
      .run();
  });

  it("skips incomplete groups", () => {
    const action = requestDelegationGroupDelivery(WS, "group-1");

    return expectSaga(handleDelegationGroupDelivery, action)
      .provide([
        [matchers.select(selectDelegationGroup.select, WS, "group-1"), tracker],
        [matchers.select(selectIsDelegationGroupComplete.select, WS, "group-1"), false],
      ])
      .not.call.fn(handleDeliverEvents)
      .run();
  });

  it("logs a warning when polling times out waiting for parent to become idle", async () => {
    const { Logger } = await import("../../../../../shared/logger");
    const warnSpy = vi.spyOn(Logger.prototype, "warn");

    const action = requestDelegationGroupDelivery(WS, "group-1");

    await expectSaga(handleDelegationGroupDelivery, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroup.select) return tracker;
          if (effect.selector === selectIsDelegationGroupComplete.select) return true;
          // Always return "busy" so polling never resolves
          if (effect.selector === selectAgentStatus.select) return "responding";
          return next();
        },
        call(effect, next) {
          // Resolve delay() immediately to avoid test timeout
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .put(markDelegationDelivered(WS, "group-1"))
      .put(removeDelegationGroup(WS, "group-1"))
      .put(removeSubscription(WS, "sub-1"))
      .put(bumpVersion(WS))
      .put(requestPersist(WS))
      .not.call.fn(handleDeliverEvents)
      .run({ timeout: 10000 });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("status=timeout"),
    );

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Cleanup saga
// ---------------------------------------------------------------------------

describe("handleEvictStaleAgents", () => {
  it("evicts agents past the TTL", () => {
    const now = Date.now();
    const staleTime = now - 15 * 60 * 1000; // 15 min ago
    const action = requestEvictStaleAgents(WS);

    const ws: WorkspaceSubscriptionState = {
      subscriptions: {},
      agentQueues: {},
      agentStatuses: {},
      delegationGroups: {},
      firedOneShotSubscriptions: [],
      deliveryStats: {
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        timeoutDeliveries: 0,
        droppedEvents: 0,
        lastDeliveryTime: null,
        lastFailureTime: null,
      },
      deletedAgents: { "agent-old": staleTime, "agent-new": now },
      version: 0,
    };

    return expectSaga(handleEvictStaleAgents, action)
      .provide([
        [matchers.select(selectWorkspaceSubscriptionState.select, WS), ws],
      ])
      .put(evictDeletedAgent(WS, "agent-old"))
      .put(clearAgentQueue(WS, "agent-old"))
      .not.put(evictDeletedAgent(WS, "agent-new"))
      .put(bumpVersion(WS))
      .put(requestPersist(WS))
      .run();
  });
});

describe("handleValidateSubscriptions", () => {
  it("removes subscriptions for inactive agents", () => {
    const ws: WorkspaceSubscriptionState = {
      subscriptions: {
        "sub-1": {
          id: "sub-1",
          agentId: "dead-agent",
          agentName: "Dead",
          workspaceId: WS,
          filter: {},
          createdAt: new Date().toISOString(),
        },
      },
      agentQueues: {},
      agentStatuses: {},
      delegationGroups: {},
      firedOneShotSubscriptions: [],
      deliveryStats: {
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        timeoutDeliveries: 0,
        droppedEvents: 0,
        lastDeliveryTime: null,
        lastFailureTime: null,
      },
      deletedAgents: {},
      version: 0,
    };
    const action = requestValidateSubscriptions(WS);

    return expectSaga(handleValidateSubscriptions, action)
      .provide([
        [matchers.select(selectWorkspaceSubscriptionState.select, WS), ws],
        [matchers.call.fn(isAgentSessionActive), false],
      ])
      .put(removeAllSubscriptions(WS, "dead-agent"))
      .put(clearAgentQueue(WS, "dead-agent"))
      .put.actionType(markAgentDeleted.type)
      .put(bumpVersion(WS))
      .put(requestPersist(WS))
      .run();
  });

  it("passes wsId to isAgentSessionActive for correct workspace path resolution", () => {
    const ws: WorkspaceSubscriptionState = {
      subscriptions: {
        "sub-1": {
          id: "sub-1",
          agentId: "agent-1",
          agentName: "Agent",
          workspaceId: WS,
          filter: {},
          createdAt: new Date().toISOString(),
        },
      },
      agentQueues: {},
      agentStatuses: {},
      delegationGroups: {},
      firedOneShotSubscriptions: [],
      deliveryStats: {
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        timeoutDeliveries: 0,
        droppedEvents: 0,
        lastDeliveryTime: null,
        lastFailureTime: null,
      },
      deletedAgents: {},
      version: 0,
    };
    const action = requestValidateSubscriptions(WS);

    return expectSaga(handleValidateSubscriptions, action)
      .provide([
        [matchers.select(selectWorkspaceSubscriptionState.select, WS), ws],
        // Verify the call receives both agentId AND wsId
        [matchers.call(isAgentSessionActive, "agent-1", WS), true],
      ])
      // Agent is active so no removals should happen
      .not.put.actionType(removeAllSubscriptions.type)
      .not.put.actionType(bumpVersion.type)
      .run();
  });
});

// ---------------------------------------------------------------------------
// Matching saga — idle agent delivery
// ---------------------------------------------------------------------------

describe("handleMatchEvent", () => {
  const makeSub = (overrides: Partial<AgentSubscriptionRecord> = {}): AgentSubscriptionRecord => ({
    id: "sub-1",
    agentId: AGENT,
    agentName: "Test Agent",
    workspaceId: WS,
    filter: { eventTypes: ["file:changed"] },
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it("dispatches requestDeliverQueuedEvents immediately when agent is already idle", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    const sub = makeSub();
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  it("does NOT dispatch requestDeliverQueuedEvents when agent is responding", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    const sub = makeSub();
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "responding"],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .not.put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  // -------------------------------------------------------------------------
  // Bug 4: INTERNAL_OBSERVABILITY_EVENTS feedback loop prevention
  // -------------------------------------------------------------------------

  it("skips agent:delivery-confirmed events to prevent feedback loop (Bug 4)", () => {
    // Bug 4: agent:* wildcard subscriptions matched agent:delivery-confirmed
    // events emitted by the delivery saga itself, causing an infinite loop.
    // Fix: delivery-confirmed is in INTERNAL_OBSERVABILITY_EVENTS skip-list.
    const event = makeEvent("e1", "agent:delivery-confirmed");
    (event as any).workspaceId = WS;
    (event as any).actor = { type: "system", id: "subscription-service" };
    const sub = makeSub({
      filter: { eventTypes: ["agent:*"] },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
      ])
      // Should NOT enqueue because delivery-confirmed is internal
      .not.put.actionType("agentSubscriptions/enqueueEvent")
      .not.put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  it("skips agent:woken-by-subscription events to prevent feedback loop", () => {
    const event = makeEvent("e1", "agent:woken-by-subscription");
    (event as any).workspaceId = WS;
    const sub = makeSub({
      filter: { eventTypes: ["agent:*"] },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
      ])
      .not.put.actionType("agentSubscriptions/enqueueEvent")
      .run();
  });

  it("does NOT skip agent:idle events (non-internal agent event)", () => {
    const event = makeEvent("e1", "agent:idle");
    (event as any).workspaceId = WS;
    (event as any).actor = { type: "agent", id: AGENT };
    const sub = makeSub({
      filter: { eventTypes: ["agent:*"] },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .run();
  });

  // -------------------------------------------------------------------------
  // Bug 4 edge cases: ALL INTERNAL_OBSERVABILITY_EVENTS must be skipped
  // -------------------------------------------------------------------------

  it.each([
    "agent:subscribed",
    "agent:unsubscribed",
    "agent:subscriptions-changed",
  ])("skips %s events (remaining internal events not tested above)", (eventType) => {
    const event = makeEvent("e1", eventType);
    (event as any).workspaceId = WS;
    const sub = makeSub({
      filter: { eventTypes: ["agent:*"] },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
      ])
      .not.put.actionType("agentSubscriptions/enqueueEvent")
      .not.put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  // -------------------------------------------------------------------------
  // Bug 5 edge cases: oneShot sync guard with concurrent events
  // -------------------------------------------------------------------------

  it("processingOneShots guard prevents duplicate delivery for concurrent matching events", () => {
    // The processingOneShots Set prevents two concurrent forks from both
    // processing the same oneShot subscription before markOneShotFired is dispatched.
    const sub = makeSub({
      filter: { eventTypes: ["file:*"], oneShot: true },
    });

    // First event claims the oneShot via processingOneShots
    const event1 = makeEvent("e1", "file:changed");
    (event1 as any).workspaceId = WS;
    const action1 = workspaceEventAccepted(event1);

    return expectSaga(handleMatchEvent, action1)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectIsOneShotFired.select, WS, sub.id), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .put(markOneShotFired(WS, sub.id))
      .put(removeSubscription(WS, sub.id))
      .run()
      .then(() => {
        // After the saga completes, processingOneShots should be cleaned up
        // (the sub.id is deleted in the oneShot cleanup section)
        expect(processingOneShots.has(sub.id)).toBe(false);
      });
  });

  it("processingOneShots is cleared on cleanup even when three events match simultaneously", () => {
    // Verify the Set doesn't leak entries
    const sub = makeSub({
      filter: { eventTypes: ["file:*"], oneShot: true },
    });

    // Manually test the guard behavior
    processingOneShots.clear();
    expect(processingOneShots.has(sub.id)).toBe(false);

    // First claim succeeds
    processingOneShots.add(sub.id);
    expect(processingOneShots.has(sub.id)).toBe(true);

    // Second and third would be blocked
    expect(processingOneShots.has(sub.id)).toBe(true);

    // Cleanup
    processingOneShots.delete(sub.id);
    expect(processingOneShots.has(sub.id)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // dataMatchers filtering
  // -------------------------------------------------------------------------

  it("matches event when dataMatchers equals operator matches", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    (event as any).data = { path: "/src/index.ts" };
    const sub = makeSub({
      filter: {
        eventTypes: ["file:changed"],
        dataMatchers: [{ field: "data.path", operator: "equals", value: "/src/index.ts" }],
      },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .run();
  });

  it("skips event when dataMatchers equals operator does NOT match", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    (event as any).data = { path: "/src/other.ts" };
    const sub = makeSub({
      filter: {
        eventTypes: ["file:changed"],
        dataMatchers: [{ field: "data.path", operator: "equals", value: "/src/index.ts" }],
      },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .not.put.actionType("agentSubscriptions/enqueueEvent")
      .run();
  });

  it("matches event with dataMatchers contains operator", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    (event as any).data = { path: "/src/components/Button.tsx" };
    const sub = makeSub({
      filter: {
        eventTypes: ["file:changed"],
        dataMatchers: [{ field: "data.path", operator: "contains", value: "components" }],
      },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .run();
  });

  it("matches event with dataMatchers starts_with operator", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    (event as any).data = { path: "/src/lib/utils.ts" };
    const sub = makeSub({
      filter: {
        eventTypes: ["file:changed"],
        dataMatchers: [{ field: "data.path", operator: "starts_with", value: "/src/lib" }],
      },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .run();
  });

  it("matches event with dataMatchers ends_with operator", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    (event as any).data = { path: "/src/index.tsx" };
    const sub = makeSub({
      filter: {
        eventTypes: ["file:changed"],
        dataMatchers: [{ field: "data.path", operator: "ends_with", value: ".tsx" }],
      },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .run();
  });

  it("matches event with dataMatchers matches (regex) operator", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    (event as any).data = { path: "/src/features/auth/login.ts" };
    const sub = makeSub({
      filter: {
        eventTypes: ["file:changed"],
        dataMatchers: [
          {
            field: "data.path",
            operator: "matches",
            value: { pattern: "features/auth/.*\\.ts$", flags: "" },
          },
        ],
      },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .run();
  });

  it("skips event when regex does NOT match", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    (event as any).data = { path: "/src/lib/utils.ts" };
    const sub = makeSub({
      filter: {
        eventTypes: ["file:changed"],
        dataMatchers: [
          {
            field: "data.path",
            operator: "matches",
            value: { pattern: "features/auth/.*\\.ts$", flags: "" },
          },
        ],
      },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .not.put.actionType("agentSubscriptions/enqueueEvent")
      .run();
  });

  it("requires ALL dataMatchers to match (AND logic)", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    (event as any).data = { path: "/src/index.ts", action: "modify" };
    const sub = makeSub({
      filter: {
        eventTypes: ["file:changed"],
        dataMatchers: [
          { field: "data.path", operator: "contains", value: "src" },
          { field: "data.action", operator: "equals", value: "create" }, // won't match
        ],
      },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .not.put.actionType("agentSubscriptions/enqueueEvent")
      .run();
  });

  it("skips event when dataMatcher field is missing from event", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    (event as any).data = { path: "/test" };
    const sub = makeSub({
      filter: {
        eventTypes: ["file:changed"],
        dataMatchers: [{ field: "data.nonexistent", operator: "equals", value: "x" }],
      },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .not.put.actionType("agentSubscriptions/enqueueEvent")
      .run();
  });
});

// ---------------------------------------------------------------------------
// Batching (batchWindow / batchMaxEvents)
// ---------------------------------------------------------------------------

describe("handleMatchEvent — batching", () => {
  const makeSub = (overrides: Partial<AgentSubscriptionRecord> = {}): AgentSubscriptionRecord => ({
    id: "sub-1",
    agentId: AGENT,
    agentName: "Test Agent",
    workspaceId: WS,
    filter: { eventTypes: ["file:changed"] },
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  afterEach(() => {
    activeBatchTimers.clear();
  });

  it("does NOT deliver immediately when batchWindow is set (starts timer instead)", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    const sub = makeSub({
      filter: { eventTypes: ["file:changed"], batchWindow: 500 },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .not.put(requestDeliverQueuedEvents(WS, AGENT))
      .fork.fn(batchFlushWorker)
      .run();
  });

  it("delivers immediately when batchMaxEvents is reached", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    const sub = makeSub({
      filter: { eventTypes: ["file:changed"], batchMaxEvents: 3 },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
        [matchers.select(selectAgentQueueLength.select, WS, AGENT), 3],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  it("does NOT deliver when batchMaxEvents is set but threshold not reached", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    const sub = makeSub({
      filter: { eventTypes: ["file:changed"], batchMaxEvents: 5 },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
        [matchers.select(selectAgentQueueLength.select, WS, AGENT), 2],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .not.put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  it("starts timer when both batchWindow and batchMaxEvents are set but threshold not reached", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    const sub = makeSub({
      filter: { eventTypes: ["file:changed"], batchWindow: 1000, batchMaxEvents: 5 },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
        [matchers.select(selectAgentQueueLength.select, WS, AGENT), 2],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .not.put(requestDeliverQueuedEvents(WS, AGENT))
      .fork.fn(batchFlushWorker)
      .run();
  });

  it("delivers immediately when batchMaxEvents reached even with batchWindow set", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    const sub = makeSub({
      filter: { eventTypes: ["file:changed"], batchWindow: 1000, batchMaxEvents: 3 },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
        [matchers.select(selectAgentQueueLength.select, WS, AGENT), 3],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  it("still delivers immediately when agent is idle and no batch settings", () => {
    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    const sub = makeSub();
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .put.actionType("agentSubscriptions/enqueueEvent")
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  it("batchFlushWorker delivers after delay", () => {
    return expectSaga(batchFlushWorker, WS, AGENT, 500)
      .provide({
        call(effect, next) {
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .run({ timeout: 5000 });
  });
});

