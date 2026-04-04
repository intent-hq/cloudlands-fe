import { describe, expect, it } from "vitest";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import { selectPanelVisibilityFlag } from "./ui-layout-selectors";
import {
  DEFAULT_DOCK_HEIGHT,
  DEFAULT_WIDTH,
  MAX_DOCK_HEIGHT,
  MAX_WIDTH,
  MIN_DOCK_HEIGHT,
  MIN_WIDTH,
  collapseBottomDock,
  defaultBottomDockState,
  defaultPanelVisibility,
  expandBottomDock,
  loadBottomDockState,
  loadEditorSettings,
  loadSidebarState,
  selectBottomDockTerminal,
  setBottomDockHeight,
  setBottomDockViewMode,
  setPanelVisibility,
  setPanelVisibilityBulk,
  setCollapsed,
  setDiffIndicators,
  setDiffSideBySide,
  setFoldUnchanged,
  setLineWrapping,
  setWidth,
  showBottomDockAgents,
  toggleBottomDock,
  toggleDiffIndicators,
  toggleDiffSideBySide,
  toggleFoldUnchanged,
  toggleLineWrapping,
  toggleSidebar,
  setSpacesSidebarWidth,
  setSpacesSidebarCollapsed,
  toggleSpacesSidebarCollapsed,
  setTabbedSidebarPinned,
  toggleTabbedSidebarPinned,
  setSidebarSide,
  toggleSidebarSide,
  loadLayoutSettings,
  resetLayoutSettings,
  uiLayoutReducer,
  type UiLayoutState,
} from "./ui-layout-slice";

describe("uiLayoutReducer", () => {
  const initialState: UiLayoutState = {
    lineWrapping: true,
    foldUnchanged: true,
    diffSideBySide: true,
    diffIndicators: true,
    sidebarWidth: DEFAULT_WIDTH,
    sidebarWidthBeforeCollapse: DEFAULT_WIDTH,
    sidebarCollapsed: false,
    panelVisibility: {
      byWorkspaceId: {},
    },
    spacesSidebarWidth: 200,
    spacesSidebarCollapsed: false,
    tabbedSidebarPinned: true,
    sidebarSide: 'left',
    bottomDock: { ...defaultBottomDockState },
  };

  it("should return initial state", () => {
    const state = uiLayoutReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("editor settings", () => {
    it("should set lineWrapping", () => {
      expect(uiLayoutReducer(initialState, setLineWrapping(false)).lineWrapping).toBe(false);
    });

    it("should set foldUnchanged", () => {
      expect(uiLayoutReducer(initialState, setFoldUnchanged(false)).foldUnchanged).toBe(false);
    });

    it("should set diffSideBySide", () => {
      expect(uiLayoutReducer(initialState, setDiffSideBySide(false)).diffSideBySide).toBe(false);
    });

    it("should set diffIndicators", () => {
      expect(uiLayoutReducer(initialState, setDiffIndicators(false)).diffIndicators).toBe(false);
    });

    it("should toggle editor booleans off", () => {
      expect(uiLayoutReducer(initialState, toggleLineWrapping()).lineWrapping).toBe(false);
      expect(uiLayoutReducer(initialState, toggleFoldUnchanged()).foldUnchanged).toBe(false);
      expect(uiLayoutReducer(initialState, toggleDiffSideBySide()).diffSideBySide).toBe(false);
      expect(uiLayoutReducer(initialState, toggleDiffIndicators()).diffIndicators).toBe(false);
    });

    it("should toggle editor booleans on", () => {
      const disabledState: UiLayoutState = {
        ...initialState,
        lineWrapping: false,
        foldUnchanged: false,
        diffSideBySide: false,
        diffIndicators: false,
      };

      expect(uiLayoutReducer(disabledState, toggleLineWrapping()).lineWrapping).toBe(true);
      expect(uiLayoutReducer(disabledState, toggleFoldUnchanged()).foldUnchanged).toBe(true);
      expect(uiLayoutReducer(disabledState, toggleDiffSideBySide()).diffSideBySide).toBe(true);
      expect(uiLayoutReducer(disabledState, toggleDiffIndicators()).diffIndicators).toBe(true);
    });

    it("should load editor settings", () => {
      const state = uiLayoutReducer(
        initialState,
        loadEditorSettings({
          lineWrapping: false,
          foldUnchanged: false,
          diffSideBySide: false,
          diffIndicators: false,
        })
      );

      expect(state.lineWrapping).toBe(false);
      expect(state.foldUnchanged).toBe(false);
      expect(state.diffSideBySide).toBe(false);
      expect(state.diffIndicators).toBe(false);
      expect(state.sidebarWidth).toBe(DEFAULT_WIDTH);
    });

    it("should merge loaded editor settings without touching sidebar state", () => {
      const state = uiLayoutReducer(
        { ...initialState, sidebarWidth: 420, sidebarWidthBeforeCollapse: 420 },
        loadEditorSettings({
          lineWrapping: false,
          foldUnchanged: true,
          diffSideBySide: false,
          diffIndicators: true,
        })
      );

      expect(state.lineWrapping).toBe(false);
      expect(state.foldUnchanged).toBe(true);
      expect(state.diffSideBySide).toBe(false);
      expect(state.diffIndicators).toBe(true);
      expect(state.sidebarWidth).toBe(420);
      expect(state.sidebarWidthBeforeCollapse).toBe(420);
    });
  });

  describe("sidebar layout", () => {
    it("should set width clamped to min/max", () => {
      expect(uiLayoutReducer(initialState, setWidth(400)).sidebarWidth).toBe(400);
      expect(uiLayoutReducer(initialState, setWidth(50)).sidebarWidth).toBe(MIN_WIDTH);
      expect(uiLayoutReducer(initialState, setWidth(1200)).sidebarWidth).toBe(MAX_WIDTH);
      expect(uiLayoutReducer(initialState, setWidth(350.7)).sidebarWidth).toBe(351);
    });

    it("should not update sidebarWidthBeforeCollapse while collapsed", () => {
      const collapsedState: UiLayoutState = {
        ...initialState,
        sidebarWidth: 300,
        sidebarWidthBeforeCollapse: 300,
        sidebarCollapsed: true,
      };

      const state = uiLayoutReducer(collapsedState, setWidth(400));
      expect(state.sidebarWidth).toBe(400);
      expect(state.sidebarWidthBeforeCollapse).toBe(300);
    });

    it("should toggle sidebar collapsed state", () => {
      const collapsed = uiLayoutReducer(initialState, toggleSidebar());
      expect(collapsed.sidebarCollapsed).toBe(true);
      expect(collapsed.sidebarWidthBeforeCollapse).toBe(DEFAULT_WIDTH);

      const expanded = uiLayoutReducer({ ...collapsed, sidebarWidth: 300 }, toggleSidebar());
      expect(expanded.sidebarCollapsed).toBe(false);
    });

    it("should set sidebar collapsed state", () => {
      const collapsed = uiLayoutReducer(initialState, setCollapsed(true));
      expect(collapsed.sidebarCollapsed).toBe(true);
      expect(collapsed.sidebarWidthBeforeCollapse).toBe(DEFAULT_WIDTH);

      const expanded = uiLayoutReducer(
        { ...collapsed, sidebarWidth: 300, sidebarWidthBeforeCollapse: 300 },
        setCollapsed(false)
      );
      expect(expanded.sidebarCollapsed).toBe(false);
    });

    it("should return same state when setCollapsed matches current state", () => {
      expect(uiLayoutReducer(initialState, setCollapsed(false))).toBe(initialState);
    });

    it("should load sidebar state", () => {
      const state = uiLayoutReducer(initialState, loadSidebarState(500, true));
      expect(state.sidebarWidth).toBe(500);
      expect(state.sidebarWidthBeforeCollapse).toBe(500);
      expect(state.sidebarCollapsed).toBe(true);
    });
  });

  describe("panel visibility", () => {
    it("sets a single panel visibility flag", () => {
      const next = uiLayoutReducer(initialState, setPanelVisibility("ws-1", "showNavigationRail", false));
      expect(next.panelVisibility.byWorkspaceId["ws-1"]).toEqual({
        ...defaultPanelVisibility,
        showNavigationRail: false,
      });
    });

    it("is a no-op when a single value matches the default", () => {
      expect(uiLayoutReducer(initialState, setPanelVisibility("ws-1", "showNavigationRail", true))).toBe(
        initialState,
      );
    });

    it("sets multiple flags at once", () => {
      const next = uiLayoutReducer(
        initialState,
        setPanelVisibilityBulk("ws-1", {
          showNavigationRail: false,
          showMainContent: false,
          showWorkspaceDock: false,
        }),
      );

      expect(next.panelVisibility.byWorkspaceId["ws-1"]).toEqual({
        ...defaultPanelVisibility,
        showNavigationRail: false,
        showMainContent: false,
        showWorkspaceDock: false,
      });
    });

    it("cleans up visibility on workspace unmount", () => {
      const withState = uiLayoutReducer(
        initialState,
        setPanelVisibility("ws-1", "showNavigationRail", false),
      );

      const unmounted = uiLayoutReducer(withState, workspaceUnmounted("ws-1"));
      expect(unmounted.panelVisibility.byWorkspaceId["ws-1"]).toBeUndefined();
    });

    it("keeps visibility isolated per workspace", () => {
      let state = uiLayoutReducer(initialState, setPanelVisibility("ws-1", "showNavigationRail", false));
      state = uiLayoutReducer(state, setPanelVisibility("ws-2", "showMainContent", false));

      expect(state.panelVisibility.byWorkspaceId["ws-1"]?.showNavigationRail).toBe(false);
      expect(state.panelVisibility.byWorkspaceId["ws-1"]?.showMainContent).toBe(true);
      expect(state.panelVisibility.byWorkspaceId["ws-2"]?.showNavigationRail).toBe(true);
      expect(state.panelVisibility.byWorkspaceId["ws-2"]?.showMainContent).toBe(false);
    });

    it("returns selector defaults for workspaces without stored visibility", () => {
      const state = { uiLayout: initialState } as any;

      for (const [key, defaultValue] of Object.entries(defaultPanelVisibility)) {
        expect(
          selectPanelVisibilityFlag.select(state, "ws-new", key as keyof typeof defaultPanelVisibility),
        ).toBe(defaultValue);
      }
    });

    it("reads stored selector values for a workspace", () => {
      const state = {
        uiLayout: {
          ...initialState,
          panelVisibility: {
            byWorkspaceId: {
              "ws-1": { ...defaultPanelVisibility, showMainContent: false },
            },
          },
        },
      } as any;

      expect(selectPanelVisibilityFlag.select(state, "ws-1", "showMainContent")).toBe(false);
      expect(selectPanelVisibilityFlag.select(state, "ws-1", "showNotesPanel")).toBe(true);
    });
  });

  describe("bottom dock", () => {
    it("toggles expanded state", () => {
      const expanded = uiLayoutReducer(initialState, toggleBottomDock());
      expect(expanded.bottomDock.isExpanded).toBe(true);

      const collapsed = uiLayoutReducer(expanded, toggleBottomDock());
      expect(collapsed.bottomDock.isExpanded).toBe(false);
    });

    it("expands dock (no-op when already expanded)", () => {
      const expanded = uiLayoutReducer(initialState, expandBottomDock());
      expect(expanded.bottomDock.isExpanded).toBe(true);

      // no-op
      expect(uiLayoutReducer(expanded, expandBottomDock())).toBe(expanded);
    });

    it("collapses dock (no-op when already collapsed)", () => {
      expect(uiLayoutReducer(initialState, collapseBottomDock())).toBe(initialState);

      const expanded = uiLayoutReducer(initialState, expandBottomDock());
      const collapsed = uiLayoutReducer(expanded, collapseBottomDock());
      expect(collapsed.bottomDock.isExpanded).toBe(false);
    });

    it("sets view mode", () => {
      const state = uiLayoutReducer(initialState, setBottomDockViewMode('terminal'));
      expect(state.bottomDock.viewMode).toBe('terminal');
    });

    it("is no-op when setting same view mode", () => {
      expect(uiLayoutReducer(initialState, setBottomDockViewMode('agents'))).toBe(initialState);
    });

    it("selects terminal and expands", () => {
      const state = uiLayoutReducer(initialState, selectBottomDockTerminal('term-1'));
      expect(state.bottomDock.activeTerminalId).toBe('term-1');
      expect(state.bottomDock.viewMode).toBe('terminal');
      expect(state.bottomDock.isExpanded).toBe(true);
    });

    it("shows agents and expands", () => {
      const withTerminal = uiLayoutReducer(initialState, selectBottomDockTerminal('term-1'));
      const state = uiLayoutReducer(withTerminal, showBottomDockAgents());
      expect(state.bottomDock.viewMode).toBe('agents');
      expect(state.bottomDock.isExpanded).toBe(true);
    });

    it("sets height clamped to min/max", () => {
      expect(uiLayoutReducer(initialState, setBottomDockHeight(500)).bottomDock.height).toBe(500);
      expect(uiLayoutReducer(initialState, setBottomDockHeight(50)).bottomDock.height).toBe(MIN_DOCK_HEIGHT);
      expect(uiLayoutReducer(initialState, setBottomDockHeight(2000)).bottomDock.height).toBe(MAX_DOCK_HEIGHT);
    });

    it("is no-op when setting same height", () => {
      expect(uiLayoutReducer(initialState, setBottomDockHeight(DEFAULT_DOCK_HEIGHT))).toBe(initialState);
    });

    it("loads bottom dock state (always starts collapsed)", () => {
      const state = uiLayoutReducer(initialState, loadBottomDockState({
        viewMode: 'terminal',
        activeTerminalId: 'term-2',
        height: 600,
      }));
      expect(state.bottomDock.isExpanded).toBe(false);
      expect(state.bottomDock.viewMode).toBe('terminal');
      expect(state.bottomDock.activeTerminalId).toBe('term-2');
      expect(state.bottomDock.height).toBe(600);
    });
  });

  describe("layout settings", () => {
    it("should set spacesSidebarWidth", () => {
      const state = uiLayoutReducer(initialState, setSpacesSidebarWidth(300));
      expect(state.spacesSidebarWidth).toBe(300);
    });

    it("should be no-op when setting same spacesSidebarWidth", () => {
      expect(uiLayoutReducer(initialState, setSpacesSidebarWidth(200))).toBe(initialState);
    });

    it("should set spacesSidebarCollapsed", () => {
      expect(uiLayoutReducer(initialState, setSpacesSidebarCollapsed(true)).spacesSidebarCollapsed).toBe(true);
    });

    it("should toggle spacesSidebarCollapsed", () => {
      expect(uiLayoutReducer(initialState, toggleSpacesSidebarCollapsed()).spacesSidebarCollapsed).toBe(true);
      const collapsed = { ...initialState, spacesSidebarCollapsed: true };
      expect(uiLayoutReducer(collapsed, toggleSpacesSidebarCollapsed()).spacesSidebarCollapsed).toBe(false);
    });

    it("should set tabbedSidebarPinned", () => {
      expect(uiLayoutReducer(initialState, setTabbedSidebarPinned(false)).tabbedSidebarPinned).toBe(false);
    });

    it("should toggle tabbedSidebarPinned", () => {
      expect(uiLayoutReducer(initialState, toggleTabbedSidebarPinned()).tabbedSidebarPinned).toBe(false);
    });

    it("should set sidebarSide", () => {
      expect(uiLayoutReducer(initialState, setSidebarSide('right')).sidebarSide).toBe('right');
    });

    it("should be no-op when setting same sidebarSide", () => {
      expect(uiLayoutReducer(initialState, setSidebarSide('left'))).toBe(initialState);
    });

    it("should toggle sidebarSide", () => {
      expect(uiLayoutReducer(initialState, toggleSidebarSide()).sidebarSide).toBe('right');
      const rightState = { ...initialState, sidebarSide: 'right' as const };
      expect(uiLayoutReducer(rightState, toggleSidebarSide()).sidebarSide).toBe('left');
    });

    it("should load layout settings", () => {
      const state = uiLayoutReducer(initialState, loadLayoutSettings({
        spacesSidebarWidth: 250,
        spacesSidebarCollapsed: true,
        tabbedSidebarPinned: false,
        sidebarSide: 'right',
      }));
      expect(state.spacesSidebarWidth).toBe(250);
      expect(state.spacesSidebarCollapsed).toBe(true);
      expect(state.tabbedSidebarPinned).toBe(false);
      expect(state.sidebarSide).toBe('right');
      // Should not touch other state
      expect(state.lineWrapping).toBe(true);
      expect(state.sidebarWidth).toBe(DEFAULT_WIDTH);
    });

    it("should reset layout settings to defaults", () => {
      const modified = uiLayoutReducer(initialState, loadLayoutSettings({
        spacesSidebarWidth: 300,
        spacesSidebarCollapsed: true,
        tabbedSidebarPinned: false,
        sidebarSide: 'right',
      }));
      const reset = uiLayoutReducer(modified, resetLayoutSettings());
      expect(reset.spacesSidebarWidth).toBe(200);
      expect(reset.spacesSidebarCollapsed).toBe(false);
      expect(reset.tabbedSidebarPinned).toBe(true);
      expect(reset.sidebarSide).toBe('left');
    });
  });
});