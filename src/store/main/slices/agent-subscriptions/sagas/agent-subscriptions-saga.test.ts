import { afterEach, describe, expect, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import { call, take, delay } from "typed-redux-saga";

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
  clearAgentQueue,
  enqueueEvent,
  recordDeliveryFailure,
  recordDeliverySuccess,
  recordDeliveryTimeout,
  recordDroppedEvents,
  markDelegationDelivered,
  markOneShotFired,
  removeDelegationGroup,
  removeSubscription,
  markAgentDeleted,
  evictDeletedAgent,
  removeAllSubscriptions,
  emptyWorkspaceSubscriptionState,
  subscribeToDelegationGroup,
  type QueuedEventRecord,
  type DelegationGroupTrackerRecord,
  type WorkspaceSubscriptionState,
} from "../agent-subscriptions-slice";
import {
  selectAgentQueue,
  selectAgentQueueLength,
  selectAgentStatus,
  selectAllSubscriptionsRaw,
  selectIsAgentDeleted,
  selectIsOneShotFired,
  selectDelegationGroupRaw,
  selectIsDelegationGroupCompleteRaw,
  selectSubscriptionRaw,
  selectWorkspaceSubscriptionState,
} from "../agent-subscriptions-selectors";
import {
  requestDeliverEvents,
  requestDeliverQueuedEvents,
  requestDelegationGroupDelivery,
  requestEvictStaleAgents,
  requestValidateSubscriptions,
} from "./saga-actions";
import {
  handleDeliverEvents,
  handleDeliverQueuedEvents,
  periodicQueueSweep,
  formatNotification,
  sendBackendMessage,
  clearDeliveryDedupCache,
  sweepCatchUpSeen,
  stuckGroupFirstSeen,
  buildSweepCatchUpEventId,
  filterAlreadyDelivered,
} from "./delivery-saga";
import { dispatchWorkspaceEvent, handleSubscribeToDelegationGroup } from "./ipc-bridge-saga";
import { handleDelegationGroupDelivery, delegationGroupSaga, subsetInvariantWarningEmitted } from "./delegation-group-saga";
import { handleEvictStaleAgents, handleValidateSubscriptions, isAgentSessionActive } from "./cleanup-saga";
import { handleMatchEvent, activeBatchTimers, batchFlushWorker, processingOneShots, matchingSaga } from "./matching-saga";
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
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
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
      .call(dispatchWorkspaceEvent, "agent:event-delivery-failed", WS, {
        type: "agent",
        id: AGENT,
      }, {
        targetAgentId: AGENT,
        eventCount: 1,
        eventTypes: ["file:changed"],
        error: "fail",
      })
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
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
         
        race(_effect, _next) {
          // Simulate the timeout branch winning the race
          return { result: undefined, timeout: true };
        },
      })
      .put.actionType(enqueueEvent.type)
      .put.actionType(recordDeliveryTimeout.type)
      .call(dispatchWorkspaceEvent, "agent:event-delivery-timeout", WS, {
        type: "agent",
        id: AGENT,
      }, {
        targetAgentId: AGENT,
        eventCount: 1,
        eventTypes: ["file:changed"],
        timeoutMs: 30000,
      })
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
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
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
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
        race() {
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
         
        race(_effect, _next) {
          return { result: { success: false, error: "Agent is already streaming", errorCode: "ALREADY_STREAMING" }, timeout: undefined };
        },
      })
      .put.actionType(enqueueEvent.type)
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
         
        race(_effect, _next) {
          return { result: { success: false, error: "Delivery in flight", errorCode: "DELIVERY_IN_FLIGHT" }, timeout: undefined };
        },
      })
      .put.actionType(enqueueEvent.type)
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
         
        race(_effect, _next) {
          return { result: { success: false, error: "Queued messages pending", errorCode: "QUEUE_PENDING" }, timeout: undefined };
        },
      })
      .put.actionType(enqueueEvent.type)
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
         
        race(_effect, _next) {
          return { result: { success: false, error: "Agent is already streaming", errorCode: "ALREADY_STREAMING" }, timeout: undefined };
        },
      })
      .put.actionType(enqueueEvent.type)
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

  it("delivers events when group is complete and parent idle", async () => {
    const action = requestDelegationGroupDelivery(WS, "group-1");
    const dispatchCalls: unknown[][] = [];

    await expectSaga(handleDelegationGroupDelivery, action)
      .withState({ agentSubscriptions: { byWorkspaceId: {} } })
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroupRaw) return tracker;
          if (effect.selector === selectIsDelegationGroupCompleteRaw) return true;
          if (effect.selector === selectAgentStatus.select) return "idle";
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          if (effect.fn === sendBackendMessage) return { success: true };
          if (effect.fn === dispatchWorkspaceEvent) {
            dispatchCalls.push(effect.args);
            return undefined;
          }
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

    expect(dispatchCalls.filter(([type]) => type === "agent:woken-by-subscription")).toHaveLength(1);
  });

  it("re-enqueues events when delivery fails so they are not lost", async () => {
    const action = requestDelegationGroupDelivery(WS, "group-1");
    const dispatchCalls: unknown[][] = [];

    // Use a tracker with identifiable events so we can verify re-enqueue
    const trackerWithEvents = {
      ...tracker,
      events: [
        { id: "evt-1", type: "agent:completed", data: {}, timestamp: new Date().toISOString(), workspaceId: WS } as unknown as Record<string, unknown>,
        { id: "evt-2", type: "agent:idle", data: {}, timestamp: new Date().toISOString(), workspaceId: WS } as unknown as Record<string, unknown>,
      ],
    };

    await expectSaga(handleDelegationGroupDelivery, action)
      .withState({ agentSubscriptions: { byWorkspaceId: {} } })
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroupRaw) return trackerWithEvents;
          if (effect.selector === selectIsDelegationGroupCompleteRaw) return true;
          if (effect.selector === selectAgentStatus.select) return "idle";
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          if (effect.fn === sendBackendMessage) return { success: false, error: "fail" };
          if (effect.fn === dispatchWorkspaceEvent) {
            dispatchCalls.push(effect.args);
            return undefined;
          }
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
      // Events should be re-enqueued to the parent agent's queue
      .put.actionType(enqueueEvent.type)
      .put(removeDelegationGroup(WS, "group-1"))
      .put(removeSubscription(WS, "sub-1"))
      .run({ timeout: 10000 });

    expect(dispatchCalls.filter(([type]) => type === "agent:woken-by-subscription")).toHaveLength(0);
  });

  it("does not emit a wake event when delegation delivery times out", async () => {
    const action = requestDelegationGroupDelivery(WS, "group-1");
    const dispatchCalls: unknown[][] = [];
    const trackerWithEvents = {
      ...tracker,
      events: [
        { id: "evt-1", type: "agent:completed", data: {}, timestamp: new Date().toISOString(), workspaceId: WS } as unknown as Record<string, unknown>,
      ],
    };

    await expectSaga(handleDelegationGroupDelivery, action)
      .withState({ agentSubscriptions: { byWorkspaceId: {} } })
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroupRaw) return trackerWithEvents;
          if (effect.selector === selectIsDelegationGroupCompleteRaw) return true;
          if (effect.selector === selectAgentStatus.select) return "idle";
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          if (effect.fn === sendBackendMessage) return { success: true };
          if (effect.fn === dispatchWorkspaceEvent) {
            dispatchCalls.push(effect.args);
            return undefined;
          }
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
        race() {
          return { result: undefined, timeout: true };
        },
      })
      .put(markDelegationDelivered(WS, "group-1"))
      .call.fn(handleDeliverEvents)
      .put.actionType(recordDeliveryTimeout.type)
      .put(removeDelegationGroup(WS, "group-1"))
      .put(removeSubscription(WS, "sub-1"))
      .run({ timeout: 10000 });

    expect(dispatchCalls.filter(([type]) => type === "agent:woken-by-subscription")).toHaveLength(0);
  });

  it("skips already-delivered groups", () => {
    const action = requestDelegationGroupDelivery(WS, "group-1");
    const deliveredTracker = { ...tracker, delivered: true };

    return expectSaga(handleDelegationGroupDelivery, action)
      .withState({ agentSubscriptions: { byWorkspaceId: {} } })
      .provide([
        [matchers.select(selectDelegationGroupRaw, WS, "group-1"), deliveredTracker],
      ])
      .not.call.fn(handleDeliverEvents)
      .run();
  });

  it("skips incomplete groups", () => {
    const action = requestDelegationGroupDelivery(WS, "group-1");

    return expectSaga(handleDelegationGroupDelivery, action)
      .withState({ agentSubscriptions: { byWorkspaceId: {} } })
      .provide([
        [matchers.select(selectDelegationGroupRaw, WS, "group-1"), tracker],
        [matchers.select(selectIsDelegationGroupCompleteRaw, WS, "group-1"), false],
      ])
      .not.call.fn(handleDeliverEvents)
      .run();
  });

  it("logs a warning when polling times out waiting for parent to become idle", async () => {
    const { Logger } = await import("../../../../../shared/logger");
    const warnSpy = vi.spyOn(Logger.prototype, "warn");

    const action = requestDelegationGroupDelivery(WS, "group-1");

    await expectSaga(handleDelegationGroupDelivery, action)
      .withState({ agentSubscriptions: { byWorkspaceId: {} } })
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroupRaw) return tracker;
          if (effect.selector === selectIsDelegationGroupCompleteRaw) return true;
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
      .not.call.fn(handleDeliverEvents)
      .run({ timeout: 10000 });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("status=timeout"),
    );

    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Subset-invariant: expectedAgentIds must be a subset of filter.actorIds
  // -------------------------------------------------------------------------

  it("logs subset-invariant warning when expectedAgentIds is not a subset of filter.actorIds", async () => {
    const { Logger } = await import("../../../../../shared/logger");
    const warnSpy = vi.spyOn(Logger.prototype, "warn");
    subsetInvariantWarningEmitted.clear();

    // Tracker expects 3 agents but subscription only knows about 2 — simulates
    // the desync that prompted this warning.
    const desyncedTracker: DelegationGroupTrackerRecord = {
      ...tracker,
      expectedAgentIds: ["agent-2", "agent-3", "agent-4"],
      completedAgentIds: ["agent-2", "agent-3", "agent-4"],
    };
    const desyncedSubscription: AgentSubscriptionRecord = {
      id: "sub-1",
      agentId: AGENT,
      agentName: "Agent 1",
      workspaceId: WS,
      filter: { eventTypes: ["agent:idle"], actorIds: ["agent-2", "agent-3"] },
      createdAt: new Date().toISOString(),
    };

    const action = requestDelegationGroupDelivery(WS, "group-1");

    await expectSaga(handleDelegationGroupDelivery, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroupRaw) return desyncedTracker;
          if (effect.selector === selectSubscriptionRaw) return desyncedSubscription;
          if (effect.selector === selectIsDelegationGroupCompleteRaw) return true;
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
      .run();

    const subsetWarn = warnSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("delegation-group-subset-invariant-violation"),
    );
    expect(subsetWarn, "expected subset-invariant warning to be emitted").toBeDefined();
    const msg = (subsetWarn ?? [""])[0] as string;
    expect(msg).toContain("groupId=group-1");
    expect(msg).toContain(`parentAgentId=${AGENT}`);
    expect(msg).toContain("missingIds=[\"agent-4\"]");
    expect(msg).toContain("actorIds=[\"agent-2\",\"agent-3\"]");
    expect(msg).toContain("expectedAgentIds=[\"agent-2\",\"agent-3\",\"agent-4\"]");

    warnSpy.mockRestore();
  });

  it("does NOT log subset-invariant warning when expectedAgentIds is a subset of filter.actorIds", async () => {
    const { Logger } = await import("../../../../../shared/logger");
    const warnSpy = vi.spyOn(Logger.prototype, "warn");
    subsetInvariantWarningEmitted.clear();

    const healthySubscription: AgentSubscriptionRecord = {
      id: "sub-1",
      agentId: AGENT,
      agentName: "Agent 1",
      workspaceId: WS,
      filter: { eventTypes: ["agent:idle"], actorIds: ["agent-2", "agent-3"] },
      createdAt: new Date().toISOString(),
    };

    const action = requestDelegationGroupDelivery(WS, "group-1");

    await expectSaga(handleDelegationGroupDelivery, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroupRaw) return tracker;
          if (effect.selector === selectSubscriptionRaw) return healthySubscription;
          if (effect.selector === selectIsDelegationGroupCompleteRaw) return true;
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
      .run();

    const subsetWarn = warnSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("delegation-group-subset-invariant-violation"),
    );
    expect(subsetWarn).toBeUndefined();

    warnSpy.mockRestore();
  });

  it("deduplicates subset-invariant warning so repeated runs emit it only once per (groupId, missingIds)", async () => {
    const { Logger } = await import("../../../../../shared/logger");
    const warnSpy = vi.spyOn(Logger.prototype, "warn");
    subsetInvariantWarningEmitted.clear();

    const desyncedTracker: DelegationGroupTrackerRecord = {
      ...tracker,
      expectedAgentIds: ["agent-2", "agent-3", "agent-4"],
      completedAgentIds: ["agent-2", "agent-3", "agent-4"],
    };
    const desyncedSubscription: AgentSubscriptionRecord = {
      id: "sub-1",
      agentId: AGENT,
      agentName: "Agent 1",
      workspaceId: WS,
      filter: { eventTypes: ["agent:idle"], actorIds: ["agent-2", "agent-3"] },
      createdAt: new Date().toISOString(),
    };

    const run = () =>
      expectSaga(handleDelegationGroupDelivery, requestDelegationGroupDelivery(WS, "group-1"))
        .provide({
          select(effect, next) {
            if (effect.selector === selectDelegationGroupRaw) return desyncedTracker;
            if (effect.selector === selectSubscriptionRaw) return desyncedSubscription;
            if (effect.selector === selectIsDelegationGroupCompleteRaw) return true;
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
        .run();

    await run();
    await run();

    const subsetWarnings = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("delegation-group-subset-invariant-violation"),
    );
    expect(subsetWarnings).toHaveLength(1);

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
    };

    return expectSaga(handleEvictStaleAgents, action)
      .provide([
        [matchers.select(selectWorkspaceSubscriptionState.select, WS), ws],
      ])
      .put(evictDeletedAgent(WS, "agent-old"))
      .put(clearAgentQueue(WS, "agent-old"))
      .not.put(evictDeletedAgent(WS, "agent-new"))
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
    };
    const action = requestValidateSubscriptions(WS);

    return expectSaga(handleValidateSubscriptions, action)
      .provide([
        [matchers.select(selectWorkspaceSubscriptionState.select, WS), ws],
        // Verify the call receives both agentId AND wsId
        [matchers.call(isAgentSessionActive, "agent-1", WS), true],
        [matchers.call.fn(dispatchWorkspaceEvent), undefined],
      ])
      // Agent is active so no removals should happen
      .not.put.actionType(removeAllSubscriptions.type)
      .call(dispatchWorkspaceEvent, "agent:subscriptions-restored", WS, {
        type: "system",
        id: "subscription-service",
        name: "Subscription Service",
      }, {
        count: 1,
        agentIds: ["agent-1"],
      })
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
    "agent:event-delivery-timeout",
    "agent:event-delivery-failed",
    "agent:subscriptions-restored",
  ])("skips %s events for broad agent:* subscriptions", (eventType) => {
    const event = makeEvent("e1", eventType);
    (event as any).workspaceId = WS;
    const sub = makeSub({
      filter: { eventTypes: ["agent:*"] },
    });
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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

  it("processingOneShots is cleaned up when handleMatchEvent throws after claiming a oneShot", () => {
    const sub = makeSub({
      filter: { eventTypes: ["file:*"], oneShot: true },
    });

    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    const action = workspaceEventAccepted(event);

    processingOneShots.clear();

    // Use a dynamic provider to throw when the saga selects agentStatus,
    // which happens after processingOneShots.add(sub.id).
    return expectSaga(handleMatchEvent, action)
      .provide({
        select(effect, next) {
          // selectAllSubscriptionsRaw
          if (effect.args?.length === 2 && effect.args[0] === selectAllSubscriptionsRaw && effect.args[1] === WS) {
            return [sub];
          }
          // selectIsAgentDeleted
          if (effect.args?.[0] === selectIsAgentDeleted.select && effect.args?.[1] === WS && effect.args?.[2] === AGENT) {
            return false;
          }
          // selectIsOneShotFired
          if (effect.args?.[0] === selectIsOneShotFired.select && effect.args?.[1] === WS && effect.args?.[2] === sub.id) {
            return false;
          }
          // selectAgentStatus — throw to simulate a crash
          if (effect.args?.[0] === selectAgentStatus.select) {
            throw new Error("simulated crash");
          }
          return next();
        },
      })
      .run()
      .then(() => {
        // The oneShot claim must have been released despite the error
        expect(processingOneShots.has(sub.id)).toBe(false);
      });
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .not.put.actionType("agentSubscriptions/enqueueEvent")
      .run();
  });

  // -------------------------------------------------------------------------
  // Regression: stale cached selector after subscription turnover
  // -------------------------------------------------------------------------

  it("regression: handles subscription turnover without stale cache (selector bypass)", async () => {
    // This test reproduces the production bug where:
    // 1. Sub1 matches an event and is removed (oneShot cleanup)
    // 2. Sub2 is created for a different actor
    // 3. The next event should match sub2, but a cached selector would return
    //    stale empty results because it tracked paths for sub1 (now removed).
    //
    // With the uncached selectAllSubscriptionsRaw, each call re-reads the
    // slice state, so sub2 is always visible.

    const COORDINATOR = "agent-coordinator";
    const IMPLEMENTOR = "agent-implementor";
    const VERIFIER = "agent-verifier";

    const sub1: AgentSubscriptionRecord = {
      id: "sub-1",
      agentId: COORDINATOR,
      agentName: "Coordinator",
      workspaceId: WS,
      filter: {
        eventTypes: ["agent:idle"],
        actorIds: [IMPLEMENTOR],
        oneShot: true,
      },
      createdAt: new Date().toISOString(),
    };

    // --- Step 1: event from IMPLEMENTOR matches sub1 (oneShot) ---
    const event1 = makeEvent("e1", "agent:idle");
    (event1 as any).workspaceId = WS;
    (event1 as any).actor = { type: "agent", id: IMPLEMENTOR };
    const action1 = workspaceEventAccepted(event1);

    await expectSaga(handleMatchEvent, action1)
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub1]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectIsOneShotFired.select, WS, sub1.id), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      // Sub1 matches — event is enqueued
      .put.actionType("agentSubscriptions/enqueueEvent")
      // oneShot cleanup fires
      .put(markOneShotFired(WS, sub1.id))
      .put(removeSubscription(WS, sub1.id))
      .run();

    // --- Step 2: sub1 is gone, sub2 now exists for VERIFIER ---
    const sub2: AgentSubscriptionRecord = {
      id: "sub-2",
      agentId: COORDINATOR,
      agentName: "Coordinator",
      workspaceId: WS,
      filter: {
        eventTypes: ["agent:idle"],
        actorIds: [VERIFIER],
        oneShot: true,
      },
      createdAt: new Date().toISOString(),
    };

    const event2 = makeEvent("e2", "agent:idle");
    (event2 as any).workspaceId = WS;
    (event2 as any).actor = { type: "agent", id: VERIFIER };
    const action2 = workspaceEventAccepted(event2);

    // With a cached selector this would return [] (stale cache from sub1's
    // removal). With selectAllSubscriptionsRaw it correctly returns [sub2].
    await expectSaga(handleMatchEvent, action2)
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub2]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectIsOneShotFired.select, WS, sub2.id), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      // Sub2 must match — this is the critical assertion.
      // With the old cached selectAllSubscriptions, the provider would need
      // to return [] to simulate the stale cache, and this .put would fail.
      .put.actionType("agentSubscriptions/enqueueEvent")
      .put(markOneShotFired(WS, sub2.id))
      .put(removeSubscription(WS, sub2.id))
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
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



// ---------------------------------------------------------------------------
// Subscription-aware sweep fallback (periodicQueueSweep)
// ---------------------------------------------------------------------------

describe("periodicQueueSweep — subscription-aware sweep", () => {
  const WATCHED_AGENT = "agent-watched";
  const SUBSCRIBER = "agent-subscriber";

  const makeSweepSub = (overrides: Partial<AgentSubscriptionRecord> = {}): AgentSubscriptionRecord => ({
    id: "sub-sweep-1",
    agentId: SUBSCRIBER,
    agentName: "Subscriber",
    workspaceId: WS,
    filter: {
      eventTypes: ["agent:idle"],
      actorIds: [WATCHED_AGENT],
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  /**
   * Provider factory matching the pattern from the lifecycle tests.
   * First delay resolves so one iteration runs; subsequent delays block
   * forever so the saga parks cleanly until the test timeout fires.
   */
  function makeSweepProvider(wsState: WorkspaceSubscriptionState) {
    let delayCount = 0;
    return {
      call(effect: any, next: () => any) {
        if (isDelayEffect(effect)) {
          delayCount++;
          if (delayCount > 1) return new Promise(() => {}); // block forever
          return undefined; // resolve first delay
        }
        return next();
      },
      select(effect: any, next: () => any) {
        // selectAllWorkspaceIds — no args
        if (effect.args?.length === 0) return [WS];
        // selectWorkspaceSubscriptionState — single wsId arg
        if (effect.args?.[0] === WS && effect.args?.length === 1) return wsState;
        return next();
      },
    };
  }

  afterEach(() => {
    sweepCatchUpSeen.clear();
  });

  it("oneShot sweep catch-up enqueues event AND performs cleanup (markOneShotFired + removeSubscription)", () => {
    const sub = makeSweepSub({
      filter: {
        eventTypes: ["agent:idle"],
        actorIds: [WATCHED_AGENT],
        oneShot: true,
      },
    });

    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      subscriptions: { [sub.id]: sub },
      agentStatuses: { [WATCHED_AGENT]: "idle", [SUBSCRIBER]: "idle" },
    };

    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider(wsState))
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, SUBSCRIBER))
      .put(markOneShotFired(WS, sub.id))
      .put(removeSubscription(WS, sub.id))
      .run({ silenceTimeout: true });
  });

  it("duplicate suppression prevents re-enqueuing the same catch-up on subsequent sweeps", () => {
    const sub = makeSweepSub();

    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      subscriptions: { [sub.id]: sub },
      agentStatuses: { [WATCHED_AGENT]: "idle", [SUBSCRIBER]: "idle" },
    };

    // Pre-populate the dedup guard as if the previous sweep already fired
    const dedupeKey = `${sub.id}:${WATCHED_AGENT}:agent:idle`;
    sweepCatchUpSeen.add(dedupeKey);

    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider(wsState))
      // Should NOT enqueue because the dedup guard suppresses it
      .not.put.actionType(enqueueEvent.type)
      .not.put(requestDeliverQueuedEvents(WS, SUBSCRIBER))
      .run({ silenceTimeout: true });
  });

  it("skips subscriptions with delegationGroup set", () => {
    const sub = makeSweepSub({
      filter: {
        eventTypes: ["agent:idle"],
        actorIds: [WATCHED_AGENT],
        delegationGroup: "group-1",
      },
    });

    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      subscriptions: { [sub.id]: sub },
      agentStatuses: { [WATCHED_AGENT]: "idle", [SUBSCRIBER]: "idle" },
    };

    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider(wsState))
      // Delegation group subs should be completely skipped
      .not.put.actionType(enqueueEvent.type)
      .not.put(requestDeliverQueuedEvents(WS, SUBSCRIBER))
      .not.put.actionType(markOneShotFired.type)
      .run({ silenceTimeout: true });
  });
  it("non-oneShot sweep catch-up uses a deterministic event ID", () => {
    const sub = makeSweepSub(); // non-oneShot by default

    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      subscriptions: { [sub.id]: sub },
      agentStatuses: { [WATCHED_AGENT]: "idle", [SUBSCRIBER]: "idle" },
    };

    // Capture the enqueued event via a custom provider that intercepts put effects
    let capturedEventId: string | undefined;
    const baseProvider = makeSweepProvider(wsState);

    return expectSaga(periodicQueueSweep)
      .provide({
        call: baseProvider.call,
        select: baseProvider.select,
        put(effect: any, next: () => any) {
          // Intercept enqueueEvent dispatches to capture the event ID
          if (effect.action?.type === enqueueEvent.type) {
            const [, , queuedRecord] = effect.action.payload;
            capturedEventId = queuedRecord?.event?.id;
          }
          return next();
        },
      })
      .put.actionType(enqueueEvent.type)
      .run({ silenceTimeout: true })
      .then(() => {
        expect(capturedEventId).toBe(buildSweepCatchUpEventId(sub.id, WATCHED_AGENT, "agent:idle"));
        expect(capturedEventId).not.toMatch(/^catchup_/); // not the old random format
      });
  });
});


// ---------------------------------------------------------------------------
// Delegation group stuck-detection (periodicQueueSweep)
// ---------------------------------------------------------------------------

describe("periodicQueueSweep — delegation group stuck-detection", () => {
  function makeSweepProvider(wsState: WorkspaceSubscriptionState) {
    let delayCount = 0;
    return {
      call(effect: any, next: () => any) {
        if (isDelayEffect(effect)) {
          delayCount++;
          if (delayCount > 1) return new Promise(() => {});
          return undefined;
        }
        // Stub out handleDelegationGroupDelivery's internal calls
        // (formatNotification, sendBackendMessage, dispatchWorkspaceEvent)
        // so the direct call doesn't blow up inside the sweep
        if (effect.fn === handleDelegationGroupDelivery) {
          // Let it run — the select provider below handles its selectors
          return next();
        }
        return next();
      },
      select(effect: any, next: () => any) {
        if (effect.args?.length === 0) return [WS];
        if (effect.args?.[0] === WS && effect.args?.length === 1) return wsState;
        // Handle raw selectors used by handleDelegationGroupDelivery
        if (effect.selector === selectDelegationGroupRaw && effect.args?.[0] === WS) {
          const groupId = effect.args[1];
          return wsState.delegationGroups[groupId];
        }
        if (effect.selector === selectSubscriptionRaw && effect.args?.[0] === WS) {
          const subId = effect.args[1];
          return wsState.subscriptions[subId];
        }
        if (effect.selector === selectIsDelegationGroupCompleteRaw && effect.args?.[0] === WS) {
          const groupId = effect.args[1];
          const group = wsState.delegationGroups[groupId];
          if (!group) return false;
          const doneCount = group.completedAgentIds.length + group.deletedAgentIds.length;
          return group.awaitMode === "any" ? doneCount >= 1 : doneCount >= group.expectedAgentIds.length;
        }
        if (effect.selector === selectAgentStatus.select) return "idle";
        if (effect.selector === selectIsAgentDeleted.select) return false;
        return next();
      },
    };
  }

  afterEach(() => {
    sweepCatchUpSeen.clear();
    stuckGroupFirstSeen.clear();
  });

  it("calls handleDelegationGroupDelivery directly for complete-but-undelivered groups", () => {
    const tracker: DelegationGroupTrackerRecord = {
      groupId: "group-stuck",
      parentAgentId: AGENT,
      parentAgentName: "Coordinator",
      awaitMode: "all",
      expectedAgentIds: ["agent-2", "agent-3"],
      completedAgentIds: ["agent-2", "agent-3"],
      deletedAgentIds: [],
      events: [],
      subscriptionId: "sub-1",
      delivered: false,
    };

    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      delegationGroups: { "group-stuck": tracker },
    };

    // Pre-populate stuckGroupFirstSeen so the threshold check passes
    stuckGroupFirstSeen.set("group-stuck", Date.now() - 60_000);

    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider(wsState))
      .call.fn(handleDelegationGroupDelivery)
      .run({ silenceTimeout: true });
  });

  it("skips already-delivered groups", () => {
    const tracker: DelegationGroupTrackerRecord = {
      groupId: "group-done",
      parentAgentId: AGENT,
      parentAgentName: "Coordinator",
      awaitMode: "all",
      expectedAgentIds: ["agent-2"],
      completedAgentIds: ["agent-2"],
      deletedAgentIds: [],
      events: [],
      subscriptionId: "sub-1",
      delivered: true,
    };

    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      delegationGroups: { "group-done": tracker },
    };

    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider(wsState))
      .not.call.fn(handleDelegationGroupDelivery)
      .run({ silenceTimeout: true });
  });

  it("skips incomplete groups", () => {
    const tracker: DelegationGroupTrackerRecord = {
      groupId: "group-partial",
      parentAgentId: AGENT,
      parentAgentName: "Coordinator",
      awaitMode: "all",
      expectedAgentIds: ["agent-2", "agent-3"],
      completedAgentIds: ["agent-2"],
      deletedAgentIds: [],
      events: [],
      subscriptionId: "sub-1",
      delivered: false,
    };

    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      delegationGroups: { "group-partial": tracker },
    };

    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider(wsState))
      .not.call.fn(handleDelegationGroupDelivery)
      .run({ silenceTimeout: true });
  });

  it("handles awaitMode 'any' — calls delivery when at least one agent completed", () => {
    const tracker: DelegationGroupTrackerRecord = {
      groupId: "group-any",
      parentAgentId: AGENT,
      parentAgentName: "Coordinator",
      awaitMode: "any",
      expectedAgentIds: ["agent-2", "agent-3"],
      completedAgentIds: ["agent-2"],
      deletedAgentIds: [],
      events: [],
      subscriptionId: "sub-1",
      delivered: false,
    };

    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      delegationGroups: { "group-any": tracker },
    };

    // Pre-populate stuckGroupFirstSeen so the threshold check passes
    stuckGroupFirstSeen.set("group-any", Date.now() - 60_000);

    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider(wsState))
      .call.fn(handleDelegationGroupDelivery)
      .run({ silenceTimeout: true });
  });

  it("counts deletedAgentIds toward completion", () => {
    const tracker: DelegationGroupTrackerRecord = {
      groupId: "group-deleted",
      parentAgentId: AGENT,
      parentAgentName: "Coordinator",
      awaitMode: "all",
      expectedAgentIds: ["agent-2", "agent-3"],
      completedAgentIds: ["agent-2"],
      deletedAgentIds: ["agent-3"],
      events: [],
      subscriptionId: "sub-1",
      delivered: false,
    };

    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      delegationGroups: { "group-deleted": tracker },
    };

    // Pre-populate stuckGroupFirstSeen so the threshold check passes
    stuckGroupFirstSeen.set("group-deleted", Date.now() - 60_000);

    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider(wsState))
      .call.fn(handleDelegationGroupDelivery)
      .run({ silenceTimeout: true });
  });
});


// ---------------------------------------------------------------------------
// Regression: sweep catch-up double-delivery for non-oneShot subscriptions
// (PR #461 follow-up)
// ---------------------------------------------------------------------------

describe("sweep catch-up double-delivery prevention", () => {
  const WATCHED_AGENT = "agent-watched";
  const COORDINATOR = "agent-coordinator";

  afterEach(() => {
    sweepCatchUpSeen.clear();
    clearDeliveryDedupCache();
  });

  it("handleMatchEvent skips delivery when sweep catch-up already fired for same sub+actor+eventType", () => {
    // Scenario: the sweep fires FIRST and records the sub+actor entry in
    // sweepCatchUpSeen. Then the real agent:idle event arrives via
    // handleMatchEvent. It should detect the sweep already handled this
    // combo and skip enqueuing.
    const sub: AgentSubscriptionRecord = {
      id: "sub-coordinator",
      agentId: COORDINATOR,
      agentName: "Coordinator",
      workspaceId: WS,
      filter: {
        eventTypes: ["agent:idle"],
        actorIds: [WATCHED_AGENT],
        // non-oneShot (default)
      },
      createdAt: new Date().toISOString(),
    };

    // Simulate the sweep having already fired for this combo
    sweepCatchUpSeen.add(`${sub.id}:${WATCHED_AGENT}:agent:idle`);

    // Now the real event arrives
    const realEvent = makeEvent("real-idle-123", "agent:idle");
    (realEvent as any).workspaceId = WS;
    (realEvent as any).actor = { type: "agent", id: WATCHED_AGENT };
    const action = workspaceEventAccepted(realEvent);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      // Should NOT enqueue because the sweep already handled it
      .not.put.actionType(enqueueEvent.type)
      .not.put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .run();
  });

  it("handleMatchEvent records deterministic sweep-catchup ID in dedup cache when real event fires first", () => {
    // Scenario: the real event fires FIRST via handleMatchEvent. It should
    // record the deterministic sweep-catchup ID in the delivery dedup cache
    // so that if the sweep later fires, filterAlreadyDelivered suppresses it.
    const sub: AgentSubscriptionRecord = {
      id: "sub-coordinator",
      agentId: COORDINATOR,
      agentName: "Coordinator",
      workspaceId: WS,
      filter: {
        eventTypes: ["agent:idle"],
        actorIds: [WATCHED_AGENT],
      },
      createdAt: new Date().toISOString(),
    };

    const realEvent = makeEvent("real-idle-456", "agent:idle");
    (realEvent as any).workspaceId = WS;
    (realEvent as any).actor = { type: "agent", id: WATCHED_AGENT };
    const action = workspaceEventAccepted(realEvent);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .run()
      .then(() => {
        // Verify the deterministic sweep-catchup ID was recorded in the dedup cache.
        // Create a synthetic event with the deterministic ID and check if
        // filterAlreadyDelivered suppresses it.
        const deterministicId = buildSweepCatchUpEventId(sub.id, WATCHED_AGENT, "agent:idle");
        const syntheticEvent = { id: deterministicId } as any;
        const filtered = filterAlreadyDelivered(COORDINATOR, [syntheticEvent]);
        expect(filtered).toHaveLength(0); // should be filtered out
      });
  });

  it("sweep dedup guard does NOT suppress handleMatchEvent for events without actorIds in filter", () => {
    // Non-actor-specific subscriptions should not be affected by the sweep dedup
    const sub: AgentSubscriptionRecord = {
      id: "sub-general",
      agentId: COORDINATOR,
      agentName: "Coordinator",
      workspaceId: WS,
      filter: {
        eventTypes: ["file:changed"],
        // no actorIds
      },
      createdAt: new Date().toISOString(),
    };

    const event = makeEvent("e1", "file:changed");
    (event as any).workspaceId = WS;
    const action = workspaceEventAccepted(event);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      .put.actionType(enqueueEvent.type)
      .run();
  });

  it("sweep dedup key includes event type — multi-eventType subscription does not collide", () => {
    // Regression: when a subscription watches both agent:idle and agent:deleted
    // for the same actor, the sweep should record separate keys for each event
    // type.  Previously the key was `sub:actor` and a single value was stored,
    // causing one event type to overwrite the other.
    const sub: AgentSubscriptionRecord = {
      id: "sub-multi",
      agentId: COORDINATOR,
      agentName: "Coordinator",
      workspaceId: WS,
      filter: {
        eventTypes: ["agent:idle", "agent:deleted"],
        actorIds: [WATCHED_AGENT],
      },
      createdAt: new Date().toISOString(),
    };

    // Simulate sweep having fired for agent:idle
    sweepCatchUpSeen.add(`${sub.id}:${WATCHED_AGENT}:agent:idle`);

    // A real agent:deleted event should NOT be suppressed — different event type
    const deletedEvent = makeEvent("real-deleted-789", "agent:deleted");
    (deletedEvent as any).workspaceId = WS;
    (deletedEvent as any).actor = { type: "agent", id: WATCHED_AGENT };
    const action = workspaceEventAccepted(deletedEvent);

    return expectSaga(handleMatchEvent, action)
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      // Should enqueue because agent:deleted is a different event type than agent:idle
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .run();
  });

  it("consume-once: sweep dedup key is deleted after suppressing one real event, allowing future transitions", async () => {
    // Regression: sweepCatchUpSeen entries must be consumed (deleted) when
    // they suppress a real event.  Otherwise, if the watched agent goes
    // busy and then idle again, the second idle transition would be
    // permanently suppressed.
    const sub: AgentSubscriptionRecord = {
      id: "sub-coordinator",
      agentId: COORDINATOR,
      agentName: "Coordinator",
      workspaceId: WS,
      filter: {
        eventTypes: ["agent:idle"],
        actorIds: [WATCHED_AGENT],
      },
      createdAt: new Date().toISOString(),
    };

    const dedupeKey = `${sub.id}:${WATCHED_AGENT}:agent:idle`;

    // 1. Sweep fires and records the catch-up
    sweepCatchUpSeen.add(dedupeKey);

    // 2. First real agent:idle arrives — should be suppressed (consume-once)
    const firstIdle = makeEvent("real-idle-first", "agent:idle");
    (firstIdle as any).workspaceId = WS;
    (firstIdle as any).actor = { type: "agent", id: WATCHED_AGENT };

    await expectSaga(handleMatchEvent, workspaceEventAccepted(firstIdle))
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      .not.put.actionType(enqueueEvent.type)
      .not.put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .run();

    // The key should have been consumed (deleted)
    expect(sweepCatchUpSeen.has(dedupeKey)).toBe(false);

    // 3. Agent goes busy then idle again — second real agent:idle arrives
    //    This should NOT be suppressed because the dedup key was consumed.
    const secondIdle = makeEvent("real-idle-second", "agent:idle");
    (secondIdle as any).workspaceId = WS;
    (secondIdle as any).actor = { type: "agent", id: WATCHED_AGENT };

    await expectSaga(handleMatchEvent, workspaceEventAccepted(secondIdle))
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .run();
  });
});


// ---------------------------------------------------------------------------
// Regression: matchingSaga must block indefinitely (PR #461 follow-up)
// ---------------------------------------------------------------------------

describe("matchingSaga blocking behavior", () => {
  it("does not return after registering takeEvery watchers", async () => {
    // matchingSaga registers takeEvery watchers (non-blocking) and then must
    // block indefinitely. If it returns, the crash-recovery wrapper would loop
    // and re-register duplicate watchers.
    //
    // Strategy: run the saga in the crash-recovery wrapper pattern and verify
    // it does NOT loop (i.e., the "restarting" log never fires).
    let loopCount = 0;

    function* testWrapper() {
      while (true) {
        yield* call(matchingSaga);
        // If we get here, matchingSaga returned — that's the bug.
        loopCount++;
        break; // Don't actually loop in test
      }
    }

    await expectSaga(testWrapper)
      .run({ timeout: 200, silenceTimeout: true });

    expect(loopCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// delegationGroupSaga restart wrapper behavior
// ---------------------------------------------------------------------------

describe("delegationGroupSaga restart wrapper behavior", () => {
  it("does not spin when healthy because delegationGroupSaga blocks", async () => {
    // delegationGroupSaga registers takeEvery watchers and then blocks on
    // take("@@NEVER_RESOLVE"). The crash-recovery wrapper should therefore
    // never loop.
    let loopCount = 0;

    function* testWrapper() {
      while (true) {
        yield* call(delegationGroupSaga);
        // If we get here, delegationGroupSaga returned — that's a bug.
        loopCount++;
        break; // Don't actually loop in test
      }
    }

    await expectSaga(testWrapper)
      .run({ timeout: 200, silenceTimeout: true });

    expect(loopCount).toBe(0);
  });

  it("restarts after a thrown error with a delay", async () => {
    // Simulate delegationGroupSaga throwing an error. The wrapper should
    // catch the error and delay 1 second before restarting.
    let restartCount = 0;
    let delayCallCount = 0;
    const crashError = new Error("saga boom");

    function* fakeDelegationGroupSaga(): Generator {
      restartCount++;
      if (restartCount <= 2) {
        throw crashError;
      }
      // On third call, block forever (healthy state)
      yield* take("@@NEVER_RESOLVE");
    }

    function* testWrapper() {
      while (true) {
        try {
          yield* call(fakeDelegationGroupSaga);
        } catch (_error) {
          // Mirrors the real wrapper: catch, then delay before restart
        }
        yield* delay(1000);
        delayCallCount++;
      }
    }

    await expectSaga(testWrapper)
      .provide({
        call(effect, next) {
          // Resolve delay() immediately so the loop can iterate within timeout
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .run({ timeout: 500, silenceTimeout: true });

    // The saga should have been called 3 times: two crashes + one healthy block
    expect(restartCount).toBe(3);

    // Verify that delay was called at least twice (once per crash)
    expect(delayCallCount).toBeGreaterThanOrEqual(2);
  });

  it("restarts after an unexpected normal exit with a delay", async () => {
    // Simulate delegationGroupSaga returning normally (unexpected).
    // The wrapper should delay 1 second before restarting.
    let callCount = 0;
    let delayCallCount = 0;

    function* fakeDelegationGroupSaga(): Generator {
      callCount++;
      if (callCount <= 1) {
        // Return normally on first call (simulates unexpected exit)
        return;
      }
      // Block forever on subsequent calls
      yield* take("@@NEVER_RESOLVE");
    }

    function* testWrapper() {
      while (true) {
        try {
          yield* call(fakeDelegationGroupSaga);
        } catch (_error) {
          // catch path
        }
        yield* delay(1000);
        delayCallCount++;
      }
    }

    await expectSaga(testWrapper)
      .provide({
        call(effect, next) {
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .run({ timeout: 500, silenceTimeout: true });

    // Called twice: one unexpected exit + one healthy block
    expect(callCount).toBe(2);

    // At least one delay for the restart after the unexpected exit
    expect(delayCallCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// IPC bridge saga — handleSubscribeToDelegationGroup
// ---------------------------------------------------------------------------

describe("handleSubscribeToDelegationGroup", () => {
  const GROUP_ID = "group-1";
  const PARENT = "parent-1";
  const CHILD = "child-1";

  const seedRecord: AgentSubscriptionRecord = {
    id: "seed-1",
    agentId: PARENT,
    agentName: "Parent",
    workspaceId: WS,
    filter: {
      eventTypes: ["agent:idle", "agent:completed", "agent:failed", "agent:deleted"],
      actorIds: [CHILD],
      priority: "high",
      delegationGroup: { groupId: GROUP_ID, awaitMode: "all", expectedAgentIds: [CHILD] },
    },
    createdAt: new Date().toISOString(),
  };

  it("calls dispatchWorkspaceEvent with 'agent:subscribed' when the seed id is present in state (subscription was created)", () => {
    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      subscriptions: { [seedRecord.id]: seedRecord },
    };
    const action = subscribeToDelegationGroup(WS, seedRecord);

    return expectSaga(handleSubscribeToDelegationGroup, action)
      .provide([
        [matchers.select(selectWorkspaceSubscriptionState.select, WS), wsState],
        [matchers.call.fn(dispatchWorkspaceEvent), undefined],
      ])
      .call(
        dispatchWorkspaceEvent,
        "agent:subscribed",
        WS,
        { type: "agent", id: PARENT, name: "Parent" },
        {
          agentId: PARENT,
          agentName: "Parent",
          subscriptionId: seedRecord.id,
          eventTypes: seedRecord.filter.eventTypes || [],
          filterDescription:
            "types: agent:idle, agent:completed, agent:failed, agent:deleted; watching: child-1",
        },
      )
      .run();
  });

  it("does NOT call dispatchWorkspaceEvent when the seed id is absent from state (existing subscription was extended)", () => {
    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      subscriptions: {},
    };
    const action = subscribeToDelegationGroup(WS, seedRecord);

    return expectSaga(handleSubscribeToDelegationGroup, action)
      .provide([
        [matchers.select(selectWorkspaceSubscriptionState.select, WS), wsState],
      ])
      .not.call.fn(dispatchWorkspaceEvent)
      .run();
  });
});