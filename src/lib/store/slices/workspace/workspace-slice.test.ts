import type { Workspace, WorkspaceId } from "$shared/types";
import { beforeEach, describe, expect, it } from "vitest";
import { init } from "../../init";
import { openTerminalOverlay, toggleTerminalOverlay } from "../terminals/terminals-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import {
  clearPanelVisibility,
  defaultPanelVisibility,
  initialState,
  removeWorkspaceEntity,
  setActiveWorkspaceId,
  setPanelVisibility,
  setPanelVisibilityBulk,
  setWorkspaceEntity,
  updateWorkspaceEntity,
  workspaceReducer,
} from "./workspace-slice";
import {
  selectActiveWorkspace,
  selectActiveWorkspaceId,
  selectPanelVisibility,
  selectPanelVisibilityFlag,
  selectWorkspaceById,
} from "./workspace-selectors";

/** Minimal workspace fixture for testing. */
function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    title: "Test Workspace",
    branch: "main",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
    id: overrides.id as WorkspaceId,
  };
}

describe("workspaceReducer", () => {
  it("returns the initial state", () => {
    expect(workspaceReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores the active workspace id explicitly", () => {
    const next = workspaceReducer(initialState, setActiveWorkspaceId("ws-1"));
    expect(next.activeWorkspaceId).toBe("ws-1");
  });

  it("tracks the workspace opened in terminal overlay actions", () => {
    expect(workspaceReducer(initialState, openTerminalOverlay("ws-2")).activeWorkspaceId).toBe(
      "ws-2"
    );
    expect(workspaceReducer(initialState, toggleTerminalOverlay("ws-3")).activeWorkspaceId).toBe(
      "ws-3"
    );
  });

  // -----------------------------------------------------------------------
  // Panel Visibility
  // -----------------------------------------------------------------------

  describe("setPanelVisibility", () => {
    it("sets a single panel visibility flag", () => {
      const next = workspaceReducer(
        initialState,
        setPanelVisibility("ws-1", "showNavigationRail", false)
      );
      expect(next.panelVisibility.byWorkspaceId["ws-1"]).toEqual({
        ...defaultPanelVisibility,
        showNavigationRail: false,
      });
    });

    it("is a no-op when value matches default", () => {
      const next = workspaceReducer(
        initialState,
        setPanelVisibility("ws-1", "showNavigationRail", true)
      );
      // Should return same reference since value matches default
      expect(next).toBe(initialState);
    });

    it("is a no-op when value matches existing", () => {
      const withState = workspaceReducer(
        initialState,
        setPanelVisibility("ws-1", "showNavigationRail", false)
      );
      const again = workspaceReducer(
        withState,
        setPanelVisibility("ws-1", "showNavigationRail", false)
      );
      expect(again).toBe(withState);
    });
  });

  describe("setPanelVisibilityBulk", () => {
    it("sets multiple flags at once", () => {
      const next = workspaceReducer(
        initialState,
        setPanelVisibilityBulk("ws-1", {
          showNavigationRail: false,
          showMainContent: false,
          showWorkspaceDock: false,
        })
      );
      const vis = next.panelVisibility.byWorkspaceId["ws-1"];
      expect(vis.showNavigationRail).toBe(false);
      expect(vis.showMainContent).toBe(false);
      expect(vis.showWorkspaceDock).toBe(false);
      // other flags remain default
      expect(vis.showNotesPanel).toBe(true);
      expect(vis.showChatHeader).toBe(true);
    });

    it("is a no-op when all values match current state", () => {
      const next = workspaceReducer(
        initialState,
        setPanelVisibilityBulk("ws-1", { showNavigationRail: true, showMainContent: true })
      );
      expect(next).toBe(initialState);
    });
  });

  describe("clearPanelVisibility", () => {
    it("removes workspace panel visibility state", () => {
      const withState = workspaceReducer(
        initialState,
        setPanelVisibility("ws-1", "showNavigationRail", false)
      );
      expect(withState.panelVisibility.byWorkspaceId["ws-1"]).toBeDefined();

      const cleared = workspaceReducer(withState, clearPanelVisibility("ws-1"));
      expect(cleared.panelVisibility.byWorkspaceId["ws-1"]).toBeUndefined();
    });

    it("is a no-op when workspace has no state", () => {
      const cleared = workspaceReducer(initialState, clearPanelVisibility("ws-unknown"));
      expect(cleared).toBe(initialState);
    });
  });

  describe("workspaceUnmounted", () => {
    it("preserves panel visibility across workspace switches", () => {
      const withState = workspaceReducer(
        initialState,
        setPanelVisibility("ws-1", "showNavigationRail", false)
      );
      const afterUnmount = workspaceReducer(withState, workspaceUnmounted("ws-1"));
      expect(afterUnmount.panelVisibility.byWorkspaceId["ws-1"]).toEqual({
        ...defaultPanelVisibility,
        showNavigationRail: false,
      });
    });
  });

  describe("multi-workspace isolation", () => {
    it("stores independent visibility state per workspace", () => {
      let state = workspaceReducer(
        initialState,
        setPanelVisibility("ws-1", "showNavigationRail", false)
      );
      state = workspaceReducer(state, setPanelVisibility("ws-2", "showMainContent", false));

      expect(state.panelVisibility.byWorkspaceId["ws-1"]?.showNavigationRail).toBe(false);
      expect(state.panelVisibility.byWorkspaceId["ws-1"]?.showMainContent).toBe(true);
      expect(state.panelVisibility.byWorkspaceId["ws-2"]?.showNavigationRail).toBe(true);
      expect(state.panelVisibility.byWorkspaceId["ws-2"]?.showMainContent).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Regression: direct Redux panel visibility ownership
  // -----------------------------------------------------------------------

  describe("direct Redux ownership regression", () => {
    it("workspace switch cycle preserves both workspaces' visibility independently", () => {
      // Simulate: mount ws-A, set some flags, unmount ws-A, mount ws-B, set different flags
      let state = workspaceReducer(
        initialState,
        setPanelVisibilityBulk("ws-A", {
          showNavigationRail: false,
          showWorkspaceDock: false,
        })
      );
      // Unmount ws-A — visibility must survive
      state = workspaceReducer(state, workspaceUnmounted("ws-A"));

      // Mount ws-B and set different flags
      state = workspaceReducer(
        state,
        setPanelVisibilityBulk("ws-B", {
          showMainContent: false,
          showNotesPanel: false,
        })
      );

      // ws-A state is still intact
      expect(state.panelVisibility.byWorkspaceId["ws-A"]?.showNavigationRail).toBe(false);
      expect(state.panelVisibility.byWorkspaceId["ws-A"]?.showWorkspaceDock).toBe(false);
      expect(state.panelVisibility.byWorkspaceId["ws-A"]?.showMainContent).toBe(true);

      // ws-B state is independent
      expect(state.panelVisibility.byWorkspaceId["ws-B"]?.showMainContent).toBe(false);
      expect(state.panelVisibility.byWorkspaceId["ws-B"]?.showNotesPanel).toBe(false);
      expect(state.panelVisibility.byWorkspaceId["ws-B"]?.showNavigationRail).toBe(true);
    });

    it("brand-new workspace gets all-visible defaults without any manager", () => {
      // A workspace that has never had setPanelVisibility called should
      // return defaultPanelVisibility from the selector — no manager needed.
      const state = { workspace: initialState } as any;
      const vis = selectPanelVisibility.select(state, "ws-brand-new");
      expect(vis).toEqual(defaultPanelVisibility);

      // Every individual flag should also return its default
      for (const [key, defaultVal] of Object.entries(defaultPanelVisibility)) {
        expect(
          selectPanelVisibilityFlag.select(
            state,
            "ws-brand-new",
            key as keyof typeof defaultPanelVisibility
          )
        ).toBe(defaultVal);
      }
    });

    it("first-visit bulk hydration applies without a manager intermediary", () => {
      // Simulate what the saga does: setPanelVisibilityBulk with first-visit state
      const state = workspaceReducer(
        initialState,
        setPanelVisibilityBulk("ws-hydrated", {
          showNavigationRail: false,
          showMainContent: false,
          showChatHeader: false,
          isChatFocusedMode: true,
          showWorkspaceDock: false,
        })
      );

      const vis = state.panelVisibility.byWorkspaceId["ws-hydrated"];
      expect(vis.showNavigationRail).toBe(false);
      expect(vis.showMainContent).toBe(false);
      expect(vis.showChatHeader).toBe(false);
      expect(vis.isChatFocusedMode).toBe(true);
      expect(vis.showWorkspaceDock).toBe(false);
      // Flags not in the bulk update remain at defaults
      expect(vis.showNotesPanel).toBe(true);
      expect(vis.showFilesPanel).toBe(true);
      expect(vis.showCodeChangesPanel).toBe(true);
    });

    it("clearPanelVisibility resets to defaults on next read", () => {
      let state = workspaceReducer(
        initialState,
        setPanelVisibility("ws-clear", "showNavigationRail", false)
      );
      state = workspaceReducer(state, clearPanelVisibility("ws-clear"));

      // After clear, selector should return defaults
      const fullState = { workspace: state } as any;
      expect(selectPanelVisibility.select(fullState, "ws-clear")).toEqual(
        defaultPanelVisibility
      );
    });
  });

  // -----------------------------------------------------------------------
  // Workspace entity storage
  // -----------------------------------------------------------------------

  describe("setWorkspaceEntity", () => {
    it("stores a workspace entity by ID", () => {
      const ws = makeWorkspace({ id: "ws-1", title: "My Workspace" });
      const next = workspaceReducer(initialState, setWorkspaceEntity(ws));
      expect(next.byWorkspaceId["ws-1"]).toEqual(ws);
    });

    it("overwrites an existing workspace entity", () => {
      const ws1 = makeWorkspace({ id: "ws-1", title: "Original" });
      const ws1Updated = makeWorkspace({ id: "ws-1", title: "Updated" });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws1));
      state = workspaceReducer(state, setWorkspaceEntity(ws1Updated));
      expect(state.byWorkspaceId["ws-1"].title).toBe("Updated");
    });

    it("does not affect other workspace entities", () => {
      const ws1 = makeWorkspace({ id: "ws-1" });
      const ws2 = makeWorkspace({ id: "ws-2" });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws1));
      state = workspaceReducer(state, setWorkspaceEntity(ws2));
      expect(state.byWorkspaceId["ws-1"]).toEqual(ws1);
      expect(state.byWorkspaceId["ws-2"]).toEqual(ws2);
    });
  });

  describe("updateWorkspaceEntity", () => {
    it("merges partial changes into an existing workspace", () => {
      const ws = makeWorkspace({ id: "ws-1", title: "Original" });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(state, updateWorkspaceEntity("ws-1", { title: "Changed" }));
      expect(state.byWorkspaceId["ws-1"].title).toBe("Changed");
      expect(state.byWorkspaceId["ws-1"].branch).toBe("main"); // untouched
    });

    it("is a no-op when workspace does not exist", () => {
      const state = workspaceReducer(
        initialState,
        updateWorkspaceEntity("ws-missing", { title: "Nope" })
      );
      expect(state).toBe(initialState);
    });
  });

  describe("removeWorkspaceEntity", () => {
    it("removes a workspace entity by ID", () => {
      const ws = makeWorkspace({ id: "ws-1" });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(state, removeWorkspaceEntity("ws-1"));
      expect(state.byWorkspaceId["ws-1"]).toBeUndefined();
    });

    it("is a no-op when workspace does not exist", () => {
      const state = workspaceReducer(initialState, removeWorkspaceEntity("ws-missing"));
      expect(state).toBe(initialState);
    });

    it("does not affect other workspace entities", () => {
      const ws1 = makeWorkspace({ id: "ws-1" });
      const ws2 = makeWorkspace({ id: "ws-2" });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws1));
      state = workspaceReducer(state, setWorkspaceEntity(ws2));
      state = workspaceReducer(state, removeWorkspaceEntity("ws-1"));
      expect(state.byWorkspaceId["ws-1"]).toBeUndefined();
      expect(state.byWorkspaceId["ws-2"]).toEqual(ws2);
    });
  });

  // -----------------------------------------------------------------------
  // Regression: active-workspace Redux hydration
  // -----------------------------------------------------------------------

  describe("active-workspace hydration regression", () => {
    it("workspace switch cycle: Redux holds both entities and active pointer resolves to the new workspace", () => {
      const wsA = makeWorkspace({ id: "ws-A", title: "Workspace A" });
      const wsB = makeWorkspace({ id: "ws-B", title: "Workspace B" });

      // Simulate opening ws-A: hydrate entity + set active
      let state = workspaceReducer(initialState, setWorkspaceEntity(wsA));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-A"));

      expect(state.byWorkspaceId["ws-A"]).toEqual(wsA);
      expect(state.activeWorkspaceId).toBe("ws-A");

      // Simulate switching to ws-B: hydrate entity + set active
      state = workspaceReducer(state, setWorkspaceEntity(wsB));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-B"));

      // Active pointer moved to ws-B
      expect(state.activeWorkspaceId).toBe("ws-B");
      // ws-B entity is present
      expect(state.byWorkspaceId["ws-B"]).toEqual(wsB);
      // ws-A entity is still retained (not cleared on switch)
      expect(state.byWorkspaceId["ws-A"]).toEqual(wsA);
    });

    it("switching workspaces does not leave stale data as the active Redux value", () => {
      const wsA = makeWorkspace({ id: "ws-A", title: "Stale Workspace" });
      const wsB = makeWorkspace({ id: "ws-B", title: "Fresh Workspace" });

      // Open ws-A
      let state = workspaceReducer(initialState, setWorkspaceEntity(wsA));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-A"));

      // Switch to ws-B
      state = workspaceReducer(state, setWorkspaceEntity(wsB));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-B"));

      // selectActiveWorkspace must resolve to ws-B, not ws-A
      const fullState = { workspace: state } as any;
      const active = selectActiveWorkspace.select(fullState);
      expect(active).toEqual(wsB);
      expect(active?.title).toBe("Fresh Workspace");
    });

    it("updateWorkspaceEntity keeps the active workspace entity current after IPC update", () => {
      const ws = makeWorkspace({ id: "ws-1", title: "Original Title" });

      // Hydrate and activate
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-1"));

      // Simulate workspace:updated IPC → updateWorkspaceEntity
      state = workspaceReducer(state, updateWorkspaceEntity("ws-1", { title: "Updated Title" }));

      // Active workspace selector should reflect the update
      const fullState = { workspace: state } as any;
      const active = selectActiveWorkspace.select(fullState);
      expect(active?.title).toBe("Updated Title");
      // Other fields untouched
      expect(active?.branch).toBe("main");
    });

    it("setWorkspaceEntity re-hydration overwrites stale cached entity for the active workspace", () => {
      const wsOld = makeWorkspace({ id: "ws-1", title: "Cached" });
      const wsFresh = makeWorkspace({ id: "ws-1", title: "From Backend" });

      // Pre-populate from cache
      let state = workspaceReducer(initialState, setWorkspaceEntity(wsOld));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-1"));

      // Post-open confirmation overwrites with fresher data
      state = workspaceReducer(state, setWorkspaceEntity(wsFresh));

      const fullState = { workspace: state } as any;
      expect(selectActiveWorkspace.select(fullState)?.title).toBe("From Backend");
    });

    it("active workspace is undefined when entity has not been hydrated yet", () => {
      // Only activeWorkspaceId is set, but no entity stored
      const state = workspaceReducer(initialState, setActiveWorkspaceId("ws-1"));
      const fullState = { workspace: state } as any;
      expect(selectActiveWorkspace.select(fullState)).toBeUndefined();
      // selectWorkspaceById also returns undefined
      expect(selectWorkspaceById.select(fullState, "ws-1")).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe("workspace selectors", () => {
  const stateWith = (ws: Partial<typeof initialState>) => ({
    workspace: { ...initialState, ...ws },
  });

  it("selectActiveWorkspaceId returns the active workspace id", () => {
    expect(selectActiveWorkspaceId.select(stateWith({ activeWorkspaceId: "ws-1" }) as any)).toBe(
      "ws-1"
    );
  });

  // -----------------------------------------------------------------------
  // Workspace entity selectors
  // -----------------------------------------------------------------------

  it("selectWorkspaceById returns stored workspace", () => {
    const ws = makeWorkspace({ id: "ws-1", title: "Found" });
    const state = stateWith({ byWorkspaceId: { "ws-1": ws } });
    expect(selectWorkspaceById.select(state as any, "ws-1")).toEqual(ws);
  });

  it("selectWorkspaceById returns undefined for unknown id", () => {
    expect(selectWorkspaceById.select(stateWith({}) as any, "ws-missing")).toBeUndefined();
  });

  it("selectActiveWorkspace resolves active workspace from byWorkspaceId", () => {
    const ws = makeWorkspace({ id: "ws-1", title: "Active" });
    const state = stateWith({
      activeWorkspaceId: "ws-1",
      byWorkspaceId: { "ws-1": ws },
    });
    expect(selectActiveWorkspace.select(state as any)).toEqual(ws);
  });

  it("selectActiveWorkspace returns undefined when no active id", () => {
    expect(selectActiveWorkspace.select(stateWith({}) as any)).toBeUndefined();
  });

  it("selectActiveWorkspace returns undefined when active id not hydrated", () => {
    const state = stateWith({ activeWorkspaceId: "ws-1", byWorkspaceId: {} });
    expect(selectActiveWorkspace.select(state as any)).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Panel visibility selectors
  // -----------------------------------------------------------------------

  it("selectPanelVisibility returns defaults when no state exists", () => {
    expect(selectPanelVisibility.select(stateWith({}) as any, "ws-new")).toEqual(
      defaultPanelVisibility
    );
  });

  it("selectPanelVisibility returns stored state", () => {
    const vis = { ...defaultPanelVisibility, showNavigationRail: false };
    const state = stateWith({
      panelVisibility: { byWorkspaceId: { "ws-1": vis } },
    });
    expect(selectPanelVisibility.select(state as any, "ws-1")).toEqual(vis);
  });

  it("selectPanelVisibilityFlag returns a single flag", () => {
    const vis = { ...defaultPanelVisibility, showMainContent: false };
    const state = stateWith({
      panelVisibility: { byWorkspaceId: { "ws-1": vis } },
    });
    expect(selectPanelVisibilityFlag.select(state as any, "ws-1", "showMainContent")).toBe(false);
    expect(selectPanelVisibilityFlag.select(state as any, "ws-1", "showNotesPanel")).toBe(true);
  });

  it("selectPanelVisibilityFlag returns default for unknown workspace", () => {
    expect(
      selectPanelVisibilityFlag.select(stateWith({}) as any, "ws-unknown", "showMainContent")
    ).toBe(true);
  });
});

