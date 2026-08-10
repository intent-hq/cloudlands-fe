/**
 * prMonitor slice reducer tests (PROTOCOL §6.9 monitored-PRs state).
 */
import { describe, expect, it } from "vitest";
import { getItems, getRefsCount } from "@augmentcode/themis/utils/collections/collection-utils";
import { removeWorkspaceEntity } from "../workspace/workspace-slice";
import type { PrMonitorRow } from "$features/pr-monitor/pr-monitor-service";
import type { StoreState } from "../../types";
import {
  initialState,
  prMonitorReducer,
  prMonitorsCleared,
  prMonitorsSubscribeRequested,
  prMonitorsUnsubscribeRequested,
  prMonitorsUpdated,
} from "./pr-monitor-slice";
import { selectPrMonitorSubscriptionDemand } from "./pr-monitor-selectors";

function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
  return {
    monitorId: "mon-1",
    workspaceId: "ws-1",
    agentId: "agent-1",
    repo: "acme/widgets",
    prNumber: 42,
    state: "active",
    pendingChanges: [],
    hasPendingChanges: false,
    createdAt: "2026-08-07T10:00:00Z",
    updatedAt: "2026-08-07T10:05:00Z",
    ...overrides,
  };
}

describe("prMonitorReducer", () => {
  it("starts with no workspaces", () => {
    const state = prMonitorReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
    expect(state).not.toHaveProperty("subscriptionDemandByWorkspaceId");
  });

  it("stores duplicate subscription leases only in the workspace monitor collection", () => {
    let state = prMonitorReducer(initialState, prMonitorsSubscribeRequested("ws-1"));
    state = prMonitorReducer(state, prMonitorsSubscribeRequested("ws-1"));
    state = prMonitorReducer(state, prMonitorsUnsubscribeRequested("ws-1"));

    const monitors = state.byWorkspaceId["ws-1"].monitors;
    expect(getRefsCount(monitors, "ws-1")).toBe(1);
    expect(getItems(monitors)).toEqual([]);
    expect(monitors.map["ws-1"]).toBeUndefined();
    expect(state).not.toHaveProperty("subscriptionDemandByWorkspaceId");

    state = prMonitorReducer(state, prMonitorsUnsubscribeRequested("ws-1"));
    expect(getRefsCount(state.byWorkspaceId["ws-1"].monitors, "ws-1")).toBe(0);
    expect(selectPrMonitorSubscriptionDemand.select({ prMonitor: state } as StoreState)).toEqual(
      {},
    );
    expect(() => structuredClone(state)).not.toThrow();
  });

  it("keeps reducer identity for invalid and excess subscription releases", () => {
    expect(prMonitorReducer(initialState, prMonitorsSubscribeRequested(""))).toBe(initialState);
    expect(prMonitorReducer(initialState, prMonitorsUnsubscribeRequested(""))).toBe(initialState);
    expect(prMonitorReducer(initialState, prMonitorsUnsubscribeRequested("ws-1"))).toBe(
      initialState,
    );
  });

  it("derives positive demand only from collection refs and preserves it across row updates", () => {
    let state = prMonitorReducer(initialState, prMonitorsSubscribeRequested("ws-1"));
    state = prMonitorReducer(state, prMonitorsSubscribeRequested("ws-1"));
    state = prMonitorReducer(
      state,
      prMonitorsUpdated("ws-1", [makeMonitor(), makeMonitor({ monitorId: "mon-2" })]),
    );
    state = prMonitorReducer(
      state,
      prMonitorsUpdated("ws-1", [
        makeMonitor({ monitorId: "mon-2", state: "completed" }),
        makeMonitor({ monitorId: "mon-3" }),
      ]),
    );

    const monitors = state.byWorkspaceId["ws-1"].monitors;
    expect(getItems(monitors).map(({ monitorId }) => monitorId)).toEqual(["mon-2", "mon-3"]);
    expect(getRefsCount(monitors, "ws-1")).toBe(2);
    expect(selectPrMonitorSubscriptionDemand.select({ prMonitor: state } as StoreState)).toEqual({
      "ws-1": 2,
    });
  });

  it("prMonitorsUpdated stores the list as a Collection keyed by monitorId", () => {
    const monitors = [makeMonitor(), makeMonitor({ monitorId: "mon-2", state: "completed" })];
    const state = prMonitorReducer(initialState, prMonitorsUpdated("ws-1", monitors));

    const ws = state.byWorkspaceId["ws-1"];
    expect(ws).toBeDefined();
    expect(getItems(ws.monitors)).toEqual(monitors);
    expect(ws.monitors.map["mon-2"].state).toBe("completed");
  });

  it("prMonitorsUpdated stores lastSnapshot from the prMonitor.list wire shape (§6.9)", () => {
    const lastSnapshot = {
      state: "open",
      isDraft: false,
      hasConflicts: false,
      isBehind: false,
      checks: {
        total: 4,
        passed: 3,
        failed: 0,
        pending: 1,
        failingRequired: 0,
        pendingRequired: 1,
        requiredKnown: true,
      },
      approvals: { decision: "REVIEW_REQUIRED", have: 0, changesRequested: 0 },
      threads: { unresolved: 2 },
      rulesKnown: true,
    };
    const state = prMonitorReducer(
      initialState,
      prMonitorsUpdated("ws-1", [
        makeMonitor({
          lastSnapshot,
          title: "Fix widget",
          url: "https://github.com/acme/widgets/pull/42",
        }),
      ]),
    );
    const row = state.byWorkspaceId["ws-1"].monitors.map["mon-1"];
    expect(row.lastSnapshot).toEqual(lastSnapshot);
    expect(row.title).toBe("Fix widget");
  });

  it("prMonitorsUpdated replaces the previous list for the same workspace", () => {
    let state = prMonitorReducer(
      initialState,
      prMonitorsUpdated("ws-1", [makeMonitor(), makeMonitor({ monitorId: "mon-2" })]),
    );
    state = prMonitorReducer(
      state,
      prMonitorsUpdated("ws-1", [makeMonitor({ monitorId: "mon-2", state: "completed" })]),
    );

    expect(getItems(state.byWorkspaceId["ws-1"].monitors)).toEqual([
      makeMonitor({ monitorId: "mon-2", state: "completed" }),
    ]);
  });

  it("keeps workspaces isolated", () => {
    let state = prMonitorReducer(initialState, prMonitorsUpdated("ws-1", [makeMonitor()]));
    state = prMonitorReducer(
      state,
      prMonitorsUpdated("ws-2", [makeMonitor({ monitorId: "mon-9", workspaceId: "ws-2" })]),
    );

    expect(getItems(state.byWorkspaceId["ws-1"].monitors)).toHaveLength(1);
    expect(getItems(state.byWorkspaceId["ws-2"].monitors)[0].monitorId).toBe("mon-9");
  });

  it("prMonitorsCleared drops only the addressed workspace", () => {
    let state = prMonitorReducer(initialState, prMonitorsUpdated("ws-1", [makeMonitor()]));
    state = prMonitorReducer(
      state,
      prMonitorsUpdated("ws-2", [makeMonitor({ monitorId: "mon-9", workspaceId: "ws-2" })]),
    );
    state = prMonitorReducer(state, prMonitorsCleared("ws-1"));

    expect(state.byWorkspaceId["ws-1"]).toBeUndefined();
    expect(state.byWorkspaceId["ws-2"]).toBeDefined();
  });

  it("prMonitorsCleared preserves a current collection-held lease while clearing rows", () => {
    let state = prMonitorReducer(initialState, prMonitorsSubscribeRequested("ws-1"));
    state = prMonitorReducer(state, prMonitorsUpdated("ws-1", [makeMonitor()]));
    state = prMonitorReducer(state, prMonitorsCleared("ws-1"));

    const monitors = state.byWorkspaceId["ws-1"].monitors;
    expect(getItems(monitors)).toEqual([]);
    expect(getRefsCount(monitors, "ws-1")).toBe(1);
  });

  it("prMonitorsCleared on an unknown workspace is a no-op", () => {
    const state = prMonitorReducer(initialState, prMonitorsCleared("ws-x"));
    expect(state).toBe(initialState);
  });

  it("removeWorkspaceEntity clears the workspace's monitors", () => {
    let state = prMonitorReducer(initialState, prMonitorsSubscribeRequested("ws-1"));
    state = prMonitorReducer(state, prMonitorsUpdated("ws-1", [makeMonitor()]));
    state = prMonitorReducer(state, removeWorkspaceEntity("ws-1"));
    expect(state.byWorkspaceId["ws-1"]).toBeUndefined();
    expect(state).not.toHaveProperty("subscriptionDemandByWorkspaceId");
  });
});
