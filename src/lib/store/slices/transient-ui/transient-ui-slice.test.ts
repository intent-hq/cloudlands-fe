import { describe, expect, it } from "vitest";
import type { StoreState } from "../../types";
import {
  initialState,
  setChatDraft,
  setSidebarActiveTab,
  transientUiReducer,
} from "./transient-ui-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import { selectSidebarActiveTab } from "./transient-ui-selectors";

const WS_1 = "ws-1";
const WS_2 = "ws-2";

function mockState(overrides: Partial<StoreState["transientUi"]> = {}): StoreState {
  return {
    transientUi: {
      ...initialState,
      ...overrides,
    },
  } as StoreState;
}

describe("transientUiReducer", () => {
  it("returns the initial state", () => {
    expect(transientUiReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores workspace-scoped values independently", () => {
    let state = transientUiReducer(initialState, setSidebarActiveTab(WS_1, "notes"));
    state = transientUiReducer(state, setSidebarActiveTab(WS_2, "agents"));

    expect(state.byWorkspaceId[WS_1].sidebarActiveTab).toBe("notes");
    expect(state.byWorkspaceId[WS_2].sidebarActiveTab).toBe("agents");
  });

  it("removes chat drafts when set to an empty string", () => {
    let state = transientUiReducer(initialState, setChatDraft(WS_1, "agent-1", "draft"));
    state = transientUiReducer(state, setChatDraft(WS_1, "agent-1", ""));

    expect(state.byWorkspaceId[WS_1].chatDrafts).toEqual({});
  });

  it("clears workspace state on workspaceUnmounted", () => {
    let state = transientUiReducer(initialState, setSidebarActiveTab(WS_1, "files"));
    state = transientUiReducer(state, setSidebarActiveTab(WS_2, "agents"));

    const nextState = transientUiReducer(state, workspaceUnmounted(WS_1));

    expect(nextState.byWorkspaceId[WS_1]).toBeUndefined();
    expect(nextState.byWorkspaceId[WS_2].sidebarActiveTab).toBe("agents");
  });
});

describe("transientUi selectors", () => {
  it("returns the default sidebar tab for missing workspaces", () => {
    const state = mockState();

    expect(selectSidebarActiveTab.select(state, WS_1)).toBe("notes");
  });
});