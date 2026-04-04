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
  selectIsAgentDeleted,
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
  formatNotification,
  sendBackendMessage,
} from "./delivery-saga";
import { dispatchWorkspaceEvent } from "./ipc-bridge-saga";
import { handleDelegationGroupDelivery } from "./delegation-group-saga";
import { handleEvictStaleAgents, handleValidateSubscriptions, isAgentSessionActive } from "./cleanup-saga";
import { handlePersist, handleRestore, getSubscriptionsFilePath, writeSubscriptions, readSubscriptions } from "./persistence-saga";
import { handleMatchEvent, handleNewSubscriptionCatchUp, activeBatchTimers, batchFlushWorker } from "./matching-saga";
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

  it("records timeout when sendBackendMessage hangs past DELIVERY_TIMEOUT_MS", () => {
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
      .put.actionType(recordDeliveryTimeout.type)
      .put(bumpVersion(WS))
      .not.put.actionType(recordDeliveryFailure.type)
      .not.put.actionType(recordDeliverySuccess.type)
      .run({ timeout: 5000 });
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
      .provide([
        [matchers.select(selectDelegationGroup.select, WS, "group-1"), tracker],
        [matchers.select(selectIsDelegationGroupComplete.select, WS, "group-1"), true],
        [matchers.select(selectAgentStatus.select, WS, AGENT), "idle"],
      ])
      .put(markDelegationDelivered(WS, "group-1"))
      .put.actionType(requestDeliverEvents.type)
      .put(removeDelegationGroup(WS, "group-1"))
      .put(removeSubscription(WS, "sub-1"))
      .run();
  });

  it("skips already-delivered groups", () => {
    const action = requestDelegationGroupDelivery(WS, "group-1");
    const deliveredTracker = { ...tracker, delivered: true };

    return expectSaga(handleDelegationGroupDelivery, action)
      .provide([
        [matchers.select(selectDelegationGroup.select, WS, "group-1"), deliveredTracker],
      ])
      .not.put.actionType(requestDeliverEvents.type)
      .run();
  });

  it("skips incomplete groups", () => {
    const action = requestDelegationGroupDelivery(WS, "group-1");

    return expectSaga(handleDelegationGroupDelivery, action)
      .provide([
        [matchers.select(selectDelegationGroup.select, WS, "group-1"), tracker],
        [matchers.select(selectIsDelegationGroupComplete.select, WS, "group-1"), false],
      ])
      .not.put.actionType(requestDeliverEvents.type)
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
      .not.put.actionType(requestDeliverEvents.type)
      .run({ timeout: 10000 });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Delegation group polling timed out"),
      expect.objectContaining({
        groupId: "group-1",
        parentAgentId: AGENT,
        eventCount: 1,
      }),
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

// ---------------------------------------------------------------------------
// Persistence saga
// ---------------------------------------------------------------------------

describe("handlePersist", () => {
  it("serializes and writes state to disk", () => {
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
      deletedAgents: {},
      version: 0,
    };
    const action = requestPersist(WS);

    return expectSaga(handlePersist, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectWorkspaceSubscriptionState.select) return ws;
          return next();
        },
        call(effect, next) {
          if (effect.fn === getSubscriptionsFilePath) return "/tmp/agent-subscriptions.json";
          if (effect.fn === writeSubscriptions) return undefined;
          // Resolve delay() immediately to avoid test timeout
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .call.fn(writeSubscriptions)
      .run({ timeout: 5000 });
  });
});


// ---------------------------------------------------------------------------
// Restore saga
// ---------------------------------------------------------------------------

describe("handleRestore", () => {
  const filePath = "/tmp/agent-subscriptions.json";

  it("restores subscriptions, delegationGroups, firedOneShotSubscriptions, and deletedAgents from disk", () => {
    const diskData = {
      subscriptions: [
        {
          id: "sub-1",
          agentId: AGENT,
          agentName: "Agent 1",
          workspaceId: WS,
          filter: { eventTypes: ["file:changed"] },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      delegationGroups: [
        {
          groupId: "group-1",
          parentAgentId: AGENT,
          parentAgentName: "Agent 1",
          awaitMode: "all",
          expectedAgentIds: ["agent-2"],
          completedAgentIds: ["agent-2"],
          deletedAgentIds: [],
          events: [],
          subscriptionId: "sub-1",
          delivered: false,
        },
      ],
      firedOneShotSubscriptions: ["sub-old"],
      deletedAgents: [{ id: "agent-dead", deletedAt: 1000 }],
    };

    const action = requestRestore(WS);

    return expectSaga(handleRestore, action)
      .provide([
        [matchers.call.fn(getSubscriptionsFilePath), filePath],
        [matchers.call.fn(readSubscriptions), diskData],
      ])
      .put(
        setSubscriptionsSnapshot(WS, {
          subscriptions: {
            "sub-1": diskData.subscriptions[0],
          },
          agentQueues: {},
          agentStatuses: {},
          delegationGroups: {
            "group-1": {
              ...diskData.delegationGroups[0],
            },
          },
          firedOneShotSubscriptions: ["sub-old"],
          deliveryStats: {
            totalDeliveries: 0,
            successfulDeliveries: 0,
            failedDeliveries: 0,
            timeoutDeliveries: 0,
            droppedEvents: 0,
            lastDeliveryTime: null,
            lastFailureTime: null,
          },
          deletedAgents: { "agent-dead": 1000 },
          version: 0,
        } as any)
      )
      .put(bumpVersion(WS))
      .run();
  });

  it("handles missing fields gracefully (defaults to empty collections)", () => {
    const diskData = {
      subscriptions: [
        {
          id: "sub-1",
          agentId: AGENT,
          agentName: "Agent 1",
          workspaceId: WS,
          filter: {},
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    const action = requestRestore(WS);

    return expectSaga(handleRestore, action)
      .provide([
        [matchers.call.fn(getSubscriptionsFilePath), filePath],
        [matchers.call.fn(readSubscriptions), diskData],
      ])
      .put(
        setSubscriptionsSnapshot(WS, {
          subscriptions: {
            "sub-1": diskData.subscriptions[0],
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
        } as any)
      )
      .put(bumpVersion(WS))
      .run();
  });

  it("handles malformed data (non-object) by returning early without dispatching", () => {
    const action = requestRestore(WS);

    return expectSaga(handleRestore, action)
      .provide([
        [matchers.call.fn(getSubscriptionsFilePath), filePath],
        [matchers.call.fn(readSubscriptions), "not an object"],
      ])
      .not.put.actionType(setSubscriptionsSnapshot.type)
      .not.put.actionType(bumpVersion.type)
      .run();
  });

  it("handles empty file (null from readSubscriptions) by returning early", () => {
    const action = requestRestore(WS);

    return expectSaga(handleRestore, action)
      .provide([
        [matchers.call.fn(getSubscriptionsFilePath), filePath],
        [matchers.call.fn(readSubscriptions), null],
      ])
      .not.put.actionType(setSubscriptionsSnapshot.type)
      .not.put.actionType(bumpVersion.type)
      .run();
  });

  it("skips subscriptions without an id field", async () => {
    const diskData = {
      subscriptions: [
        { agentId: AGENT, agentName: "No ID sub" },
        { id: "sub-valid", agentId: AGENT, agentName: "Valid", workspaceId: WS, filter: {}, createdAt: "2026-01-01T00:00:00.000Z" },
      ],
    };

    const action = requestRestore(WS);

    const { effects } = await expectSaga(handleRestore, action)
      .provide([
        [matchers.call.fn(getSubscriptionsFilePath), filePath],
        [matchers.call.fn(readSubscriptions), diskData],
      ])
      .run();

    const putEffects = effects.put ?? [];
    const snapshotPut = putEffects.find(
      (p: any) => p.payload.action.type === setSubscriptionsSnapshot.type,
    );
    expect(snapshotPut).toBeDefined();
    const snapshot = snapshotPut!.payload.action.payload[1];
    expect(snapshot.subscriptions).toEqual({
      "sub-valid": diskData.subscriptions[1],
    });
  });

  it("skips delegationGroups without a groupId and defaults missing arrays", async () => {
    const diskData = {
      subscriptions: [],
      delegationGroups: [
        { parentAgentId: AGENT },
        {
          groupId: "g1",
          parentAgentId: AGENT,
          parentAgentName: "Agent 1",
          awaitMode: "any",
          subscriptionId: "sub-1",
        },
      ],
    };

    const action = requestRestore(WS);

    const { effects } = await expectSaga(handleRestore, action)
      .provide([
        [matchers.call.fn(getSubscriptionsFilePath), filePath],
        [matchers.call.fn(readSubscriptions), diskData],
      ])
      .run();

    const putEffects = effects.put ?? [];
    const snapshotPut = putEffects.find(
      (p: any) => p.payload.action.type === setSubscriptionsSnapshot.type,
    );
    expect(snapshotPut).toBeDefined();
    const snapshot = snapshotPut!.payload.action.payload[1];
    const g1 = snapshot.delegationGroups["g1"];
    expect(g1).toBeDefined();
    expect(g1.groupId).toBe("g1");
    expect(g1.expectedAgentIds).toEqual([]);
    expect(g1.completedAgentIds).toEqual([]);
    expect(g1.deletedAgentIds).toEqual([]);
    expect(g1.events).toEqual([]);
    expect(g1.delivered).toBe(false);
    expect(Object.keys(snapshot.delegationGroups)).toEqual(["g1"]);
  });
});

// ---------------------------------------------------------------------------
// Subscription catch-up — agents that already match at subscribe time
// ---------------------------------------------------------------------------

describe("handleNewSubscriptionCatchUp", () => {
  const SUB_AGENT = "agent-sub-1";

  const makeSub = (overrides: Partial<AgentSubscriptionRecord> = {}): AgentSubscriptionRecord => ({
    id: "sub-catchup-1",
    agentId: AGENT,
    agentName: "Coordinator",
    workspaceId: WS,
    filter: {
      eventTypes: ["agent:idle"],
      actorIds: [SUB_AGENT],
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  /** Build a WorkspaceSubscriptionState with the given agentStatuses map */
  const makeWsState = (agentStatuses: Record<string, string>) => ({
    ...emptyWorkspaceSubscriptionState,
    agentStatuses,
  });

  it("skips catch-up when agent has no status entry (newly created agent)", () => {
    const sub = makeSub();
    const action = addSubscription(WS, sub);

    // Agent not in agentStatuses map at all — should skip catch-up
    return expectSaga(handleNewSubscriptionCatchUp, action)
      .provide([
        [matchers.select(selectWorkspaceSubscriptionState.select, WS), makeWsState({})],
      ])
      .not.put.actionType(enqueueEvent.type)
      .not.put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  it("enqueues catch-up event and triggers delivery when watched agent is already idle", () => {
    const sub = makeSub();
    const action = addSubscription(WS, sub);

    return expectSaga(handleNewSubscriptionCatchUp, action)
      .provide({
        select({ selector, args }, next) {
          if (selector === selectWorkspaceSubscriptionState.select && args[0] === WS) return makeWsState({ [SUB_AGENT]: "idle" });
          return next();
        },
        call(effect, next) {
          // Resolve delay() immediately to avoid test timeout
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  it("does NOT synthesize catch-up when watched agent is still responding", () => {
    const sub = makeSub();
    const action = addSubscription(WS, sub);

    return expectSaga(handleNewSubscriptionCatchUp, action)
      .provide([
        [matchers.select(selectWorkspaceSubscriptionState.select, WS), makeWsState({ [SUB_AGENT]: "responding" })],
      ])
      .not.put.actionType(enqueueEvent.type)
      .not.put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  it("synthesizes catch-up for agent:failed when watched agent has failed status", () => {
    const sub = makeSub({
      filter: {
        eventTypes: ["agent:failed"],
        actorIds: [SUB_AGENT],
      },
    });
    const action = addSubscription(WS, sub);

    return expectSaga(handleNewSubscriptionCatchUp, action)
      .provide({
        select({ selector, args }, next) {
          if (selector === selectWorkspaceSubscriptionState.select && args[0] === WS) return makeWsState({ [SUB_AGENT]: "failed" });
          return next();
        },
        call(effect, next) {
          // Resolve delay() immediately to avoid test timeout
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  it("matches wildcard event types like agent:*", () => {
    const sub = makeSub({
      filter: {
        eventTypes: ["agent:*"],
        actorIds: [SUB_AGENT],
      },
    });
    const action = addSubscription(WS, sub);

    return expectSaga(handleNewSubscriptionCatchUp, action)
      .provide({
        select({ selector, args }, next) {
          if (selector === selectWorkspaceSubscriptionState.select && args[0] === WS) return makeWsState({ [SUB_AGENT]: "idle" });
          return next();
        },
        call(effect, next) {
          // Resolve delay() immediately to avoid test timeout
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .run();
  });

  it("skips catch-up when no actorIds are specified", () => {
    const sub = makeSub({
      filter: {
        eventTypes: ["agent:idle"],
        // no actorIds
      },
    });
    // Remove actorIds from the filter
    delete sub.filter.actorIds;
    const action = addSubscription(WS, sub);

    return expectSaga(handleNewSubscriptionCatchUp, action)
      .not.put.actionType(enqueueEvent.type)
      .run();
  });

  it("skips catch-up when no eventTypes are specified", () => {
    const sub = makeSub({
      filter: {
        actorIds: [SUB_AGENT],
        // no eventTypes
      },
    });
    delete sub.filter.eventTypes;
    const action = addSubscription(WS, sub);

    return expectSaga(handleNewSubscriptionCatchUp, action)
      .not.put.actionType(enqueueEvent.type)
      .run();
  });

  it("handles oneShot: marks fired and removes subscription on catch-up", () => {
    const sub = makeSub({
      filter: {
        eventTypes: ["agent:idle"],
        actorIds: [SUB_AGENT],
        oneShot: true,
      },
    });
    const action = addSubscription(WS, sub);

    return expectSaga(handleNewSubscriptionCatchUp, action)
      .provide({
        select({ selector, args }, next) {
          if (selector === selectWorkspaceSubscriptionState.select && args[0] === WS) return makeWsState({ [SUB_AGENT]: "idle" });
          return next();
        },
        call(effect, next) {
          // Resolve delay() immediately to avoid test timeout
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .put(markOneShotFired(WS, sub.id))
      .put(removeSubscription(WS, sub.id))
      .put(bumpVersion(WS))
      .run();
  });

  // --- Delegation group catch-up ---

  it("marks agent completed in delegation group when agent is already idle", () => {
    const groupId = "deleg-group-1";
    const sub = makeSub({
      filter: {
        eventTypes: ["agent:idle", "agent:completed", "agent:failed"],
        actorIds: [SUB_AGENT],
        delegationGroup: {
          groupId,
          awaitMode: "all",
          expectedAgentIds: [SUB_AGENT],
        },
      },
    });
    const action = addSubscription(WS, sub);

    const tracker: DelegationGroupTrackerRecord = {
      groupId,
      parentAgentId: AGENT,
      parentAgentName: "Coordinator",
      awaitMode: "all",
      expectedAgentIds: [SUB_AGENT],
      completedAgentIds: [],
      deletedAgentIds: [],
      events: [],
      subscriptionId: sub.id,
      delivered: false,
    };

    return expectSaga(handleNewSubscriptionCatchUp, action)
      .provide({
        select({ selector, args }, next) {
          if (selector === selectWorkspaceSubscriptionState.select && args[0] === WS) return makeWsState({ [SUB_AGENT]: "idle" });
          if (selector === selectDelegationGroup.select && args[0] === WS && args[1] === groupId) return tracker;
          return next();
        },
        call(effect, next) {
          // Resolve delay() immediately to avoid test timeout
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .put.actionType(appendDelegationGroupEvent.type)
      .put(markDelegationAgentCompleted(WS, groupId, SUB_AGENT))
      .not.put.actionType(enqueueEvent.type) // should NOT use direct queue
      .run();
  });

  it("does NOT touch delegation group when group does not exist in state", () => {
    const groupId = "missing-group";
    const sub = makeSub({
      filter: {
        eventTypes: ["agent:idle"],
        actorIds: [SUB_AGENT],
        delegationGroup: {
          groupId,
          awaitMode: "all",
          expectedAgentIds: [SUB_AGENT],
        },
      },
    });
    const action = addSubscription(WS, sub);

    return expectSaga(handleNewSubscriptionCatchUp, action)
      .provide([
        [matchers.select(selectWorkspaceSubscriptionState.select, WS), makeWsState({ [SUB_AGENT]: "idle" })],
        [matchers.select(selectDelegationGroup.select, WS, groupId), undefined],
      ])
      .not.put.actionType(appendDelegationGroupEvent.type)
      .not.put.actionType(markDelegationAgentCompleted.type)
      .run();
  });
});