import {
  describe,
  it,
  expect,
} from "vitest";
import {
  pipReducer,
  pipWindowOpened,
  pipWindowClosed,
  initialState,
  type PipState,
} from "./pip-slice";

describe("pipReducer", () => {
  it("should return initial state", () => {
    const state = pipReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("pipWindowOpened", () => {
    it("should add a new pip window", () => {
      const state = pipReducer(
        initialState,
        pipWindowOpened({ workspaceId: "ws-1", tabId: "tab-1", windowId: 42 })
      );
      expect(state.openPipWindows["ws-1:tab-1"]).toEqual({
        workspaceId: "ws-1",
        tabId: "tab-1",
        tabType: "",
        windowId: 42,
        panelId: "",
      });
    });

    it("should update windowId on existing entry", () => {
      const prev: PipState = {
        openPipWindows: {
          "ws-1:tab-1": {
            workspaceId: "ws-1",
            tabId: "tab-1",
            tabType: "browser",
            windowId: 10,
            panelId: "panel-1",
          },
        },
      };
      const state = pipReducer(
        prev,
        pipWindowOpened({ workspaceId: "ws-1", tabId: "tab-1", windowId: 99 })
      );
      expect(state.openPipWindows["ws-1:tab-1"].windowId).toBe(99);
      // Preserve existing fields
      expect(state.openPipWindows["ws-1:tab-1"].tabType).toBe("browser");
      expect(state.openPipWindows["ws-1:tab-1"].panelId).toBe("panel-1");
    });

    it("should not mutate previous state", () => {
      const state = pipReducer(
        initialState,
        pipWindowOpened({ workspaceId: "ws-1", tabId: "tab-1", windowId: 1 })
      );
      expect(initialState.openPipWindows).toEqual({});
      expect(Object.keys(state.openPipWindows)).toHaveLength(1);
    });
  });

  describe("pipWindowClosed", () => {
    it("should remove a pip window", () => {
      const prev: PipState = {
        openPipWindows: {
          "ws-1:tab-1": {
            workspaceId: "ws-1",
            tabId: "tab-1",
            tabType: "",
            windowId: 42,
            panelId: "",
          },
          "ws-1:tab-2": {
            workspaceId: "ws-1",
            tabId: "tab-2",
            tabType: "",
            windowId: 43,
            panelId: "",
          },
        },
      };
      const state = pipReducer(
        prev,
        pipWindowClosed({ workspaceId: "ws-1", tabId: "tab-1" })
      );
      expect(state.openPipWindows["ws-1:tab-1"]).toBeUndefined();
      expect(state.openPipWindows["ws-1:tab-2"]).toBeDefined();
    });

    it("should return same state if window not found", () => {
      const state = pipReducer(
        initialState,
        pipWindowClosed({ workspaceId: "ws-1", tabId: "nonexistent" })
      );
      expect(state).toBe(initialState);
    });
  });
});

