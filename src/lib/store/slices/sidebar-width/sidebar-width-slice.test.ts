import { describe, it, expect } from "vitest";
import {
  sidebarWidthReducer,
  setWidth,
  toggleSidebar,
  setCollapsed,
  loadSidebarState,
  type SidebarWidthState,
  MIN_WIDTH,
  MAX_WIDTH,
  DEFAULT_WIDTH,
} from "./sidebar-width-slice";

describe("sidebarWidthReducer", () => {
  const initialState: SidebarWidthState = {
    width: DEFAULT_WIDTH,
    widthBeforeCollapse: DEFAULT_WIDTH,
    isCollapsed: false,
  };

  it("should return initial state", () => {
    const state = sidebarWidthReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setWidth", () => {
    it("should set width clamped to min/max", () => {
      const state = sidebarWidthReducer(initialState, setWidth(400));
      expect(state.width).toBe(400);
      expect(state.widthBeforeCollapse).toBe(400);
    });

    it("should clamp width to MIN_WIDTH", () => {
      const state = sidebarWidthReducer(initialState, setWidth(50));
      expect(state.width).toBe(MIN_WIDTH);
    });

    it("should clamp width to MAX_WIDTH", () => {
      const state = sidebarWidthReducer(initialState, setWidth(1200));
      expect(state.width).toBe(MAX_WIDTH);
    });

    it("should round width to integer", () => {
      const state = sidebarWidthReducer(initialState, setWidth(350.7));
      expect(state.width).toBe(351);
    });

    it("should not update widthBeforeCollapse when collapsed", () => {
      const collapsedState: SidebarWidthState = {
        width: 300,
        widthBeforeCollapse: 300,
        isCollapsed: true,
      };
      const state = sidebarWidthReducer(collapsedState, setWidth(400));
      expect(state.width).toBe(400);
      expect(state.widthBeforeCollapse).toBe(300);
    });
  });

  describe("toggleSidebar", () => {
    it("should collapse when expanded", () => {
      const state = sidebarWidthReducer(initialState, toggleSidebar());
      expect(state.isCollapsed).toBe(true);
      expect(state.widthBeforeCollapse).toBe(DEFAULT_WIDTH);
    });

    it("should expand when collapsed", () => {
      const collapsedState: SidebarWidthState = {
        width: 300,
        widthBeforeCollapse: 300,
        isCollapsed: true,
      };
      const state = sidebarWidthReducer(collapsedState, toggleSidebar());
      expect(state.isCollapsed).toBe(false);
    });
  });

  describe("setCollapsed", () => {
    it("should collapse and store width", () => {
      const state = sidebarWidthReducer(initialState, setCollapsed(true));
      expect(state.isCollapsed).toBe(true);
      expect(state.widthBeforeCollapse).toBe(DEFAULT_WIDTH);
    });

    it("should expand", () => {
      const collapsedState: SidebarWidthState = {
        width: 300,
        widthBeforeCollapse: 300,
        isCollapsed: true,
      };
      const state = sidebarWidthReducer(collapsedState, setCollapsed(false));
      expect(state.isCollapsed).toBe(false);
    });

    it("should return same state if already in desired state", () => {
      const state = sidebarWidthReducer(initialState, setCollapsed(false));
      expect(state).toBe(initialState);
    });
  });

  describe("loadSidebarState", () => {
    it("should load width and collapsed state", () => {
      const state = sidebarWidthReducer(initialState, loadSidebarState(500, true));
      expect(state.width).toBe(500);
      expect(state.widthBeforeCollapse).toBe(500);
      expect(state.isCollapsed).toBe(true);
    });
  });

});

