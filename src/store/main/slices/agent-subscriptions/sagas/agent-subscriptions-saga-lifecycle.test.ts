import { describe, expect, it } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";

/**
 * Helper to detect redux-saga `delay()` effects inside expectSaga call providers.
 */
function isDelayEffect(effect: { fn?: { name?: string }; args?: unknown[] }): boolean {
  return effect.fn?.name === "delayP" && typeof effect.args?.[0] === "number";
}

import {
  addSubscription,
  appendDelegationGroupEvent,
  enqueueEvent,
  bumpVersion,
  markDelegationAgentCompleted,
  markOneShotFired,
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
  selectAgentStatus,
  selectAllSubscriptions,
  selectAllWorkspaceIds,
  selectDelegationGroup,
  selectIsAgentDeleted,
  selectIsOneShotFired,
  selectWorkspaceSubscriptionState,
} from "../agent-subscriptions-selectors";
import {
  requestDeliverQueuedEvents,
  requestPersist,
  requestRestore,
  requestEvictStaleAgents,
  requestValidateSubscriptions,
} from "./saga-actions";
import {
  handleDeliverQueuedEvents,
  watchAgentIdleForDelivery,
  periodicQueueSweep,
  formatNotification,
  sendBackendMessage,
} from "./delivery-saga";
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

// ---------------------------------------------------------------------------
// watchAgentIdleForDelivery
// ---------------------------------------------------------------------------

describe("watchAgentIdleForDelivery", () => {
  it("dispatches requestDeliverQueuedEvents when setAgentStatus('idle') fires", () => {
    return expectSaga(watchAgentIdleForDelivery)
      .dispatch(setAgentStatus(WS, AGENT, "idle"))
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .silentRun(100);
  });

  it("does NOT dispatch for setAgentStatus('responding')", () => {
    return expectSaga(watchAgentIdleForDelivery)
      .dispatch(setAgentStatus(WS, AGENT, "responding"))
      .not.put(requestDeliverQueuedEvents(WS, AGENT))
      .silentRun(100);
  });

  it("handles rapid idle→responding→idle transitions", () => {
    return expectSaga(watchAgentIdleForDelivery)
      .dispatch(setAgentStatus(WS, AGENT, "idle"))
      .dispatch(setAgentStatus(WS, AGENT, "responding"))
      .dispatch(setAgentStatus(WS, AGENT, "idle"))
      // Should have dispatched requestDeliverQueuedEvents twice (once per idle)
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .silentRun(100);
  });
});

// ---------------------------------------------------------------------------
// Multi-round oneShot lifecycle
// ---------------------------------------------------------------------------

describe("handleMatchEvent — multi-round oneShot lifecycle", () => {
  const AGENT_PARENT = "agent-parent";
  const AGENT_B = "agent-B";
  const AGENT_C = "agent-C";

  const makeOneShotSub = (
    id: string,
    agentId: string,
    actorId: string,
  ): AgentSubscriptionRecord => ({
    id,
    agentId,
    agentName: "Parent Agent",
    workspaceId: WS,
    filter: {
      eventTypes: ["agent:idle"],
      actorIds: [actorId],
      oneShot: true,
    },
    createdAt: new Date().toISOString(),
  });

  it("sub-1 fires and is removed when agent-B goes idle; sub-2 fires independently for agent-C", async () => {
    const sub1 = makeOneShotSub("sub-1", AGENT_PARENT, AGENT_B);

    // Round 1: agent-B goes idle → sub-1 fires
    const eventB = makeEvent("eB", "agent:idle");
    (eventB as any).workspaceId = WS;
    (eventB as any).actor = { type: "agent", id: AGENT_B };
    const actionB = workspaceEventAccepted(eventB);

    await expectSaga(handleMatchEvent, actionB)
      .provide([
        [matchers.select(selectAllSubscriptions.select, WS), [sub1]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT_PARENT), false],
        [matchers.select(selectIsOneShotFired.select, WS, "sub-1"), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT_PARENT), "idle"],
      ])
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, AGENT_PARENT))
      .put(markOneShotFired(WS, "sub-1"))
      .put(removeSubscription(WS, "sub-1"))
      .put(bumpVersion(WS))
      .run();

    // Round 2: sub-2 for agent-C (sub-1 already removed, not in subscriptions list)
    const sub2 = makeOneShotSub("sub-2", AGENT_PARENT, AGENT_C);

    const eventC = makeEvent("eC", "agent:idle");
    (eventC as any).workspaceId = WS;
    (eventC as any).actor = { type: "agent", id: AGENT_C };
    const actionC = workspaceEventAccepted(eventC);

    await expectSaga(handleMatchEvent, actionC)
      .provide([
        // sub-1 is gone — only sub-2 is in the subscription list
        [matchers.select(selectAllSubscriptions.select, WS), [sub2]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT_PARENT), false],
        [matchers.select(selectIsOneShotFired.select, WS, "sub-2"), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT_PARENT), "idle"],
      ])
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, AGENT_PARENT))
      .put(markOneShotFired(WS, "sub-2"))
      .put(removeSubscription(WS, "sub-2"))
      .put(bumpVersion(WS))
      .run();
  });

  it("sub-2 is not blocked by sub-1 being in firedOneShotSubscriptions", async () => {
    // sub-1 has already fired (is in firedOneShotSubscriptions but still in subscriptions list
    // due to timing). sub-2 is a new subscription that should fire independently.
    const sub1 = makeOneShotSub("sub-1", AGENT_PARENT, AGENT_B);
    const sub2 = makeOneShotSub("sub-2", AGENT_PARENT, AGENT_C);

    const eventC = makeEvent("eC", "agent:idle");
    (eventC as any).workspaceId = WS;
    (eventC as any).actor = { type: "agent", id: AGENT_C };
    const action = workspaceEventAccepted(eventC);

    await expectSaga(handleMatchEvent, action)
      .provide([
        // Both subs in subscriptions list
        [matchers.select(selectAllSubscriptions.select, WS), [sub1, sub2]],
        [matchers.select(selectIsAgentDeleted.select, WS, AGENT_PARENT), false],
        // sub-1 already fired
        [matchers.select(selectIsOneShotFired.select, WS, "sub-1"), true],
        // sub-2 not yet fired
        [matchers.select(selectIsOneShotFired.select, WS, "sub-2"), false],
        [matchers.select(selectAgentStatus.select, WS, AGENT_PARENT), "idle"],
      ])
      // sub-2 should fire
      .put.actionType(enqueueEvent.type)
      .put(requestDeliverQueuedEvents(WS, AGENT_PARENT))
      .put(markOneShotFired(WS, "sub-2"))
      .put(removeSubscription(WS, "sub-2"))
      .run();
  });
});

// ---------------------------------------------------------------------------
// Catch-up after oneShot removal
// ---------------------------------------------------------------------------

describe("handleNewSubscriptionCatchUp — after oneShot removal", () => {
  const SUB_AGENT_2 = "agent-sub-2";

  const makeSub = (overrides: Partial<AgentSubscriptionRecord> = {}): AgentSubscriptionRecord => ({
    id: "sub-new",
    agentId: AGENT,
    agentName: "Coordinator",
    workspaceId: WS,
    filter: {
      eventTypes: ["agent:idle"],
      actorIds: [SUB_AGENT_2],
      oneShot: true,
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it("new oneShot subscription catch-up works after a previous oneShot for the same parent was removed", () => {
    // A previous oneShot (sub-old) was fired and removed for this parent.
    // Now a new oneShot (sub-new) is created for a different agent.
    // Catch-up should still work because the new sub has its own ID.
    const sub = makeSub();
    const action = addSubscription(WS, sub);

    // The wsState has sub-old in firedOneShotSubscriptions but sub-new is not there
    const wsState = {
      ...emptyWorkspaceSubscriptionState,
      agentStatuses: { [SUB_AGENT_2]: "idle" as const },
      firedOneShotSubscriptions: ["sub-old"],
    };

    return expectSaga(handleNewSubscriptionCatchUp, action)
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
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .put(markOneShotFired(WS, "sub-new"))
      .put(removeSubscription(WS, "sub-new"))
      .put(bumpVersion(WS))
      .run();
  });
});

// ---------------------------------------------------------------------------
// Periodic Queue Sweep
// ---------------------------------------------------------------------------

describe("periodicQueueSweep", () => {
  /**
   * Provider factory for periodicQueueSweep tests.
   * The sweep has `while(true) { delay(); ... }` — if delay resolves immediately,
   * it becomes an infinite hot loop that OOMs the worker. This provider lets the
   * first delay resolve (so one iteration runs), then blocks forever on subsequent
   * delays so the saga parks cleanly until the test timeout fires.
   */
  function makeSweepProvider(selectProvider: (effect: any, next: () => any) => any) {
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
      select: selectProvider,
    };
  }

  it("dispatches requestDeliverQueuedEvents for idle agents with non-empty queues", () => {
    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      agentQueues: {
        [AGENT]: [makeQueuedEvent("e1", "high")],
      },
      agentStatuses: {
        [AGENT]: "idle",
      },
    };

    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider((effect, next) => {
        if (effect.args?.length === 0) return [WS];
        if (effect.args?.[0] === WS && effect.args?.length === 1) return wsState;
        return next();
      }))
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .run({ silenceTimeout: true });
  });

  it("skips agents that are not idle", () => {
    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      agentQueues: {
        [AGENT]: [makeQueuedEvent("e1", "high")],
      },
      agentStatuses: {
        [AGENT]: "responding",
      },
    };

    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider((effect, next) => {
        if (effect.args?.length === 0) return [WS];
        if (effect.args?.[0] === WS && effect.args?.length === 1) return wsState;
        return next();
      }))
      .not.put.actionType(requestDeliverQueuedEvents.type)
      .run({ silenceTimeout: true });
  });

  it("skips agents with empty queues", () => {
    const wsState: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      agentQueues: {
        [AGENT]: [],
      },
      agentStatuses: {
        [AGENT]: "idle",
      },
    };

    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider((effect, next) => {
        if (effect.args?.length === 0) return [WS];
        if (effect.args?.[0] === WS && effect.args?.length === 1) return wsState;
        return next();
      }))
      .not.put.actionType(requestDeliverQueuedEvents.type)
      .run({ silenceTimeout: true });
  });

  it("handles multiple workspaces with stuck events", () => {
    const WS2 = "ws-2";
    const AGENT2 = "agent-2";

    const wsState1: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      agentQueues: {
        [AGENT]: [makeQueuedEvent("e1", "high")],
      },
      agentStatuses: {
        [AGENT]: "idle",
      },
    };
    const wsState2: WorkspaceSubscriptionState = {
      ...emptyWorkspaceSubscriptionState,
      agentQueues: {
        [AGENT2]: [makeQueuedEvent("e2", "normal")],
      },
      agentStatuses: {
        [AGENT2]: "idle",
      },
    };

    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider((effect, next) => {
        if (effect.args?.length === 0) return [WS, WS2];
        if (effect.args?.[0] === WS && effect.args?.length === 1) return wsState1;
        if (effect.args?.[0] === WS2 && effect.args?.length === 1) return wsState2;
        return next();
      }))
      .put(requestDeliverQueuedEvents(WS, AGENT))
      .put(requestDeliverQueuedEvents(WS2, AGENT2))
      .run({ silenceTimeout: true });
  });

  it("does nothing when there are no workspaces", () => {
    return expectSaga(periodicQueueSweep)
      .provide(makeSweepProvider((effect, next) => {
        if (effect.args?.length === 0) return [];
        return next();
      }))
      .not.put.actionType(requestDeliverQueuedEvents.type)
      .run({ silenceTimeout: true });
  });
});
