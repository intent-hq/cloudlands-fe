/**
 * Tests for agent-subscription-ops.
 *
 * These tests verify that `agentSubscribeToGroup` is atomic across
 * concurrent callers for the same `(parentAgentId, groupId)` pair — even if
 * every caller observes the same "no existing subscription" snapshot before
 * any of them dispatches, exactly ONE subscription must be created, and all
 * subsequent calls must extend it rather than create duplicates.
 *
 * Regression for the 2026-04-20 "only 1/4 wakeups" bug where four concurrent
 * `ws.agent.delegate(...)` calls produced four distinct subscription IDs for
 * the same groupId.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { combineReducers, legacy_createStore as createStore, type Store } from "redux";
import {
  agentSubscriptionsReducer,
  markAgentDeleted,
} from "../../../../store/main/slices/agent-subscriptions/agent-subscriptions-slice";

let testStore: Store;

vi.mock("../../../../store/main/redux-store-bridge", () => ({
  mainDispatch: (action: any) => testStore.dispatch(action),
  getMainState: () => testStore.getState(),
  getMainStore: () => testStore,
  initMainStoreBridge: vi.fn(),
}));

// Side-effect module — just needs to exist for the import to resolve.
vi.mock("../../../agent/main/agent-process-registry", () => ({
  notifyPendingWorkClearedForAgent: vi.fn(),
}));

// Bypass uuid: deterministic ids make assertions straightforward.
let nextId = 0;
vi.mock("uuid", () => ({
  v4: () => `seed-${++nextId}`,
}));

import { agentSubscribeToGroup } from "../agent-subscription-ops";

const WS = "ws-test";
const PARENT_ID = "parent-1";
const PARENT_NAME = "Parent";
const GROUP_ID = "group-42";

describe("agentSubscribeToGroup", () => {
  beforeEach(() => {
    nextId = 0;
    testStore = createStore(combineReducers({ agentSubscriptions: agentSubscriptionsReducer }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the same subscriptionId for repeated same-group calls", () => {
    const id1 = agentSubscribeToGroup(WS, PARENT_ID, PARENT_NAME, GROUP_ID, "child-a");
    const id2 = agentSubscribeToGroup(WS, PARENT_ID, PARENT_NAME, GROUP_ID, "child-b");
    const id3 = agentSubscribeToGroup(WS, PARENT_ID, PARENT_NAME, GROUP_ID, "child-c");
    const id4 = agentSubscribeToGroup(WS, PARENT_ID, PARENT_NAME, GROUP_ID, "child-d");

    expect(id1).toBe("seed-1");
    expect(id2).toBe(id1);
    expect(id3).toBe(id1);
    expect(id4).toBe(id1);

    const ws = (testStore.getState() as any).agentSubscriptions.byWorkspaceId[WS];
    expect(Object.keys(ws.subscriptions)).toEqual(["seed-1"]);
    const sub = ws.subscriptions["seed-1"];
    expect(sub.filter.actorIds).toEqual(["child-a", "child-b", "child-c", "child-d"]);
    expect(sub.filter.delegationGroup.expectedAgentIds).toEqual([
      "child-a",
      "child-b",
      "child-c",
      "child-d",
    ]);
    const tracker = ws.delegationGroups[GROUP_ID];
    expect(tracker.subscriptionId).toBe("seed-1");
    expect(tracker.expectedAgentIds).toEqual(["child-a", "child-b", "child-c", "child-d"]);
  });

  it("creates separate subscriptions for different groups on the same parent", () => {
    const id1 = agentSubscribeToGroup(WS, PARENT_ID, PARENT_NAME, GROUP_ID, "child-a");
    const id2 = agentSubscribeToGroup(WS, PARENT_ID, PARENT_NAME, "other-group", "child-x");

    expect(id1).toBe("seed-1");
    expect(id2).toBe("seed-2");
    expect(id1).not.toBe(id2);

    const ws = (testStore.getState() as any).agentSubscriptions.byWorkspaceId[WS];
    expect(Object.keys(ws.subscriptions).sort()).toEqual(["seed-1", "seed-2"]);
  });

  it("creates separate subscriptions for the same group across different parents", () => {
    const id1 = agentSubscribeToGroup(WS, "parent-a", "Parent A", GROUP_ID, "child-a");
    const id2 = agentSubscribeToGroup(WS, "parent-b", "Parent B", GROUP_ID, "child-a");

    expect(id1).toBe("seed-1");
    expect(id2).toBe("seed-2");

    const ws = (testStore.getState() as any).agentSubscriptions.byWorkspaceId[WS];
    expect(Object.keys(ws.subscriptions).sort()).toEqual(["seed-1", "seed-2"]);
  });

  it("is idempotent when the same delegated agent is added twice", () => {
    const id1 = agentSubscribeToGroup(WS, PARENT_ID, PARENT_NAME, GROUP_ID, "child-a");
    const id2 = agentSubscribeToGroup(WS, PARENT_ID, PARENT_NAME, GROUP_ID, "child-a");

    expect(id1).toBe(id2);
    const ws = (testStore.getState() as any).agentSubscriptions.byWorkspaceId[WS];
    expect(ws.subscriptions["seed-1"].filter.actorIds).toEqual(["child-a"]);
    expect(ws.delegationGroups[GROUP_ID].expectedAgentIds).toEqual(["child-a"]);
  });

  it("returns '' and creates no subscription or tracker when the parent agent is deleted", () => {
    testStore.dispatch(markAgentDeleted(WS, PARENT_ID, Date.now()));

    const id = agentSubscribeToGroup(WS, PARENT_ID, PARENT_NAME, GROUP_ID, "child-a");

    expect(id).toBe("");
    const ws = (testStore.getState() as any).agentSubscriptions.byWorkspaceId[WS];
    expect(ws.subscriptions).toEqual({});
    expect(ws.delegationGroups).toEqual({});
  });
});
