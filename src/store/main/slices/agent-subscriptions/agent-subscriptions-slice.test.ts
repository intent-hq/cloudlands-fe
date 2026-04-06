import { describe, expect, it } from "vitest";
import {
  agentSubscriptionsReducer,
  initialState,
  emptyWorkspaceSubscriptionState,
  addSubscription,
  removeSubscription,
  removeAllSubscriptions,
  setSubscriptionsSnapshot,
  setAgentStatus,
  enqueueEvent,
  clearAgentQueue,
  setDelegationGroup,
  removeDelegationGroup,
  markDelegationAgentCompleted,
  markDelegationAgentDeleted,
  addAgentToDelegationGroup,
  markDelegationDelivered,
  markOneShotFired,
  recordDeliverySuccess,
  recordDeliveryFailure,
  recordDeliveryTimeout,
  recordDroppedEvents,
  markAgentDeleted,
  evictDeletedAgent,
  bumpVersion,
  clearWorkspace,
  type AgentSubscriptionRecord,
  type DelegationGroupTrackerRecord,
  type QueuedEventRecord,
  type WorkspaceSubscriptionState,
} from "./agent-subscriptions-slice";

const WS = "ws-1";

const makeSub = (overrides: Partial<AgentSubscriptionRecord> = {}): AgentSubscriptionRecord => ({
  id: "sub-1",
  agentId: "agent-1",
  agentName: "Agent 1",
  workspaceId: WS,
  filter: { eventTypes: ["agent:idle"] },
  createdAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

const makeTracker = (
  overrides: Partial<DelegationGroupTrackerRecord> = {},
): DelegationGroupTrackerRecord => ({
  groupId: "group-1",
  parentAgentId: "agent-1",
  parentAgentName: "Agent 1",
  awaitMode: "all",
  expectedAgentIds: ["agent-2", "agent-3"],
  completedAgentIds: [],
  deletedAgentIds: [],
  events: [],
  subscriptionId: "sub-1",
  delivered: false,
  ...overrides,
});

const makeQueuedEvent = (overrides: Partial<QueuedEventRecord> = {}): QueuedEventRecord => ({
  event: { type: "agent:idle", id: "evt-1" },
  queuedAt: "2025-01-01T00:00:00Z",
  priority: "normal",
  ...overrides,
});

const reduce = (action: any, state = initialState) =>
  agentSubscriptionsReducer(state, action);

describe("agentSubscriptionsReducer", () => {
  it("returns initial state for unknown action", () => {
    expect(reduce({ type: "UNKNOWN" })).toBe(initialState);
  });

  it("initial state has empty byWorkspaceId", () => {
    expect(initialState).toEqual({ byWorkspaceId: {} });
  });

  describe("addSubscription", () => {
    it("adds a subscription to the workspace", () => {
      const sub = makeSub();
      const next = reduce(addSubscription(WS, sub));
      expect(next.byWorkspaceId[WS]?.subscriptions["sub-1"]).toEqual(sub);
    });
  });

  describe("removeSubscription", () => {
    it("removes a subscription and cleans up firedOneShot", () => {
      const sub = makeSub();
      let state = reduce(addSubscription(WS, sub));
      state = reduce(markOneShotFired(WS, "sub-1"), state);
      state = reduce(removeSubscription(WS, "sub-1"), state);
      expect(state.byWorkspaceId[WS]?.subscriptions["sub-1"]).toBeUndefined();
      expect(state.byWorkspaceId[WS]?.firedOneShotSubscriptions).not.toContain("sub-1");
    });

    it("returns same state if subscription does not exist", () => {
      const state = reduce(addSubscription(WS, makeSub()));
      const next = reduce(removeSubscription(WS, "nonexistent"), state);
      expect(next).toBe(state);
    });
  });

  describe("removeAllSubscriptions", () => {
    it("removes all subs, queues, statuses, and delegation groups for agent", () => {
      let state = reduce(addSubscription(WS, makeSub({ id: "s1", agentId: "a1" })));
      state = reduce(addSubscription(WS, makeSub({ id: "s2", agentId: "a1" })), state);
      state = reduce(addSubscription(WS, makeSub({ id: "s3", agentId: "a2" })), state);
      state = reduce(setAgentStatus(WS, "a1", "responding"), state);
      state = reduce(enqueueEvent(WS, "a1", makeQueuedEvent()), state);
      state = reduce(setDelegationGroup(WS, makeTracker({ parentAgentId: "a1" })), state);
      state = reduce(removeAllSubscriptions(WS, "a1"), state);
      const ws = state.byWorkspaceId[WS]!;
      expect(Object.keys(ws.subscriptions)).toEqual(["s3"]);
      expect(ws.agentQueues["a1"]).toBeUndefined();
      expect(ws.agentStatuses["a1"]).toBeUndefined();
      expect(Object.keys(ws.delegationGroups)).toEqual([]);
    });
  });

  describe("setSubscriptionsSnapshot", () => {
    it("replaces entire workspace state", () => {
      const snapshot: WorkspaceSubscriptionState = {
        ...emptyWorkspaceSubscriptionState,
        version: 42,
      };
      const next = reduce(setSubscriptionsSnapshot(WS, snapshot));
      expect(next.byWorkspaceId[WS]).toEqual(snapshot);
    });
  });

  describe("setAgentStatus", () => {
    it("sets agent status", () => {
      const next = reduce(setAgentStatus(WS, "a1", "responding"));
      expect(next.byWorkspaceId[WS]?.agentStatuses["a1"]).toBe("responding");
    });

    it("returns same state if status unchanged", () => {
      const state = reduce(setAgentStatus(WS, "a1", "idle"));
      const next = reduce(setAgentStatus(WS, "a1", "idle"), state);
      expect(next).toBe(state);
    });
  });



  describe("enqueueEvent", () => {
    it("appends event to agent queue", () => {
      let state = reduce(enqueueEvent(WS, "a1", makeQueuedEvent()));
      state = reduce(enqueueEvent(WS, "a1", makeQueuedEvent({ priority: "high" })), state);
      expect(state.byWorkspaceId[WS]?.agentQueues["a1"]).toHaveLength(2);
    });
  });

  describe("clearAgentQueue", () => {
    it("empties the agent queue", () => {
      let state = reduce(enqueueEvent(WS, "a1", makeQueuedEvent()));
      state = reduce(clearAgentQueue(WS, "a1"), state);
      expect(state.byWorkspaceId[WS]?.agentQueues["a1"]).toEqual([]);
    });

    it("returns same state if queue already empty", () => {
      const state = reduce(setAgentStatus(WS, "a1", "idle"));
      const next = reduce(clearAgentQueue(WS, "a1"), state);
      expect(next).toBe(state);
    });
  });

  describe("setDelegationGroup", () => {
    it("adds a delegation group tracker", () => {
      const tracker = makeTracker();
      const next = reduce(setDelegationGroup(WS, tracker));
      expect(next.byWorkspaceId[WS]?.delegationGroups["group-1"]).toEqual(tracker);
    });
  });

  describe("removeDelegationGroup", () => {
    it("removes a delegation group", () => {
      let state = reduce(setDelegationGroup(WS, makeTracker()));
      state = reduce(removeDelegationGroup(WS, "group-1"), state);
      expect(state.byWorkspaceId[WS]?.delegationGroups["group-1"]).toBeUndefined();
    });

    it("returns same state if group does not exist", () => {
      const state = reduce(setDelegationGroup(WS, makeTracker()));
      const next = reduce(removeDelegationGroup(WS, "nonexistent"), state);
      expect(next).toBe(state);
    });
  });

  describe("markDelegationAgentCompleted", () => {
    it("adds agentId to completedAgentIds", () => {
      let state = reduce(setDelegationGroup(WS, makeTracker()));
      state = reduce(markDelegationAgentCompleted(WS, "group-1", "agent-2"), state);
      expect(state.byWorkspaceId[WS]?.delegationGroups["group-1"]?.completedAgentIds).toContain("agent-2");
    });

    it("is idempotent", () => {
      let state = reduce(setDelegationGroup(WS, makeTracker()));
      state = reduce(markDelegationAgentCompleted(WS, "group-1", "agent-2"), state);
      const next = reduce(markDelegationAgentCompleted(WS, "group-1", "agent-2"), state);
      expect(next).toBe(state);
    });
  });

  describe("markDelegationAgentDeleted", () => {
    it("adds agentId to deletedAgentIds", () => {
      let state = reduce(setDelegationGroup(WS, makeTracker()));
      state = reduce(markDelegationAgentDeleted(WS, "group-1", "agent-2"), state);
      expect(state.byWorkspaceId[WS]?.delegationGroups["group-1"]?.deletedAgentIds).toContain("agent-2");
    });
  });

  describe("addAgentToDelegationGroup", () => {
    it("adds agent to expectedAgentIds", () => {
      let state = reduce(setDelegationGroup(WS, makeTracker()));
      state = reduce(addAgentToDelegationGroup(WS, "group-1", "agent-4"), state);
      expect(state.byWorkspaceId[WS]?.delegationGroups["group-1"]?.expectedAgentIds).toContain("agent-4");
    });

    it("is idempotent", () => {
      let state = reduce(setDelegationGroup(WS, makeTracker()));
      state = reduce(addAgentToDelegationGroup(WS, "group-1", "agent-2"), state);
      const next = reduce(addAgentToDelegationGroup(WS, "group-1", "agent-2"), state);
      expect(next).toBe(state);
    });
  });

  describe("markDelegationDelivered", () => {
    it("sets delivered flag to true", () => {
      let state = reduce(setDelegationGroup(WS, makeTracker()));
      state = reduce(markDelegationDelivered(WS, "group-1"), state);
      expect(state.byWorkspaceId[WS]?.delegationGroups["group-1"]?.delivered).toBe(true);
    });

    it("is idempotent", () => {
      let state = reduce(setDelegationGroup(WS, makeTracker()));
      state = reduce(markDelegationDelivered(WS, "group-1"), state);
      const next = reduce(markDelegationDelivered(WS, "group-1"), state);
      expect(next).toBe(state);
    });
  });

  describe("markOneShotFired", () => {
    it("adds subscription ID to fired list", () => {
      const next = reduce(markOneShotFired(WS, "sub-1"));
      expect(next.byWorkspaceId[WS]?.firedOneShotSubscriptions).toContain("sub-1");
    });

    it("is idempotent", () => {
      const state = reduce(markOneShotFired(WS, "sub-1"));
      const next = reduce(markOneShotFired(WS, "sub-1"), state);
      expect(next).toBe(state);
    });
  });

  describe("delivery stats", () => {
    it("recordDeliverySuccess increments totals and successes", () => {
      const next = reduce(recordDeliverySuccess(WS));
      const stats = next.byWorkspaceId[WS]!.deliveryStats;
      expect(stats.totalDeliveries).toBe(1);
      expect(stats.successfulDeliveries).toBe(1);
    });

    it("recordDeliveryFailure increments totals and failures", () => {
      const next = reduce(recordDeliveryFailure(WS));
      expect(next.byWorkspaceId[WS]!.deliveryStats.failedDeliveries).toBe(1);
    });

    it("recordDeliveryTimeout increments totals and timeouts", () => {
      const next = reduce(recordDeliveryTimeout(WS));
      expect(next.byWorkspaceId[WS]!.deliveryStats.timeoutDeliveries).toBe(1);
    });

    it("recordDroppedEvents increments dropped count", () => {
      const next = reduce(recordDroppedEvents(WS, 5));
      expect(next.byWorkspaceId[WS]!.deliveryStats.droppedEvents).toBe(5);
    });
  });

  describe("markAgentDeleted / evictDeletedAgent", () => {
    it("marks agent as deleted with timestamp", () => {
      const next = reduce(markAgentDeleted(WS, "a1", 1000));
      expect(next.byWorkspaceId[WS]?.deletedAgents["a1"]).toBe(1000);
    });

    it("evicts a deleted agent", () => {
      let state = reduce(markAgentDeleted(WS, "a1", 1000));
      state = reduce(evictDeletedAgent(WS, "a1"), state);
      expect(state.byWorkspaceId[WS]?.deletedAgents["a1"]).toBeUndefined();
    });

    it("evict returns same state if agent not in deleted set", () => {
      const state = reduce(markAgentDeleted(WS, "a1", 1000));
      const next = reduce(evictDeletedAgent(WS, "a2"), state);
      expect(next).toBe(state);
    });
  });

  describe("bumpVersion", () => {
    it("increments version by 1", () => {
      let state = reduce(bumpVersion(WS));
      expect(state.byWorkspaceId[WS]?.version).toBe(1);
      state = reduce(bumpVersion(WS), state);
      expect(state.byWorkspaceId[WS]?.version).toBe(2);
    });
  });

  describe("clearWorkspace", () => {
    it("removes workspace state entirely", () => {
      let state = reduce(addSubscription(WS, makeSub()));
      state = reduce(clearWorkspace(WS), state);
      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });
  });

  describe("multi-round oneShot lifecycle (reducer integration)", () => {
    const COORDINATOR = "agent-coordinator";
    const AGENT_B = "agent-implementor";
    const AGENT_C = "agent-verifier";

    it("second oneShot subscription is visible after first is fired and removed", () => {
      // Step 1: Create sub-1 (oneShot, coordinator watching agent-B)
      const sub1 = makeSub({
        id: "sub-1",
        agentId: COORDINATOR,
        filter: { eventTypes: ["agent:idle"], actorIds: [AGENT_B], oneShot: true },
      });
      let state = reduce(addSubscription(WS, sub1));
      expect(Object.keys(state.byWorkspaceId[WS]!.subscriptions)).toEqual(["sub-1"]);

      // Step 2: Fire sub-1 (markOneShotFired + removeSubscription)
      state = reduce(markOneShotFired(WS, "sub-1"), state);
      expect(state.byWorkspaceId[WS]!.firedOneShotSubscriptions).toContain("sub-1");
      state = reduce(removeSubscription(WS, "sub-1"), state);
      expect(state.byWorkspaceId[WS]!.subscriptions["sub-1"]).toBeUndefined();
      expect(state.byWorkspaceId[WS]!.firedOneShotSubscriptions).not.toContain("sub-1");

      // Step 3: Create sub-2 (oneShot, coordinator watching agent-C)
      const sub2 = makeSub({
        id: "sub-2",
        agentId: COORDINATOR,
        filter: { eventTypes: ["agent:idle"], actorIds: [AGENT_C], oneShot: true },
      });
      state = reduce(addSubscription(WS, sub2), state);

      // Step 4: Verify sub-2 is visible and not interfered with by sub-1's cleanup
      const ws = state.byWorkspaceId[WS]!;
      expect(Object.keys(ws.subscriptions)).toEqual(["sub-2"]);
      expect(ws.subscriptions["sub-2"]).toEqual(sub2);
      expect(ws.firedOneShotSubscriptions).not.toContain("sub-2");
      expect(ws.firedOneShotSubscriptions).toHaveLength(0);
    });

    it("enqueued events for coordinator survive across oneShot rounds", () => {
      // Step 1: Create sub-1 and enqueue event for coordinator
      const sub1 = makeSub({
        id: "sub-1",
        agentId: COORDINATOR,
        filter: { eventTypes: ["agent:idle"], actorIds: [AGENT_B], oneShot: true },
      });
      let state = reduce(addSubscription(WS, sub1));

      // Enqueue B's idle event for coordinator
      state = reduce(enqueueEvent(WS, COORDINATOR, makeQueuedEvent({
        event: { type: "agent:idle", timestamp: "t1", workspaceId: WS, actor: { type: "agent", id: AGENT_B } } as any,
      })), state);

      // Fire + remove sub-1
      state = reduce(markOneShotFired(WS, "sub-1"), state);
      state = reduce(removeSubscription(WS, "sub-1"), state);

      // Clear queue (simulating delivery)
      state = reduce(clearAgentQueue(WS, COORDINATOR), state);

      // Step 2: Create sub-2 and enqueue C's event
      const sub2 = makeSub({
        id: "sub-2",
        agentId: COORDINATOR,
        filter: { eventTypes: ["agent:idle"], actorIds: [AGENT_C], oneShot: true },
      });
      state = reduce(addSubscription(WS, sub2), state);

      state = reduce(enqueueEvent(WS, COORDINATOR, makeQueuedEvent({
        event: { type: "agent:idle", timestamp: "t2", workspaceId: WS, actor: { type: "agent", id: AGENT_C } } as any,
      })), state);

      // Verify C's event is in coordinator's queue
      const queue = state.byWorkspaceId[WS]!.agentQueues[COORDINATOR];
      expect(queue).toHaveLength(1);
      expect((queue![0].event as any).actor.id).toBe(AGENT_C);

      // Fire + remove sub-2
      state = reduce(markOneShotFired(WS, "sub-2"), state);
      state = reduce(removeSubscription(WS, "sub-2"), state);

      // Queue should still have C's event (delivery happens separately)
      const finalQueue = state.byWorkspaceId[WS]!.agentQueues[COORDINATOR];
      expect(finalQueue).toHaveLength(1);
    });
  });
});