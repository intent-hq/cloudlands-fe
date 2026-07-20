import {
  describe,
  expect,
  it,
} from "vitest";
import { createCollection } from "$lib/store-shim/utils/collections/collection-utils";
import { resetWorkspaceState } from "../workspace/workspace-slice";
import {
  closeSwitcher,
  confirmSelection,
  cycleNext,
  cyclePrevious,
  defaultWorkspaceSwitcherState,
  initialState,
  openSwitcher,
  workspaceSwitcherReducer,
} from "./workspace-switcher-slice";
import {
  selectSelectedWorkspaceId,
  selectSwitcherState,
  selectSwitcherWorkspaceIds,
} from "./workspace-switcher-selectors";

describe("workspaceSwitcherReducer", () => {
  it("returns the initial state", () => {
    expect(workspaceSwitcherReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("opens the switcher with current workspace first and the next workspace selected", () => {
    const next = workspaceSwitcherReducer(initialState, openSwitcher(["ws-2", "ws-3", "ws-1"], "ws-2"));

    expect(next).toEqual({
      selectedIndex: 1,
      selectionHandled: false,
    });
  });

  it("opens the switcher at index 0 when the current workspace is not the first item", () => {
    const next = workspaceSwitcherReducer(initialState, openSwitcher(["ws-3", "ws-1"], "ws-2"));

    expect(next.selectedIndex).toBe(0);
  });

  it("cycles forward and backward through switcher items", () => {
    let state = workspaceSwitcherReducer(initialState, openSwitcher(["ws-1", "ws-2", "ws-3"], "ws-1"));
    state = workspaceSwitcherReducer(state, cycleNext(3));
    expect(state.selectedIndex).toBe(2);

    state = workspaceSwitcherReducer(state, cyclePrevious(3));
    expect(state.selectedIndex).toBe(1);
  });

  it("confirms selection by closing and marking the selection as handled", () => {
    const openState = workspaceSwitcherReducer(
      initialState,
      openSwitcher(["ws-1", "ws-2", "ws-3"], "ws-1")
    );
    const next = workspaceSwitcherReducer(openState, confirmSelection());

    expect(next).toEqual({
      ...defaultWorkspaceSwitcherState,
      selectionHandled: true,
    });
  });

  it("closes the switcher and resets to the default state", () => {
    const openState = workspaceSwitcherReducer(
      initialState,
      openSwitcher(["ws-1", "ws-2", "ws-3"], "ws-1")
    );
    const next = workspaceSwitcherReducer(openState, closeSwitcher());

    expect(next).toEqual({
      ...defaultWorkspaceSwitcherState,
      selectionHandled: true,
    });
  });

  it("is a no-op for switcher actions when the switcher is not open", () => {
    let state = workspaceSwitcherReducer(initialState, cycleNext(3));
    expect(state).toBe(initialState);

    state = workspaceSwitcherReducer(initialState, cyclePrevious(3));
    expect(state).toBe(initialState);

    state = workspaceSwitcherReducer(initialState, confirmSelection());
    expect(state).toBe(initialState);
  });

  it("resets to defaults when workspace state is reset", () => {
    const openState = workspaceSwitcherReducer(
      initialState,
      openSwitcher(["ws-1", "ws-2", "ws-3"], "ws-1")
    );

    expect(workspaceSwitcherReducer(openState, resetWorkspaceState())).toEqual(initialState);
  });
});

describe("workspace switcher selectors", () => {
  const stateWith = (
    switcher: Partial<typeof initialState>,
    workspaceItems: Array<{ id: string; status?: string }>,
    activeWorkspaceId: string | null = null,
  ) => ({
    workspace: {
      activeWorkspaceId,
      recency: {
        lastViewedAt: { "ws-2": 20, "ws-1": 10, "ws-3": 5 },
      },
      workspaces: createCollection(
        "id",
        workspaceItems.map((workspace) => ({
          title: workspace.id,
          path: `/tmp/${workspace.id}`,
          branch: "main",
          changesets: [],
          timeline: [],
          conversationInfo: [],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          status: "active",
          ...workspace,
        })),
      ),
    },
    workspaceSwitcher: { ...initialState, ...switcher },
  });

  it("exposes switcher selectors from workspaceSwitcher state", () => {
    const switcher = {
      ...defaultWorkspaceSwitcherState,
      selectedIndex: 1,
      selectionHandled: false,
    };
    const state = stateWith(switcher, [{ id: "ws-1" }, { id: "ws-2" }, { id: "ws-3" }], "ws-1");

    expect(selectSwitcherState.select(state as any)).toEqual(switcher);
    expect(selectSwitcherWorkspaceIds.select(state as any)).toEqual(["ws-1", "ws-2", "ws-3"]);
    expect(selectSelectedWorkspaceId.select(state as any)).toBe("ws-2");
  });

  it("selectSelectedWorkspaceId returns null when the selected index is out of range", () => {
    const state = stateWith({
      selectedIndex: 3,
      selectionHandled: false,
    }, [{ id: "ws-1" }, { id: "ws-2" }], "ws-1");

    expect(selectSelectedWorkspaceId.select(state as any)).toBeNull();
  });

  it("selectSwitcherWorkspaceIds returns an empty list when the switcher is closed", () => {
    const state = stateWith(
      {
        selectionHandled: true,
      },
      [{ id: "ws-1" }, { id: "ws-2" }],
      "ws-1",
    );

    expect(selectSwitcherWorkspaceIds.select(state as any)).toEqual([]);
  });
});