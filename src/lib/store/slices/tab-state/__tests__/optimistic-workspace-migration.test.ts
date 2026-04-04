/**
 * Regression tests for optimistic workspace tab temp→real ID migration
 * and timeout-based cleanup of stale optimistic tabs.
 *
 * These tests cover scenarios previously tested in optimistic-workspace-manager.test.ts:
 * 1. Temp→real ID migration across all tab state fields
 * 2. Cleanup of invalid optimistic tabs that never resolved
 * 3. Edge cases: multiple optimistic tabs, concurrent transitions
 */

import { describe, expect, it } from "vitest";
import {
  cleanupInvalidWorkspaceTabs,
  handleOptimisticWorkspaceTabTransition,
  markWorkspaceTabOptimistic,
  openWorkspaceTab,
  tabStateReducer,
  unmarkWorkspaceTabOptimistic,
  type TabState,
} from "../tab-state-slice";

const initialState: TabState = {
  isDragging: false,
  activeHandleDrop: null,
  scrollPositions: {},
  openTabs: {},
  currentTabId: null,
  pinnedTabs: {},
  unsavedTabs: {},
  optimisticTabs: {},
  tabOrder: [],
  version: 0,
};

const makeState = (overrides: Partial<TabState> = {}): TabState => ({
  ...initialState,
  ...overrides,
});

describe("optimistic workspace tab: temp→real ID migration", () => {
  it("migrates optimistic ID to real ID in openTabs, tabOrder, and currentTabId", () => {
    let state = makeState();
    state = tabStateReducer(state, openWorkspaceTab("temp-ws-1"));
    state = tabStateReducer(state, markWorkspaceTabOptimistic("temp-ws-1"));

    expect(state.openTabs["temp-ws-1"]).toBe(true);
    expect(state.optimisticTabs["temp-ws-1"]).toBe(true);
    expect(state.currentTabId).toBe("temp-ws-1");

    state = tabStateReducer(state, handleOptimisticWorkspaceTabTransition("temp-ws-1", "real-ws-1"));

    expect(state.openTabs["temp-ws-1"]).toBeUndefined();
    expect(state.openTabs["real-ws-1"]).toBe(true);
    expect(state.currentTabId).toBe("real-ws-1");
    expect(state.tabOrder).toContain("real-ws-1");
    expect(state.tabOrder).not.toContain("temp-ws-1");
    expect(state.optimisticTabs["temp-ws-1"]).toBeUndefined();
  });

  it("preserves other tabs during migration", () => {
    const state = makeState({
      openTabs: { "ws-existing": true, "temp-ws-1": true },
      currentTabId: "temp-ws-1",
      tabOrder: ["ws-existing", "temp-ws-1"],
      optimisticTabs: { "temp-ws-1": true },
      version: 5,
    });

    const migrated = tabStateReducer(
      state,
      handleOptimisticWorkspaceTabTransition("temp-ws-1", "real-ws-1")
    );

    expect(migrated.openTabs["ws-existing"]).toBe(true);
    expect(migrated.tabOrder).toEqual(["ws-existing", "real-ws-1"]);
  });

  it("handles migration when optimistic tab is not the current tab", () => {
    const state = makeState({
      openTabs: { "ws-1": true, "temp-ws-2": true },
      currentTabId: "ws-1",
      tabOrder: ["ws-1", "temp-ws-2"],
      optimisticTabs: { "temp-ws-2": true },
      version: 3,
    });

    const migrated = tabStateReducer(
      state,
      handleOptimisticWorkspaceTabTransition("temp-ws-2", "real-ws-2")
    );

    expect(migrated.currentTabId).toBe("ws-1");
    expect(migrated.openTabs["real-ws-2"]).toBe(true);
  });

  it("is a no-op when optimistic ID does not exist in any field", () => {
    const state = makeState({
      openTabs: { "ws-1": true },
      currentTabId: "ws-1",
      tabOrder: ["ws-1"],
      version: 2,
    });

    const result = tabStateReducer(
      state,
      handleOptimisticWorkspaceTabTransition("nonexistent", "real-ws")
    );

    expect(result).toBe(state);
  });

  it("migrates multiple optimistic tabs sequentially", () => {
    let state = makeState({
      openTabs: { "temp-1": true, "temp-2": true },
      currentTabId: "temp-1",
      tabOrder: ["temp-1", "temp-2"],
      optimisticTabs: { "temp-1": true, "temp-2": true },
      version: 1,
    });

    state = tabStateReducer(state, handleOptimisticWorkspaceTabTransition("temp-1", "real-1"));
    state = tabStateReducer(state, handleOptimisticWorkspaceTabTransition("temp-2", "real-2"));

    expect(state.openTabs).toEqual({ "real-1": true, "real-2": true });
    expect(state.tabOrder).toEqual(["real-1", "real-2"]);
    expect(state.optimisticTabs).toEqual({});
    expect(state.currentTabId).toBe("real-1");
  });
});

describe("optimistic workspace tab: timeout-based cleanup", () => {
  it("cleanupInvalidWorkspaceTabs preserves optimistic tabs even if not in valid IDs", () => {
    const state = makeState({
      openTabs: { "ws-valid": true, "ws-stale": true, "temp-optimistic": true },
      currentTabId: "ws-stale",
      tabOrder: ["ws-valid", "ws-stale", "temp-optimistic"],
      optimisticTabs: { "temp-optimistic": true },
      version: 10,
    });

    const cleaned = tabStateReducer(state, cleanupInvalidWorkspaceTabs(["ws-valid"]));

    expect(cleaned.openTabs["ws-valid"]).toBe(true);
    expect(cleaned.openTabs["temp-optimistic"]).toBe(true);
    expect(cleaned.openTabs["ws-stale"]).toBeUndefined();
    expect(cleaned.tabOrder).toEqual(["ws-valid", "temp-optimistic"]);
  });

  it("unmarkWorkspaceTabOptimistic then cleanup removes the stale tab", () => {
    let state = makeState({
      openTabs: { "temp-1": true },
      currentTabId: "temp-1",
      tabOrder: ["temp-1"],
      optimisticTabs: { "temp-1": true },
      version: 1,
    });

    state = tabStateReducer(state, unmarkWorkspaceTabOptimistic("temp-1"));
    expect(state.optimisticTabs["temp-1"]).toBeUndefined();

    state = tabStateReducer(state, cleanupInvalidWorkspaceTabs([]));

    expect(state.openTabs["temp-1"]).toBeUndefined();
    expect(state.tabOrder).toEqual([]);
    expect(state.currentTabId).toBeNull();
  });
});

