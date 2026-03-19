import { describe, expect, it } from "vitest";
import {
  clearForWorkspace,
  endDrag,
  loadScrollPositions,
  removeScrollPosition,
  saveScrollPosition,
  setActiveHandleDrop,
  startDrag,
  tabStateReducer,
  type HandleDropInfo,
  type TabState,
} from "./tab-state-slice";

const makeDropInfo = (zoneType: HandleDropInfo["zoneType"]): HandleDropInfo => ({
  handleRect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
  containerRect: { x: 0, y: 0, width: 100, height: 100, top: 0, right: 100, bottom: 100, left: 0 },
  zoneType,
  label: zoneType,
});

describe("tabStateReducer", () => {
  const initialState: TabState = {
    isDragging: false,
    activeHandleDrop: null,
    scrollPositions: {},
  };

  it("returns the initial state", () => {
    expect(tabStateReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("handles drag lifecycle actions", () => {
    const dropInfo = makeDropInfo("row-above");
    const draggingState = tabStateReducer(initialState, startDrag());
    expect(draggingState.isDragging).toBe(true);

    const stateWithDrop = tabStateReducer(draggingState, setActiveHandleDrop(dropInfo));
    expect(stateWithDrop.activeHandleDrop).toEqual(dropInfo);

    const endedState = tabStateReducer(stateWithDrop, endDrag());
    expect(endedState.isDragging).toBe(false);
    expect(endedState.activeHandleDrop).toBeNull();
  });

  it("can clear the active handle drop without ending drag", () => {
    const stateWithDrop: TabState = {
      ...initialState,
      isDragging: true,
      activeHandleDrop: makeDropInfo("column-right"),
    };

    expect(tabStateReducer(stateWithDrop, setActiveHandleDrop(null)).activeHandleDrop).toBeNull();
  });

  it("saves positive scroll positions and ignores non-positive values", () => {
    expect(tabStateReducer(initialState, saveScrollPosition("tab-1", 0))).toBe(initialState);
    expect(tabStateReducer(initialState, saveScrollPosition("tab-1", -10))).toBe(initialState);

    expect(tabStateReducer(initialState, saveScrollPosition("tab-1", 150)).scrollPositions).toEqual({
      "tab-1": 150,
    });
  });

  it("removes scroll positions and ignores missing keys", () => {
    const stateWithPosition: TabState = {
      ...initialState,
      scrollPositions: { "tab-1": 150 },
    };

    expect(tabStateReducer(stateWithPosition, removeScrollPosition("missing"))).toBe(stateWithPosition);
    expect(tabStateReducer(stateWithPosition, removeScrollPosition("tab-1")).scrollPositions).toEqual({});
  });

  it("clears scroll positions only for the requested workspace prefix", () => {
    const stateWithPositions: TabState = {
      ...initialState,
      scrollPositions: { "ws-123-tab-1": 100, "ws-123-tab-2": 200, "ws-456-tab-3": 300 },
    };

    expect(tabStateReducer(stateWithPositions, clearForWorkspace("ws-123")).scrollPositions).toEqual({
      "ws-456-tab-3": 300,
    });
    expect(tabStateReducer(stateWithPositions, clearForWorkspace("ws-999"))).toBe(stateWithPositions);
  });

  it("loads scroll positions by replacing the existing map", () => {
    const stateWithPositions: TabState = {
      ...initialState,
      scrollPositions: { "tab-1": 100 },
    };

    expect(tabStateReducer(stateWithPositions, loadScrollPositions({ "tab-2": 200 }))).toMatchObject({
      scrollPositions: { "tab-2": 200 },
    });
  });
});