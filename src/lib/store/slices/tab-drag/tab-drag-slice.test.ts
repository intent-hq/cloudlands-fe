import { describe, it, expect } from "vitest";
import {
  tabDragReducer,
  startDrag,
  endDrag,
  setActiveHandleDrop,
  type TabDragState,
  type HandleDropInfo,
} from "./tab-drag-slice";

describe("tabDragReducer", () => {
  const initialState: TabDragState = {
    isDragging: false,
    activeHandleDrop: null,
  };

  it("should return initial state", () => {
    const state = tabDragReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("startDrag", () => {
    it("should set isDragging to true", () => {
      const state = tabDragReducer(initialState, startDrag());
      expect(state.isDragging).toBe(true);
    });

    it("should not affect activeHandleDrop", () => {
      const dropInfo: HandleDropInfo = {
        handleRect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
        containerRect: { x: 0, y: 0, width: 100, height: 100, top: 0, right: 100, bottom: 100, left: 0 },
        zoneType: "row-above",
        label: "Add row above",
      };
      const stateWithDrop: TabDragState = { ...initialState, activeHandleDrop: dropInfo };
      const state = tabDragReducer(stateWithDrop, startDrag());
      expect(state.isDragging).toBe(true);
      expect(state.activeHandleDrop).toBe(dropInfo);
    });
  });

  describe("endDrag", () => {
    it("should set isDragging to false and clear activeHandleDrop", () => {
      const draggingState: TabDragState = {
        isDragging: true,
        activeHandleDrop: {
          handleRect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
          containerRect: { x: 0, y: 0, width: 100, height: 100, top: 0, right: 100, bottom: 100, left: 0 },
          zoneType: "column-left",
          label: "Add column left",
        },
      };
      const state = tabDragReducer(draggingState, endDrag());
      expect(state.isDragging).toBe(false);
      expect(state.activeHandleDrop).toBeNull();
    });
  });

  describe("setActiveHandleDrop", () => {
    it("should set activeHandleDrop info", () => {
      const dropInfo: HandleDropInfo = {
        handleRect: { x: 50, y: 50, width: 16, height: 200, top: 50, right: 66, bottom: 250, left: 50 },
        containerRect: { x: 0, y: 0, width: 800, height: 600, top: 0, right: 800, bottom: 600, left: 0 },
        zoneType: "row-below",
        label: "Add row below",
      };
      const state = tabDragReducer(initialState, setActiveHandleDrop(dropInfo));
      expect(state.activeHandleDrop).toEqual(dropInfo);
    });

    it("should clear activeHandleDrop when set to null", () => {
      const stateWithDrop: TabDragState = {
        isDragging: true,
        activeHandleDrop: {
          handleRect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
          containerRect: { x: 0, y: 0, width: 100, height: 100, top: 0, right: 100, bottom: 100, left: 0 },
          zoneType: "column-right",
          label: "Add column right",
        },
      };
      const state = tabDragReducer(stateWithDrop, setActiveHandleDrop(null));
      expect(state.activeHandleDrop).toBeNull();
    });
  });
});

