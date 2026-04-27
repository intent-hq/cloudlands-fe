import { describe, expect, it } from "vitest";
import {
  appLayoutReducer,
  commandPaletteActionConsumed,
  commandPaletteNewFileRequested,
  initialState,
  locateItemInSidebarConsumed,
  locateItemInSidebarRequested,
  type SidebarLocateTarget,
} from "./app-layout-slice";

describe("appLayoutReducer", () => {
  it("returns the initial state", () => {
    expect(appLayoutReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  describe("commandPaletteNewFileRequested", () => {
    it("sets pendingCommandPaletteAction with workspaceId and create-file type", () => {
      const next = appLayoutReducer(initialState, commandPaletteNewFileRequested("ws-1"));
      expect(next.pendingCommandPaletteAction).toEqual({
        type: "create-file",
        workspaceId: "ws-1",
      });
    });

    it("overwrites a prior pending action", () => {
      const intermediate = appLayoutReducer(initialState, commandPaletteNewFileRequested("ws-1"));
      const next = appLayoutReducer(intermediate, commandPaletteNewFileRequested("ws-2"));
      expect(next.pendingCommandPaletteAction).toEqual({
        type: "create-file",
        workspaceId: "ws-2",
      });
    });
  });

  describe("commandPaletteActionConsumed", () => {
    it("clears pendingCommandPaletteAction when workspaceId matches", () => {
      const intermediate = appLayoutReducer(initialState, commandPaletteNewFileRequested("ws-1"));
      const next = appLayoutReducer(intermediate, commandPaletteActionConsumed("ws-1"));
      expect(next.pendingCommandPaletteAction).toBeNull();
    });

    it("does nothing when workspaceId does not match", () => {
      const intermediate = appLayoutReducer(initialState, commandPaletteNewFileRequested("ws-1"));
      const next = appLayoutReducer(intermediate, commandPaletteActionConsumed("ws-other"));
      expect(next.pendingCommandPaletteAction).toEqual({
        type: "create-file",
        workspaceId: "ws-1",
      });
    });
  });

  describe("locateItemInSidebarRequested", () => {
    const target: SidebarLocateTarget = {
      sidebarTabId: "files",
      type: "file",
      filePath: "/foo/bar.ts",
    };

    it("sets pendingLocateInSidebar with workspaceId and target", () => {
      const next = appLayoutReducer(initialState, locateItemInSidebarRequested("ws-1", target));
      expect(next.pendingLocateInSidebar).toEqual({ workspaceId: "ws-1", target });
    });

    it("overwrites a prior pending locate", () => {
      const intermediate = appLayoutReducer(
        initialState,
        locateItemInSidebarRequested("ws-1", target),
      );
      const newTarget: SidebarLocateTarget = {
        sidebarTabId: "agents",
        type: "agent",
        agentId: "a-1",
      };
      const next = appLayoutReducer(
        intermediate,
        locateItemInSidebarRequested("ws-2", newTarget),
      );
      expect(next.pendingLocateInSidebar).toEqual({ workspaceId: "ws-2", target: newTarget });
    });
  });

  describe("locateItemInSidebarConsumed", () => {
    const target: SidebarLocateTarget = {
      sidebarTabId: "files",
      type: "file",
      filePath: "/foo/bar.ts",
    };

    it("clears pendingLocateInSidebar when workspaceId matches", () => {
      const intermediate = appLayoutReducer(
        initialState,
        locateItemInSidebarRequested("ws-1", target),
      );
      const next = appLayoutReducer(intermediate, locateItemInSidebarConsumed("ws-1"));
      expect(next.pendingLocateInSidebar).toBeNull();
    });

    it("does nothing when workspaceId does not match", () => {
      const intermediate = appLayoutReducer(
        initialState,
        locateItemInSidebarRequested("ws-1", target),
      );
      const next = appLayoutReducer(intermediate, locateItemInSidebarConsumed("ws-other"));
      expect(next.pendingLocateInSidebar).toEqual({ workspaceId: "ws-1", target });
    });
  });
});