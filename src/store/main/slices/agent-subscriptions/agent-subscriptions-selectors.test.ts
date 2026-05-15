import {
  describe,
  expect,
  it,
} from "vitest";

import type { StoreState } from "$lib/store/types";
import type { MainStoreState } from "../../types";
import type {
  WorkspaceSubscriptionState,
  AgentSubscriptionRecord,
  DelegationGroupTrackerRecord,
  QueuedEventRecord,
  DeliveryStats,
} from "./types";
import { emptyWorkspaceSubscriptionState } from "./types";
import {
  selectWorkspaceSubscriptionState,
  selectSubscription,
  selectAgentSubscriptions,
  selectAllSubscriptions,
  selectAgentStatus,
  selectAgentQueue,
  selectAgentQueueLength,
  selectDelegationGroup,
  selectDelegationGroupsForParent,
  selectIsDelegationGroupComplete,
  selectIsOneShotFired,
  selectIsAgentDeleted,
  selectDeliveryStats,
} from "./agent-subscriptions-selectors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSub = (overrides: Partial<AgentSubscriptionRecord> = {}): AgentSubscriptionRecord => ({
  id: "sub-1",
  agentId: "agent-1",
  agentName: "Test Agent",
  workspaceId: "ws-1",
  filter: {},
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const makeGroup = (
  overrides: Partial<DelegationGroupTrackerRecord> = {},
): DelegationGroupTrackerRecord => ({
  groupId: "group-1",
  parentAgentId: "agent-parent",
  parentAgentName: "Parent",
  awaitMode: "all",
  expectedAgentIds: ["agent-a", "agent-b"],
  completedAgentIds: [],
  deletedAgentIds: [],
  events: [],
  subscriptionId: "sub-g1",
  ...overrides,
});

const makeQueuedEvent = (overrides: Partial<QueuedEventRecord> = {}): QueuedEventRecord => ({
  event: { id: "evt-1", type: "file:changed" as any, workspaceId: "ws-1", timestamp: "2026-01-01T00:00:00Z", actor: { type: "system" } } as any,
  queuedAt: "2026-01-01T00:00:00Z",
  priority: "normal",
  ...overrides,
});

const makeWsState = (overrides: Partial<WorkspaceSubscriptionState> = {}): WorkspaceSubscriptionState => ({
  ...emptyWorkspaceSubscriptionState,
  ...overrides,
});

const makeState = (wsId: string, wsState: WorkspaceSubscriptionState): MainStoreState =>
  ({
    agentSubscriptions: {
      byWorkspaceId: { [wsId]: wsState },
    },
  }) as unknown as MainStoreState;

const emptyState = () =>
  ({ agentSubscriptions: { byWorkspaceId: {} } }) as unknown as MainStoreState;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agent-subscriptions selectors", () => {
  // Type safety: RendererStoreState must not compile
  it("rejects RendererStoreState at compile time", () => {
    // @ts-expect-error renderer StoreState must not be accepted by main selectors
    const invalidCall = (rendererState: StoreState) =>
      selectAgentStatus.select(rendererState, "ws-1", "agent-1");
    void invalidCall;
  });

  describe("selectWorkspaceSubscriptionState", () => {
    it("returns emptyWorkspaceSubscriptionState for missing workspace", () => {
      expect(selectWorkspaceSubscriptionState.select(emptyState(), "ws-missing")).toBe(
        emptyWorkspaceSubscriptionState,
      );
    });

    it("returns existing workspace state", () => {
      const ws = makeWsState({ agentStatuses: { "a-1": "responding" } });
      const state = makeState("ws-1", ws);
      expect(selectWorkspaceSubscriptionState.select(state, "ws-1")).toBe(ws);
    });
  });

  describe("selectSubscription", () => {
    it("returns undefined for missing subscription", () => {
      expect(selectSubscription.select(emptyState(), "ws-1", "sub-missing")).toBeUndefined();
    });

    it("returns the subscription by id", () => {
      const sub = makeSub({ id: "sub-42" });
      const state = makeState("ws-1", makeWsState({ subscriptions: { "sub-42": sub } }));
      expect(selectSubscription.select(state, "ws-1", "sub-42")).toBe(sub);
    });
  });

  describe("selectAgentSubscriptions", () => {
    it("returns only subscriptions for the given agent", () => {
      const sub1 = makeSub({ id: "s1", agentId: "a-1" });
      const sub2 = makeSub({ id: "s2", agentId: "a-2" });
      const sub3 = makeSub({ id: "s3", agentId: "a-1" });
      const state = makeState("ws-1", makeWsState({
        subscriptions: { s1: sub1, s2: sub2, s3: sub3 },
      }));
      const result = selectAgentSubscriptions.select(state, "ws-1", "a-1");
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id).sort()).toEqual(["s1", "s3"]);
    });
  });

  describe("selectAllSubscriptions", () => {
    it("returns all subscriptions", () => {
      const sub1 = makeSub({ id: "s1" });
      const sub2 = makeSub({ id: "s2" });
      const state = makeState("ws-1", makeWsState({ subscriptions: { s1: sub1, s2: sub2 } }));
      expect(selectAllSubscriptions.select(state, "ws-1")).toHaveLength(2);
    });
  });

  describe("selectAgentStatus", () => {
    it("defaults to 'idle' for unknown agent", () => {
      expect(selectAgentStatus.select(emptyState(), "ws-1", "unknown-agent")).toBe("idle");
    });

    it("returns tracked status", () => {
      const state = makeState("ws-1", makeWsState({ agentStatuses: { "a-1": "responding" } }));
      expect(selectAgentStatus.select(state, "ws-1", "a-1")).toBe("responding");
    });
  });

  describe("selectAgentQueue / selectAgentQueueLength", () => {
    it("returns empty array for unknown agent", () => {
      expect(selectAgentQueue.select(emptyState(), "ws-1", "a-1")).toEqual([]);
      expect(selectAgentQueueLength.select(emptyState(), "ws-1", "a-1")).toBe(0);
    });

    it("returns queued events and correct length", () => {
      const q1 = makeQueuedEvent();
      const q2 = makeQueuedEvent({ priority: "high" });
      const state = makeState("ws-1", makeWsState({ agentQueues: { "a-1": [q1, q2] } }));
      expect(selectAgentQueue.select(state, "ws-1", "a-1")).toEqual([q1, q2]);
      expect(selectAgentQueueLength.select(state, "ws-1", "a-1")).toBe(2);
    });
  });

  describe("selectDelegationGroup", () => {
    it("returns undefined for unknown group", () => {
      expect(selectDelegationGroup.select(emptyState(), "ws-1", "g-missing")).toBeUndefined();
    });

    it("returns the group tracker", () => {
      const group = makeGroup({ groupId: "g-1" });
      const state = makeState("ws-1", makeWsState({ delegationGroups: { "g-1": group } }));
      expect(selectDelegationGroup.select(state, "ws-1", "g-1")).toBe(group);
    });
  });

  describe("selectDelegationGroupsForParent", () => {
    it("returns only groups for the given parent", () => {
      const g1 = makeGroup({ groupId: "g-1", parentAgentId: "parent-a" });
      const g2 = makeGroup({ groupId: "g-2", parentAgentId: "parent-b" });
      const g3 = makeGroup({ groupId: "g-3", parentAgentId: "parent-a" });
      const state = makeState("ws-1", makeWsState({
        delegationGroups: { "g-1": g1, "g-2": g2, "g-3": g3 },
      }));
      const result = selectDelegationGroupsForParent.select(state, "ws-1", "parent-a");
      expect(result).toHaveLength(2);
      expect(result.map((g) => g.groupId).sort()).toEqual(["g-1", "g-3"]);
    });
  });

  describe("selectIsDelegationGroupComplete", () => {
    it("returns false for unknown group", () => {
      expect(selectIsDelegationGroupComplete.select(emptyState(), "ws-1", "g-missing")).toBe(false);
    });

    it("returns false when not all agents completed", () => {
      const group = makeGroup({ expectedAgentIds: ["a", "b"], completedAgentIds: ["a"] });
      const state = makeState("ws-1", makeWsState({ delegationGroups: { [group.groupId]: group } }));
      expect(selectIsDelegationGroupComplete.select(state, "ws-1", group.groupId)).toBe(false);
    });

    it("returns true when all agents completed", () => {
      const group = makeGroup({ expectedAgentIds: ["a", "b"], completedAgentIds: ["a", "b"] });
      const state = makeState("ws-1", makeWsState({ delegationGroups: { [group.groupId]: group } }));
      expect(selectIsDelegationGroupComplete.select(state, "ws-1", group.groupId)).toBe(true);
    });

    it("returns true when awaitMode is 'any' and just one agent completed (Bug 6)", () => {
      // Bug 6: selectIsDelegationGroupComplete always checked all agents,
      // ignoring awaitMode: 'any'. Fix: return true when doneCount >= 1 for 'any'.
      const group = makeGroup({
        awaitMode: "any",
        expectedAgentIds: ["a", "b", "c"],
        completedAgentIds: ["a"],
      });
      const state = makeState("ws-1", makeWsState({ delegationGroups: { [group.groupId]: group } }));
      expect(selectIsDelegationGroupComplete.select(state, "ws-1", group.groupId)).toBe(true);
    });

    it("returns false when awaitMode is 'any' and no agents completed", () => {
      const group = makeGroup({
        awaitMode: "any",
        expectedAgentIds: ["a", "b"],
        completedAgentIds: [],
      });
      const state = makeState("ws-1", makeWsState({ delegationGroups: { [group.groupId]: group } }));
      expect(selectIsDelegationGroupComplete.select(state, "ws-1", group.groupId)).toBe(false);
    });

    it("returns true when awaitMode is 'any' and one agent deleted", () => {
      const group = makeGroup({
        awaitMode: "any",
        expectedAgentIds: ["a", "b"],
        completedAgentIds: [],
        deletedAgentIds: ["b"],
      });
      const state = makeState("ws-1", makeWsState({ delegationGroups: { [group.groupId]: group } }));
      expect(selectIsDelegationGroupComplete.select(state, "ws-1", group.groupId)).toBe(true);
    });
  });

  describe("selectIsOneShotFired", () => {
    it("returns false when not fired", () => {
      expect(selectIsOneShotFired.select(emptyState(), "ws-1", "sub-x")).toBe(false);
    });

    it("returns true when fired", () => {
      const state = makeState("ws-1", makeWsState({ firedOneShotSubscriptions: ["sub-x"] }));
      expect(selectIsOneShotFired.select(state, "ws-1", "sub-x")).toBe(true);
    });
  });

  describe("selectIsAgentDeleted", () => {
    it("returns false for non-deleted agent", () => {
      expect(selectIsAgentDeleted.select(emptyState(), "ws-1", "a-1")).toBe(false);
    });

    it("returns true for deleted agent", () => {
      const state = makeState("ws-1", makeWsState({ deletedAgents: { "a-1": Date.now() } }));
      expect(selectIsAgentDeleted.select(state, "ws-1", "a-1")).toBe(true);
    });
  });

  describe("selectDeliveryStats", () => {
    it("returns default stats for empty state", () => {
      const stats = selectDeliveryStats.select(emptyState(), "ws-1");
      expect(stats.totalDeliveries).toBe(0);
      expect(stats.lastDeliveryTime).toBeNull();
    });

    it("returns stored stats", () => {
      const customStats: DeliveryStats = {
        totalDeliveries: 10,
        successfulDeliveries: 8,
        failedDeliveries: 1,
        timeoutDeliveries: 1,
        droppedEvents: 0,
        lastDeliveryTime: "2026-01-01T12:00:00Z",
        lastFailureTime: "2026-01-01T11:00:00Z",
      };
      const state = makeState("ws-1", makeWsState({ deliveryStats: customStats }));
      expect(selectDeliveryStats.select(state, "ws-1")).toBe(customStats);
    });
  });

  describe("caching behavior", () => {
    it("returns the same reference for identical state and args", () => {
      const sub = makeSub({ id: "s1" });
      const state = makeState("ws-1", makeWsState({ subscriptions: { s1: sub } }));
      const r1 = selectAllSubscriptions.select(state, "ws-1");
      const r2 = selectAllSubscriptions.select(state, "ws-1");
      expect(r1).toBe(r2);
    });

    it("returns a new reference when state changes", () => {
      const sub1 = makeSub({ id: "s1" });
      const state1 = makeState("ws-1", makeWsState({ subscriptions: { s1: sub1 } }));
      const r1 = selectAllSubscriptions.select(state1, "ws-1");

      const sub2 = makeSub({ id: "s2" });
      const state2 = makeState("ws-1", makeWsState({ subscriptions: { s1: sub1, s2: sub2 } }));
      const r2 = selectAllSubscriptions.select(state2, "ws-1");
      expect(r2).not.toBe(r1);
      expect(r2).toHaveLength(2);
    });
  });
});

