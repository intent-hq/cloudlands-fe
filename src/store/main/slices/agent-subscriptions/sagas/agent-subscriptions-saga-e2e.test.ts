import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
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

import {
  addSubscription,
  appendDelegationGroupEvent,
  clearAgentQueue,
  enqueueEvent,
  markDelegationAgentCompleted,
  recordDeliveryFailure,
  recordDeliverySuccess,
  markDelegationDelivered,
  markOneShotFired,
  removeDelegationGroup,
  removeSubscription,
  requestDeliverEvents,
  requestDeliverQueuedEvents,
  requestDelegationGroupDelivery,
  setAgentStatus,
  emptyWorkspaceSubscriptionState,
  type QueuedEventRecord,
  type DelegationGroupTrackerRecord,
  type WorkspaceSubscriptionState,
} from "../agent-subscriptions-slice";
import {
  selectAgentQueue,
  selectAgentStatus,
  selectAllSubscriptionsRaw,
  selectAllWorkspaceIds,
  selectIsAgentDeleted,
  selectIsOneShotFired,
  selectDelegationGroupRaw,
  selectIsDelegationGroupCompleteRaw,
  selectWorkspaceSubscriptionState,
} from "../agent-subscriptions-selectors";
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
import {
  handleMatchEvent,
  handleNewSubscriptionCatchUp,
} from "./matching-saga";
import { workspaceEventAccepted } from "../../workspace-events/workspace-events-slice";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import type { AgentSubscriptionRecord } from "../types";

const WS = "ws-1";

const makeEvent = (id: string, type = "file:changed"): WorkspaceEvent =>
  ({
    id,
    type,
    data: { path: "/test" },
    timestamp: new Date().toISOString(),
  }) as unknown as WorkspaceEvent;

// ---------------------------------------------------------------------------
// End-to-end integration tests: multi-round subscription lifecycle
// Split from agent-subscriptions-saga.test.ts to avoid OOM in single worker.
// ---------------------------------------------------------------------------

describe("E2E: multi-round coordinator wake-up", () => {
  const COORDINATOR = "agent-coordinator";
  const IMPLEMENTOR = "agent-implementor";
  const VERIFIER = "agent-verifier";

  const makeOneShotSub = (
    id: string,
    agentId: string,
    actorId: string,
  ): AgentSubscriptionRecord => ({
    id,
    agentId,
    agentName: "Coordinator",
    workspaceId: WS,
    filter: {
      eventTypes: ["agent:idle"],
      actorIds: [actorId],
      oneShot: true,
    },
    createdAt: new Date().toISOString(),
  });

  it("coordinator wakes for agent-B, then creates new sub and wakes again for agent-C", async () => {
    // --- Round 1: coordinator subscribes to implementor ---
    const sub1 = makeOneShotSub("sub-impl", COORDINATOR, IMPLEMENTOR);

    const eventB = makeEvent("eB", "agent:idle");
    (eventB as any).workspaceId = WS;
    (eventB as any).actor = { type: "agent", id: IMPLEMENTOR };

    // Match + enqueue + deliver + oneShot cleanup
    await expectSaga(handleMatchEvent, workspaceEventAccepted(eventB))
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub1]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectIsOneShotFired.select, WS, "sub-impl"), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .put(markOneShotFired(WS, "sub-impl"))
      .put(removeSubscription(WS, "sub-impl"))
      .run();

    // --- Round 2: coordinator subscribes to verifier (sub-impl is gone) ---
    const sub2 = makeOneShotSub("sub-verif", COORDINATOR, VERIFIER);

    const eventC = makeEvent("eC", "agent:idle");
    (eventC as any).workspaceId = WS;
    (eventC as any).actor = { type: "agent", id: VERIFIER };

    await expectSaga(handleMatchEvent, workspaceEventAccepted(eventC))
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub2]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectIsOneShotFired.select, WS, "sub-verif"), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .put(markOneShotFired(WS, "sub-verif"))
      .put(removeSubscription(WS, "sub-verif"))
      .run();
  });

  it("delivery succeeds independently for both rounds", async () => {
    // Round 1 delivery
    const eventsR1 = [makeEvent("eB", "agent:idle")];
    const actionR1 = requestDeliverEvents(WS, COORDINATOR, eventsR1);

    await expectSaga(handleDeliverEvents, actionR1)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.call.fn(formatNotification), "Agent completed"],
        [matchers.call.fn(sendBackendMessage), { success: true }],
        [matchers.call.fn(dispatchWorkspaceEvent), undefined],
      ])
      .put.actionType(recordDeliverySuccess.type)
      .run();

    // Round 2 delivery
    const eventsR2 = [makeEvent("eC", "agent:idle")];
    const actionR2 = requestDeliverEvents(WS, COORDINATOR, eventsR2);

    await expectSaga(handleDeliverEvents, actionR2)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.call.fn(formatNotification), "Agent completed"],
        [matchers.call.fn(sendBackendMessage), { success: true }],
        [matchers.call.fn(dispatchWorkspaceEvent), undefined],
      ])
      .put.actionType(recordDeliverySuccess.type)
      .run();
  });
});

// ---------------------------------------------------------------------------
// E2E: DELIVERY_IN_FLIGHT retry → eventual success
// ---------------------------------------------------------------------------

describe("E2E: DELIVERY_IN_FLIGHT retry → eventual success", () => {
  const COORDINATOR = "agent-coordinator";

  afterEach(() => {
    clearDeliveryDedupCache();
  });

  it("re-enqueues on DELIVERY_IN_FLIGHT, then delivers when agent becomes idle", async () => {
    const events = [makeEvent("e1", "agent:idle")];
    const action = requestDeliverEvents(WS, COORDINATOR, events);

    // Step 1: First delivery attempt returns DELIVERY_IN_FLIGHT → re-enqueue
    await expectSaga(handleDeliverEvents, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          // Agent is still responding (stream in flight)
          if (effect.selector === selectAgentStatus.select) return "responding";
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          return next();
        },
        race() {
          return {
            result: { success: false, error: "Delivery in flight", errorCode: "DELIVERY_IN_FLIGHT" },
            timeout: undefined,
          };
        },
      })
      .put.actionType(enqueueEvent.type)
      // Agent is "responding" so no immediate re-delivery
      .not.put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .run({ timeout: 5000 });

    // Step 2: Agent becomes idle → watchAgentIdleForDelivery fires
    await expectSaga(watchAgentIdleForDelivery)
      .dispatch(setAgentStatus(WS, COORDINATOR, "idle"))
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .silentRun(100);

    // Step 3: The re-triggered delivery succeeds
    const requeuedEvents = [makeEvent("e1", "agent:idle")];
    const retryAction = requestDeliverEvents(WS, COORDINATOR, requeuedEvents);

    await expectSaga(handleDeliverEvents, retryAction)
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.call.fn(formatNotification), "Event notification"],
        [matchers.call.fn(sendBackendMessage), { success: true }],
        [matchers.call.fn(dispatchWorkspaceEvent), undefined],
      ])
      .put.actionType(recordDeliverySuccess.type)
      .run();
  });

  it("re-enqueues on DELIVERY_IN_FLIGHT and immediately re-delivers when agent is already idle", async () => {
    const events = [makeEvent("e1", "agent:idle")];
    const action = requestDeliverEvents(WS, COORDINATOR, events);

    await expectSaga(handleDeliverEvents, action)
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          // Agent is already idle
          if (effect.selector === selectAgentStatus.select) return "idle";
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
        race() {
          return {
            result: { success: false, error: "Delivery in flight", errorCode: "DELIVERY_IN_FLIGHT" },
            timeout: undefined,
          };
        },
      })
      .put.actionType(enqueueEvent.type)
      // Agent is already idle so should dispatch re-delivery
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .run({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// E2E: Rapid agent completion before subscription catch-up
// ---------------------------------------------------------------------------

describe("E2E: rapid agent completion before subscription catch-up", () => {
  const COORDINATOR = "agent-coordinator";
  const FAST_AGENT = "agent-fast";

  it("catch-up delivers when agent is already idle at subscribe time", async () => {
    const sub = {
      id: "sub-fast",
      agentId: COORDINATOR,
      agentName: "Coordinator",
      workspaceId: WS,
      filter: {
        eventTypes: ["agent:idle"] as string[],
        actorIds: [FAST_AGENT],
        oneShot: true,
      },
      createdAt: new Date().toISOString(),
    } satisfies AgentSubscriptionRecord;

    const wsState = {
      ...emptyWorkspaceSubscriptionState,
      agentStatuses: { [FAST_AGENT]: "idle" as const },
    };

    const action = addSubscription(WS, sub);

    // Catch-up should synthesize event + enqueue + deliver + oneShot cleanup
    await expectSaga(handleNewSubscriptionCatchUp, action)
      .provide({
        select({ selector, args }, next) {
          if (selector === selectWorkspaceSubscriptionState.select && args[0] === WS) return wsState;
          return next();
        },
        call(effect, next) {
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .put(markOneShotFired(WS, "sub-fast"))
      .put(removeSubscription(WS, "sub-fast"))
      .run();
  });

  it("live match fires when agent goes idle after subscription exists (no catch-up needed)", async () => {
    const sub = {
      id: "sub-live",
      agentId: COORDINATOR,
      agentName: "Coordinator",
      workspaceId: WS,
      filter: {
        eventTypes: ["agent:idle"] as string[],
        actorIds: [FAST_AGENT],
        oneShot: true,
      },
      createdAt: new Date().toISOString(),
    } satisfies AgentSubscriptionRecord;

    // Catch-up: agent is still responding → no catch-up
    const wsState = {
      ...emptyWorkspaceSubscriptionState,
      agentStatuses: { [FAST_AGENT]: "responding" as const },
    };
    const addAction = addSubscription(WS, sub);

    await expectSaga(handleNewSubscriptionCatchUp, addAction)
      .provide([
        [matchers.select(selectWorkspaceSubscriptionState.select, WS), wsState],
      ])
      .not.put.actionType(enqueueEvent.type)
      .run();

    // Live match: agent goes idle → handleMatchEvent fires
    const event = makeEvent("e-live", "agent:idle");
    (event as any).workspaceId = WS;
    (event as any).actor = { type: "agent", id: FAST_AGENT };

    await expectSaga(handleMatchEvent, workspaceEventAccepted(event))
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectIsOneShotFired.select, WS, "sub-live"), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .put(markOneShotFired(WS, "sub-live"))
      .put(removeSubscription(WS, "sub-live"))
      .run();
  });

  it("oneShot guard prevents double delivery when both catch-up and live match fire", async () => {
    // This tests the scenario where catch-up fires first (marking oneShot as fired),
    // then a live agent:idle event arrives — it should be skipped.
    const sub = {
      id: "sub-race",
      agentId: COORDINATOR,
      agentName: "Coordinator",
      workspaceId: WS,
      filter: {
        eventTypes: ["agent:idle"] as string[],
        actorIds: [FAST_AGENT],
        oneShot: true,
      },
      createdAt: new Date().toISOString(),
    } satisfies AgentSubscriptionRecord;

    // After catch-up fires, the oneShot is marked as fired
    const event = makeEvent("e-late", "agent:idle");
    (event as any).workspaceId = WS;
    (event as any).actor = { type: "agent", id: FAST_AGENT };

    await expectSaga(handleMatchEvent, workspaceEventAccepted(event))
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        // oneShot already fired by catch-up
        [matchers.select(selectIsOneShotFired.select, WS, "sub-race"), true],
      ])
      // Should NOT enqueue or deliver since oneShot already fired
      .not.put.actionType(enqueueEvent.type)
      .not.put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .not.put(markOneShotFired(WS, "sub-race"))
      .run();
  });
});


// ---------------------------------------------------------------------------
// E2E: delegation group (round 1) → oneShot queue (round 2)
// Reproduces the critical bug where coordinator wakes from delegation group
// but fails to wake from a subsequent oneShot subscription.
// ---------------------------------------------------------------------------

describe("E2E: delegation group then oneShot — multi-round coordinator wake-up", () => {
  const COORDINATOR = "agent-coordinator";
  const IMPLEMENTOR = "agent-implementor";
  const VERIFIER = "agent-verifier";

  it("coordinator wakes from delegation group (round 1), then wakes from oneShot (round 2)", async () => {
    // ---------------------------------------------------------------
    // Round 1: Delegation group — implementor completes
    // ---------------------------------------------------------------

    const delegTracker: DelegationGroupTrackerRecord = {
      groupId: "deleg-impl",
      parentAgentId: COORDINATOR,
      parentAgentName: "Coordinator",
      awaitMode: "all",
      expectedAgentIds: [IMPLEMENTOR],
      completedAgentIds: [IMPLEMENTOR],
      deletedAgentIds: [],
      events: [
        { type: "agent:idle", actor: { type: "agent", id: IMPLEMENTOR }, data: {} } as unknown as Record<string, unknown>,
      ],
      subscriptionId: "sub-deleg",
      delivered: false,
    };

    let round1DeliveryHappened = false;

    // Delegation group completes → delivers to idle coordinator
    await expectSaga(
      handleDelegationGroupDelivery,
      requestDelegationGroupDelivery(WS, "deleg-impl"),
    )
      .withState({ agentSubscriptions: { byWorkspaceId: {} } })
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroupRaw) return delegTracker;
          if (effect.selector === selectIsDelegationGroupCompleteRaw) return true;
          if (effect.selector === selectAgentStatus.select) return "idle";
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Delegation complete";
          if (effect.fn === sendBackendMessage) {
            round1DeliveryHappened = true;
            return { success: true };
          }
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
        race() {
          round1DeliveryHappened = true;
          return { result: { success: true }, timeout: undefined };
        },
      })
      .put(markDelegationDelivered(WS, "deleg-impl"))
      .call.fn(handleDeliverEvents)
      .put(removeDelegationGroup(WS, "deleg-impl"))
      .put(removeSubscription(WS, "sub-deleg"))
      .run();

    // Verify round 1 delivery happened
    expect(round1DeliveryHappened).toBe(true);

    // ---------------------------------------------------------------
    // Coordinator responds (processes the delegation result), then
    // goes idle again and creates a oneShot subscription for verifier.
    // ---------------------------------------------------------------

    // Verify watchAgentIdleForDelivery fires when coordinator goes idle
    await expectSaga(watchAgentIdleForDelivery)
      .dispatch(setAgentStatus(WS, COORDINATOR, "responding"))
      .dispatch(setAgentStatus(WS, COORDINATOR, "idle"))
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .silentRun(100);

    // ---------------------------------------------------------------
    // Round 2: OneShot subscription — verifier completes
    // ---------------------------------------------------------------

    const oneShotSub: AgentSubscriptionRecord = {
      id: "sub-verifier",
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

    // Verifier goes idle → matching saga fires
    const verifierIdleEvent = makeEvent("eV", "agent:idle");
    (verifierIdleEvent as any).workspaceId = WS;
    (verifierIdleEvent as any).actor = { type: "agent", id: VERIFIER };

    await expectSaga(handleMatchEvent, workspaceEventAccepted(verifierIdleEvent))
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [oneShotSub]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectIsOneShotFired.select, WS, "sub-verifier"), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .put(markOneShotFired(WS, "sub-verifier"))
      .put(removeSubscription(WS, "sub-verifier"))
      .run();

    // Verify queued event delivery works
    const queue: QueuedEventRecord[] = [
      {
        event: verifierIdleEvent,
        priority: "normal",
        queuedAt: new Date().toISOString(),
        subscriptionId: "sub-verifier",
        oneShot: true,
      },
    ];

    await expectSaga(handleDeliverQueuedEvents, requestDeliverQueuedEvents(WS, COORDINATOR))
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectAgentQueue.select, WS, COORDINATOR), queue],
      ])
      .put(clearAgentQueue(WS, COORDINATOR))
      .put.actionType(requestDeliverEvents.type)
      .run();

    // Verify actual delivery works for round 2
    let round2DeliveryHappened = false;

    await expectSaga(
      handleDeliverEvents,
      requestDeliverEvents(WS, COORDINATOR, [verifierIdleEvent]),
    )
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Verifier completed";
          if (effect.fn === sendBackendMessage) {
            round2DeliveryHappened = true;
            return { success: true };
          }
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
          return next();
        },
        race() {
          round2DeliveryHappened = true;
          return { result: { success: true }, timeout: undefined };
        },
      })
      .put.actionType(recordDeliverySuccess.type)
      .run();

    // Verify round 2 delivery happened
    expect(round2DeliveryHappened).toBe(true);
  });

  it("oneShot catch-up path works after delegation group delivery", async () => {
    // Round 1: delegation group delivers (same as above, abbreviated)
    await expectSaga(
      handleDelegationGroupDelivery,
      requestDelegationGroupDelivery(WS, "deleg-impl"),
    )
      .withState({ agentSubscriptions: { byWorkspaceId: {} } })
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroupRaw) {
            return {
              groupId: "deleg-impl",
              parentAgentId: COORDINATOR,
              parentAgentName: "Coordinator",
              awaitMode: "all",
              expectedAgentIds: [IMPLEMENTOR],
              completedAgentIds: [IMPLEMENTOR],
              deletedAgentIds: [],
              events: [{ type: "agent:idle", data: {} }],
              subscriptionId: "sub-deleg",
              delivered: false,
            };
          }
          if (effect.selector === selectIsDelegationGroupCompleteRaw) return true;
          if (effect.selector === selectAgentStatus.select) return "idle";
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Done";
          if (effect.fn === sendBackendMessage) return { success: true };
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
        race() {
          return { result: { success: true }, timeout: undefined };
        },
      })
      .call.fn(handleDeliverEvents)
      .run();

    // Round 2: Coordinator creates oneShot sub for verifier, but verifier
    // is ALREADY idle → catch-up path fires
    const oneShotSub: AgentSubscriptionRecord = {
      id: "sub-verif-catchup",
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

    const wsState = {
      ...emptyWorkspaceSubscriptionState,
      agentStatuses: { [VERIFIER]: "idle" as const },
    };

    await expectSaga(handleNewSubscriptionCatchUp, addSubscription(WS, oneShotSub))
      .provide({
        select({ selector, args }, next) {
          if (selector === selectWorkspaceSubscriptionState.select && args[0] === WS) return wsState;
          return next();
        },
        call(effect, next) {
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .put(markOneShotFired(WS, "sub-verif-catchup"))
      .put(removeSubscription(WS, "sub-verif-catchup"))
      .run();
  });
});

// ---------------------------------------------------------------------------
// E2E: No-window delegation group wakeup regression test
// Reproduces the exact bug where delegation group delivery fails because no
// window is viewing the workspace. Before the fix, events were permanently
// lost because deliverWithRetry cleaned up the subscription/group without
// any re-enqueue path. The fix adds a safety-net re-enqueue so the events
// survive and are delivered once the window becomes available.
// ---------------------------------------------------------------------------

describe("E2E: no-window delegation group wakeup (regression)", () => {
  const COORDINATOR = "agent-coordinator";
  const IMPL_A = "agent-impl-a";
  const IMPL_B = "agent-impl-b";

  afterEach(() => {
    clearDeliveryDedupCache();
  });

  it("re-enqueues delegation events when delivery fails (no window), then delivers on retry", async () => {
    // --- Setup: delegation group with two implementors, both completed ---
    const delegTracker: DelegationGroupTrackerRecord = {
      groupId: "deleg-nowin",
      parentAgentId: COORDINATOR,
      parentAgentName: "Coordinator",
      awaitMode: "all",
      expectedAgentIds: [IMPL_A, IMPL_B],
      completedAgentIds: [IMPL_A, IMPL_B],
      deletedAgentIds: [],
      events: [
        { id: "ev-a", type: "agent:idle", actor: { type: "agent", id: IMPL_A }, data: {}, timestamp: new Date().toISOString() } as unknown as Record<string, unknown>,
        { id: "ev-b", type: "agent:idle", actor: { type: "agent", id: IMPL_B }, data: {}, timestamp: new Date().toISOString() } as unknown as Record<string, unknown>,
      ],
      subscriptionId: "sub-deleg-nowin",
      delivered: false,
    };

    // Step 1: Delegation group completes but handleDeliverEvents fails
    // (simulates no window viewing the workspace — all retries exhausted)
    let deliveryAttempted = false;

    await expectSaga(
      handleDelegationGroupDelivery,
      requestDelegationGroupDelivery(WS, "deleg-nowin"),
    )
      .withState({ agentSubscriptions: { byWorkspaceId: {} } })
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroupRaw) return delegTracker;
          if (effect.selector === selectIsDelegationGroupCompleteRaw) return true;
          if (effect.selector === selectAgentStatus.select) return "idle";
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Delegation complete";
          // Simulate delivery failure — no window viewing workspace
          if (effect.fn === sendBackendMessage) {
            deliveryAttempted = true;
            return { success: false, error: "No active window for workspace" };
          }
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      // Delegation marked delivered (prevents re-entry)
      .put(markDelegationDelivered(WS, "deleg-nowin"))
      // handleDeliverEvents was attempted
      .call.fn(handleDeliverEvents)
      // CRITICAL: events are re-enqueued with high priority (safety net)
      .put.actionType(enqueueEvent.type)
      // Group and subscription cleaned up
      .put(removeDelegationGroup(WS, "deleg-nowin"))
      .put(removeSubscription(WS, "sub-deleg-nowin"))
      // Trigger delivery of re-enqueued events
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .run();

    expect(deliveryAttempted).toBe(true);

    // Step 2: Queued events survive and are delivered on retry
    // (simulates window becoming available / queued delivery triggered)
    const requeuedEvents = delegTracker.events.map((e) => ({
      ...e,
      metadata: {
        delegationGroupId: "deleg-nowin",
        completionStatus: "completed",
        deletedAgentCount: 0,
      },
    }));

    const queue: QueuedEventRecord[] = requeuedEvents.map((e) => ({
      event: e as unknown as WorkspaceEvent,
      priority: "high" as const,
      queuedAt: new Date().toISOString(),
      oneShot: false,
    }));

    // handleDeliverQueuedEvents dequeues and dispatches requestDeliverEvents
    await expectSaga(handleDeliverQueuedEvents, requestDeliverQueuedEvents(WS, COORDINATOR))
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectAgentQueue.select, WS, COORDINATOR), queue],
      ])
      .put(clearAgentQueue(WS, COORDINATOR))
      .put.actionType(requestDeliverEvents.type)
      .run();

    // Step 3: The retry delivery succeeds
    let retryDeliverySucceeded = false;

    await expectSaga(
      handleDeliverEvents,
      requestDeliverEvents(WS, COORDINATOR, requeuedEvents as unknown as WorkspaceEvent[]),
    )
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Delegation complete";
          if (effect.fn === sendBackendMessage) {
            retryDeliverySucceeded = true;
            return { success: true };
          }
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
          return next();
        },
        race() {
          return { result: { success: true }, timeout: undefined };
        },
      })
      .put.actionType(recordDeliverySuccess.type)
      .run();

    expect(retryDeliverySucceeded).toBe(true);
  });

  it("dedup cache prevents double delivery when re-enqueued events are retried after success", async () => {
    // Simulate: first delivery succeeds AND events are re-enqueued (safety net).
    // The second delivery attempt should be skipped by the dedup cache.
    const events = [
      makeEvent("ev-dedup-1", "agent:idle"),
      makeEvent("ev-dedup-2", "agent:idle"),
    ];

    // Step 1: First delivery succeeds (populates dedup cache)
    await expectSaga(
      handleDeliverEvents,
      requestDeliverEvents(WS, COORDINATOR, events),
    )
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Event notification";
          if (effect.fn === sendBackendMessage) return { success: true };
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
          return next();
        },
        race() {
          return { result: { success: true }, timeout: undefined };
        },
      })
      .put.actionType(recordDeliverySuccess.type)
      .run();

    // Step 2: Second delivery with same event IDs should be skipped entirely
    // (filterAlreadyDelivered removes all events, saga returns early)
    await expectSaga(
      handleDeliverEvents,
      requestDeliverEvents(WS, COORDINATOR, events),
    )
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
      ])
      // Should NOT attempt delivery again
      .not.put.actionType(recordDeliverySuccess.type)
      .not.put.actionType(recordDeliveryFailure.type)
      .run();
  });
});

describe("periodicQueueSweep — stale 'responding' recovery", () => {
  const WS = "ws-sweep";
  const COORDINATOR = "agent-coordinator";
  const STALE_THRESHOLD_MS = 60_000;

  /**
   * Provider factory: lets the first delay resolve (one sweep iteration),
   * then blocks forever on subsequent delays to prevent an infinite hot loop.
   */
  function makeSweepCallProvider() {
    let delayCount = 0;
    return (effect: any, next: () => any) => {
      if (isDelayEffect(effect)) {
        delayCount++;
        if (delayCount > 1) return new Promise(() => {}); // block forever
        return undefined;
      }
      return next();
    };
  }

  it("delivers events for agents stuck in 'responding' with old queued events", async () => {
    const staleQueuedAt = new Date(Date.now() - STALE_THRESHOLD_MS - 5000).toISOString();
    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      agentStatuses: { [COORDINATOR]: "responding" },
      agentQueues: {
        [COORDINATOR]: [
          {
            event: { type: "agent:idle", timestamp: staleQueuedAt, workspaceId: WS } as any,
            queuedAt: staleQueuedAt,
            priority: "high",
          },
        ],
      },
    };

    await expectSaga(periodicQueueSweep)
      .provide({
        select({ selector, args }, next) {
          if (selector === selectAllWorkspaceIds.select) return [WS];
          if (selector === selectWorkspaceSubscriptionState.select && args[0] === WS) return wsState;
          return next();
        },
        call: makeSweepCallProvider(),
      })
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .run({ timeout: 500 });
  });

  it("does NOT deliver for 'responding' agents with recent queued events", async () => {
    const recentQueuedAt = new Date(Date.now() - 5000).toISOString(); // 5s ago
    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      agentStatuses: { [COORDINATOR]: "responding" },
      agentQueues: {
        [COORDINATOR]: [
          {
            event: { type: "agent:idle", timestamp: recentQueuedAt, workspaceId: WS } as any,
            queuedAt: recentQueuedAt,
            priority: "high",
          },
        ],
      },
    };

    await expectSaga(periodicQueueSweep)
      .provide({
        select({ selector, args }, next) {
          if (selector === selectAllWorkspaceIds.select) return [WS];
          if (selector === selectWorkspaceSubscriptionState.select && args[0] === WS) return wsState;
          return next();
        },
        call: makeSweepCallProvider(),
      })
      .not.put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .run({ timeout: 500 });
  });

  it("delivers for idle agents with queued events (existing behavior preserved)", async () => {
    const queuedAt = new Date().toISOString();
    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      agentStatuses: { [COORDINATOR]: "idle" },
      agentQueues: {
        [COORDINATOR]: [
          {
            event: { type: "agent:idle", timestamp: queuedAt, workspaceId: WS } as any,
            queuedAt,
            priority: "high",
          },
        ],
      },
    };

    await expectSaga(periodicQueueSweep)
      .provide({
        select({ selector, args }, next) {
          if (selector === selectAllWorkspaceIds.select) return [WS];
          if (selector === selectWorkspaceSubscriptionState.select && args[0] === WS) return wsState;
          return next();
        },
        call: makeSweepCallProvider(),
      })
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .run({ timeout: 500 });
  });
});

// ---------------------------------------------------------------------------
// E2E: No-window subscription matching → delivery retry → wakeup
// Covers the full path from handleMatchEvent through delivery failure
// (no window viewing workspace) to eventual successful retry with
// agent:woken-by-subscription evidence and no duplicate deliveries.
// ---------------------------------------------------------------------------

describe("E2E: no-window subscription matching with wakeup verification", () => {
  const COORDINATOR = "agent-coordinator";
  const IMPLEMENTOR = "agent-implementor";

  afterEach(() => {
    clearDeliveryDedupCache();
  });

  /**
   * Non-delegation (oneShot) path: handleMatchEvent enqueues when no window
   * is available, delivery fails with retries exhausted, events survive in
   * the queue, and a subsequent delivery succeeds with woken-by-subscription.
   */
  it("matching enqueues event, delivery fails (no window), retry succeeds with woken-by-subscription", async () => {
    const sub: AgentSubscriptionRecord = {
      id: "sub-nowin",
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

    const event = makeEvent("ev-nowin-1", "agent:idle");
    (event as any).workspaceId = WS;
    (event as any).actor = { type: "agent", id: IMPLEMENTOR };

    // Step 1: handleMatchEvent matches and enqueues the event
    await expectSaga(handleMatchEvent, workspaceEventAccepted(event))
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectIsOneShotFired.select, WS, "sub-nowin"), false],
        [matchers.select(selectAgentStatus.select, WS, COORDINATOR), "idle"],
      ])
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .put(markOneShotFired(WS, "sub-nowin"))
      .put(removeSubscription(WS, "sub-nowin"))
      .run();

    // Step 2: Queued event delivery proceeds but backend delivery fails
    // (no window viewing the workspace — all 3 retries exhausted)
    const queue: QueuedEventRecord[] = [
      {
        event,
        priority: "normal",
        queuedAt: new Date().toISOString(),
        subscriptionId: "sub-nowin",
        oneShot: true,
      },
    ];

    await expectSaga(handleDeliverQueuedEvents, requestDeliverQueuedEvents(WS, COORDINATOR))
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
        [matchers.select(selectAgentQueue.select, WS, COORDINATOR), queue],
      ])
      .put(clearAgentQueue(WS, COORDINATOR))
      .put.actionType(requestDeliverEvents.type)
      .run();

    // Step 3: handleDeliverEvents fails all retries (simulating no window)
    await expectSaga(
      handleDeliverEvents,
      requestDeliverEvents(WS, COORDINATOR, [event]),
    )
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Agent completed";
          if (effect.fn === sendBackendMessage) {
            return { success: false, error: "No active window for workspace" };
          }
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      // All retries exhausted → failure recorded
      .put.actionType(recordDeliveryFailure.type)
      .not.put.actionType(recordDeliverySuccess.type)
      .run({ timeout: 5000 });

    // Step 4: The event must survive. Simulate window becoming available
    // and a sweep or idle trigger re-delivering. This time delivery succeeds.
    let wokeBySubscription = false;

    await expectSaga(
      handleDeliverEvents,
      requestDeliverEvents(WS, COORDINATOR, [event]),
    )
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Agent completed";
          if (effect.fn === sendBackendMessage) return { success: true };
          if (effect.fn === dispatchWorkspaceEvent) {
            // Capture the woken-by-subscription event
            if (effect.args?.[0] === "agent:woken-by-subscription") {
              wokeBySubscription = true;
            }
            return undefined;
          }
          return next();
        },
        race() {
          return { result: { success: true }, timeout: undefined };
        },
      })
      .put.actionType(recordDeliverySuccess.type)
      .run();

    expect(wokeBySubscription).toBe(true);

    // Step 5: A duplicate delivery with the same event IDs is skipped
    // (dedup cache populated by successful delivery in step 4)
    await expectSaga(
      handleDeliverEvents,
      requestDeliverEvents(WS, COORDINATOR, [event]),
    )
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
      ])
      .not.put.actionType(recordDeliverySuccess.type)
      .not.put.actionType(recordDeliveryFailure.type)
      .run();
  });

  /**
   * Delegation path: handleMatchEvent routes to delegation group, delivery
   * fails (no window), events are re-enqueued by delegation-group-saga's
   * safety net, and retry succeeds with agent:woken-by-subscription.
   */
  it("delegation match → no-window failure → re-enqueue → retry with woken-by-subscription", async () => {
    const sub: AgentSubscriptionRecord = {
      id: "sub-deleg-nowin",
      agentId: COORDINATOR,
      agentName: "Coordinator",
      workspaceId: WS,
      filter: {
        eventTypes: ["agent:*"],
        actorIds: [IMPLEMENTOR],
        delegationGroup: {
          groupId: "deleg-match-nowin",
          awaitMode: "all",
          expectedAgentIds: [IMPLEMENTOR],
        },
      },
      createdAt: new Date().toISOString(),
    };

    const event = makeEvent("ev-deleg-match-1", "agent:idle");
    (event as any).workspaceId = WS;
    (event as any).actor = { type: "agent", id: IMPLEMENTOR };

    // Step 1: handleMatchEvent matches and routes to delegation group
    await expectSaga(handleMatchEvent, workspaceEventAccepted(event))
      .provide([
        [matchers.select(selectAllSubscriptionsRaw, WS), [sub]],
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
      ])
      .put(appendDelegationGroupEvent(WS, "deleg-match-nowin", event))
      .put(markDelegationAgentCompleted(WS, "deleg-match-nowin", IMPLEMENTOR))
      .run();

    // Step 2: Delegation group completes, delivery fails (no window)
    const delegTracker: DelegationGroupTrackerRecord = {
      groupId: "deleg-match-nowin",
      parentAgentId: COORDINATOR,
      parentAgentName: "Coordinator",
      awaitMode: "all",
      expectedAgentIds: [IMPLEMENTOR],
      completedAgentIds: [IMPLEMENTOR],
      deletedAgentIds: [],
      events: [event as unknown as Record<string, unknown>],
      subscriptionId: "sub-deleg-nowin",
      delivered: false,
    };

    await expectSaga(
      handleDelegationGroupDelivery,
      requestDelegationGroupDelivery(WS, "deleg-match-nowin"),
    )
      .withState({ agentSubscriptions: { byWorkspaceId: {} } })
      .provide({
        select(effect, next) {
          if (effect.selector === selectDelegationGroupRaw) return delegTracker;
          if (effect.selector === selectIsDelegationGroupCompleteRaw) return true;
          if (effect.selector === selectAgentStatus.select) return "idle";
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Delegation complete";
          if (effect.fn === sendBackendMessage) {
            return { success: false, error: "No active window for workspace" };
          }
          if (effect.fn === dispatchWorkspaceEvent) return undefined;
          if (isDelayEffect(effect)) return undefined;
          return next();
        },
      })
      .put(markDelegationDelivered(WS, "deleg-match-nowin"))
      .call.fn(handleDeliverEvents)
      // Safety net re-enqueues events
      .put.actionType(enqueueEvent.type)
      // Group and subscription cleaned up
      .put(removeDelegationGroup(WS, "deleg-match-nowin"))
      .put(removeSubscription(WS, "sub-deleg-nowin"))
      // Delivery of re-enqueued events triggered
      .put(requestDeliverQueuedEvents(WS, COORDINATOR))
      .run();

    // Step 3: Re-enqueued events are delivered successfully
    const requeuedEvent = {
      ...event,
      metadata: {
        delegationGroupId: "deleg-match-nowin",
        completionStatus: "completed",
        deletedAgentCount: 0,
      },
    } as unknown as WorkspaceEvent;

    let wokeBySubscription = false;

    await expectSaga(
      handleDeliverEvents,
      requestDeliverEvents(WS, COORDINATOR, [requeuedEvent]),
    )
      .provide({
        select(effect, next) {
          if (effect.selector === selectIsAgentDeleted.select) return false;
          return next();
        },
        call(effect, next) {
          if (effect.fn === formatNotification) return "Delegation complete";
          if (effect.fn === sendBackendMessage) return { success: true };
          if (effect.fn === dispatchWorkspaceEvent) {
            if (effect.args?.[0] === "agent:woken-by-subscription") {
              wokeBySubscription = true;
            }
            return undefined;
          }
          return next();
        },
        race() {
          return { result: { success: true }, timeout: undefined };
        },
      })
      .put.actionType(recordDeliverySuccess.type)
      .run();

    expect(wokeBySubscription).toBe(true);

    // Step 4: No duplicate delivery for same event IDs
    await expectSaga(
      handleDeliverEvents,
      requestDeliverEvents(WS, COORDINATOR, [requeuedEvent]),
    )
      .provide([
        [matchers.select(selectIsAgentDeleted.select, WS, COORDINATOR), false],
      ])
      .not.put.actionType(recordDeliverySuccess.type)
      .not.put.actionType(recordDeliveryFailure.type)
      .run();
  });
});