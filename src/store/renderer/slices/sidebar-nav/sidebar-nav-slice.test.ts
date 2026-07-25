import {
  describe,
  expect,
  it,
} from "vitest";
import {
  hydrateSidebarNav,
  hydrateWorkspaceSidebarUi,
  initialState,
  openPanel,
  setMultiSelectSidebarSelectedTabs,
  setMultiSelectSidebarTabOrder,
  setStatsOverlayOpen,
  setWorkspaceCollapsedNoteIds,
  setWorkspaceNoteOrder,
  sidebarNavReducer,
  togglePanel,
  toggleStatsOverlay,
  toggleWorkspaceCollapsedNote,
} from "./sidebar-nav-slice";

describe("sidebarNavReducer Chief navigation", () => {
  it("opens the Chief sidebar panel", () => {
    const next = sidebarNavReducer(initialState, openPanel("chief"));

    expect(next.panelItem).toBe("chief");
    expect(next.hoveredItem).toBeNull();
    expect(next.expandedItem).toBeNull();
  });

  it("toggles the Chief sidebar panel with existing panel behavior", () => {
    const opened = sidebarNavReducer(initialState, togglePanel("chief"));
    const closed = sidebarNavReducer(opened, togglePanel("chief"));

    expect(opened.panelItem).toBe("chief");
    expect(closed.panelItem).toBeNull();
    expect(closed.isCardPinned).toBe(false);
  });
});

describe("sidebarNavReducer workspace sidebar UI persistence", () => {
  it("hydrates the persisted global multi-select tab order", () => {
    const next = sidebarNavReducer(
      initialState,
      hydrateSidebarNav({ multiSelectTabOrder: ["context", "overview"] })
    );

    expect(next.multiSelectTabOrder).toEqual(["context", "overview"]);
  });

  it("stores workspace-selected sidebar tabs by workspace", () => {
    const next = sidebarNavReducer(
      initialState,
      setMultiSelectSidebarSelectedTabs("ws-1", ["overview", "context"])
    );

    expect(next.multiSelectSelectedTabIdsByWorkspaceId).toEqual({
      "ws-1": ["overview", "context"],
    });
  });

  it("stores custom note order and collapsed note ids by workspace", () => {
    const withOrder = sidebarNavReducer(
      initialState,
      setWorkspaceNoteOrder("ws-1", ["spec", "note-1"])
    );
    const withCollapsed = sidebarNavReducer(
      withOrder,
      setWorkspaceCollapsedNoteIds("ws-1", ["note-1"])
    );

    expect(withCollapsed.noteOrderByWorkspaceId["ws-1"]).toEqual(["spec", "note-1"]);
    expect(withCollapsed.collapsedNoteIdsByWorkspaceId["ws-1"]).toEqual(["note-1"]);
  });

  it("toggles collapsed notes without using non-serializable Set state", () => {
    const collapsed = sidebarNavReducer(
      initialState,
      toggleWorkspaceCollapsedNote("ws-1", "note-1")
    );
    const expanded = sidebarNavReducer(
      collapsed,
      toggleWorkspaceCollapsedNote("ws-1", "note-1")
    );

    expect(collapsed.collapsedNoteIdsByWorkspaceId["ws-1"]).toEqual(["note-1"]);
    expect(expanded.collapsedNoteIdsByWorkspaceId["ws-1"]).toEqual([]);
  });

  it("hydrates workspace-specific sidebar UI without clobbering omitted fields", () => {
    const existing = {
      ...initialState,
      multiSelectSelectedTabIdsByWorkspaceId: { "ws-1": ["overview"] },
      noteOrderByWorkspaceId: { "ws-1": ["spec"] },
      collapsedNoteIdsByWorkspaceId: { "ws-1": ["note-1"] },
    };

    const next = sidebarNavReducer(
      existing,
      hydrateWorkspaceSidebarUi("ws-1", { noteOrder: ["spec", "note-2"] })
    );

    expect(next.multiSelectSelectedTabIdsByWorkspaceId["ws-1"]).toEqual(["overview"]);
    expect(next.noteOrderByWorkspaceId["ws-1"]).toEqual(["spec", "note-2"]);
    expect(next.collapsedNoteIdsByWorkspaceId["ws-1"]).toEqual(["note-1"]);
  });

  it("stores the global multi-select tab order", () => {
    const next = sidebarNavReducer(
      initialState,
      setMultiSelectSidebarTabOrder(["files", "changes", "context"])
    );

    expect(next.multiSelectTabOrder).toEqual(["files", "changes", "context"]);
  });
});

describe("sidebarNavReducer usage-stats overlay", () => {
  it("is closed by default", () => {
    expect(initialState.statsOverlayOpen).toBe(false);
  });

  it("opens and closes via setStatsOverlayOpen", () => {
    const opened = sidebarNavReducer(initialState, setStatsOverlayOpen(true));
    const closed = sidebarNavReducer(opened, setStatsOverlayOpen(false));

    expect(opened.statsOverlayOpen).toBe(true);
    expect(closed.statsOverlayOpen).toBe(false);
  });

  it("toggles via toggleStatsOverlay", () => {
    const opened = sidebarNavReducer(initialState, toggleStatsOverlay());
    const closed = sidebarNavReducer(opened, toggleStatsOverlay());

    expect(opened.statsOverlayOpen).toBe(true);
    expect(closed.statsOverlayOpen).toBe(false);
  });
});
