import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  loadEditorSettings,
  loadSidebarState,
  setCollapsed,
  setDiffIndicators,
  setDiffSideBySide,
  setFoldUnchanged,
  setLineWrapping,
  setWidth,
  toggleDiffIndicators,
  toggleDiffSideBySide,
  toggleFoldUnchanged,
  toggleLineWrapping,
  toggleSidebar,
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
});