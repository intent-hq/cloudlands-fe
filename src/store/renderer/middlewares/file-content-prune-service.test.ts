import { describe, expect, it, vi } from "vitest";
import { createFileContentPruneService } from "./file-content-prune-service";
import { removeFileContentEntry, loadFileContentRequested } from "../slices/files/files-slice";
import { closeTab, initializeLayout } from "../slices/panel-layout/panel-layout-slice";
import { setActiveWorkspaceId } from "../slices/workspace/workspace-slice";
import { workspaceMounted } from "../slices/workspace-lifecycle/workspace-lifecycle-slice";
import type { StoreState } from "../types";
import type { StoreMiddlewareAPI } from "@augmentcode/ag-redux-toolkit/types";

function createMockState(
  activeWsId: string | null,
  openFilePaths: string[],
  fileContentPaths: string[],
): Partial<StoreState> {
  return {
    workspace: {
      activeWorkspaceId: activeWsId,
    } as any,
    panelLayout: {
      byWorkspaceId: activeWsId
        ? {
            [activeWsId]: {
              panels: {
                panel1: {
                  id: "panel1",
                  tabs: openFilePaths.map((path, i) => ({
                    id: `tab-${i}`,
                    type: "file" as const,
                    title: path,
                    closable: true,
                    filePath: path,
                  })),
                  activeTabId: openFilePaths[0] ? `tab-0` : null,
                },
              },
              root: { type: "panel" as const, panelId: "panel1" },
              focusedPanelId: "panel1",
              restoreStatus: "idle" as const,
            },
          }
        : {},
    } as any,
    files: {
      byWorkspaceId: activeWsId
        ? {
            [activeWsId]: {
              files: {
                ids: fileContentPaths,
                byId: Object.fromEntries(
                  fileContentPaths.map((path) => [
                    path,
                    {
                      absolutePath: `/repo/${path}`,
                      originalContent: `content-${path}`,
                      localContent: null,
                      loading: false,
                      error: null,
                      isBinary: false,
                      truncated: false,
                      lastUpdated: 0,
                    },
                  ]),
                ),
              },
            },
          }
        : {},
    } as any,
  };
}

function createMockAPI(initialState: Partial<StoreState>): StoreMiddlewareAPI<StoreState> {
  let dispatchedActions: any[] = [];
  let currentState = initialState;
  return {
    getState: () => currentState as StoreState,
    dispatch: vi.fn((action) => {
      dispatchedActions.push(action);
      return action;
    }),
    get _dispatchedActions() {
      return dispatchedActions;
    },
    _clearDispatched: () => {
      dispatchedActions = [];
    },
    _updateState: (newState: Partial<StoreState>) => {
      currentState = newState;
    },
  } as any;
}

describe("file-content-prune-service", () => {
  it("prunes stale file content when a tab is closed", () => {
    // Start with both files open, both have content entries
    const state = createMockState("ws-1", ["src/a.ts", "src/b.ts"], ["src/a.ts", "src/b.ts"]);
    const api = createMockAPI(state);

    // Middleware creation should NOT prune (no stale files initially)
    const middleware = createFileContentPruneService()(api);
    let dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(0);

    const next = vi.fn((action) => {
      // Simulate the reducer closing tab for src/b.ts
      if (action.type === closeTab.type) {
        const newState = createMockState("ws-1", ["src/a.ts"], ["src/a.ts", "src/b.ts"]);
        (api as any)._updateState(newState);
      }
      return action;
    });

    // Close the tab for src/b.ts
    const action = closeTab("ws-1", "tab-1");
    middleware(next)(action);

    expect(next).toHaveBeenCalledWith(action);
    dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual(removeFileContentEntry("ws-1", "src/b.ts"));
  });

  it("does not prune when payload is empty", () => {
    const state = createMockState("ws-1", ["src/a.ts"], ["src/a.ts"]);
    const api = createMockAPI(state);
    const middleware = createFileContentPruneService()(api);
    const next = vi.fn((action) => action);

    const action = closeTab("ws-1", "tab-other");
    middleware(next)(action);

    expect(next).toHaveBeenCalledWith(action);
    const dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(0);
  });

  it("does not prune when active workspace id is invalid", () => {
    const state = createMockState("new", [], ["src/a.ts"]);
    const api = createMockAPI(state);
    const middleware = createFileContentPruneService()(api);
    const next = vi.fn((action) => action);

    const action = initializeLayout("new", { root: { type: "panel", panelId: "p1" }, panels: {}, focusedPanelId: "p1" });
    middleware(next)(action);

    expect(next).toHaveBeenCalledWith(action);
    const dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(0);
  });

  it("does not prune when there is no active workspace", () => {
    const state = createMockState(null, [], []);
    const api = createMockAPI(state);
    const middleware = createFileContentPruneService()(api);
    const next = vi.fn((action) => action);

    const action = setActiveWorkspaceId("ws-other");
    middleware(next)(action);

    expect(next).toHaveBeenCalledWith(action);
    const dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(0);
  });

  it("does not re-trigger itself on removeFileContentEntry", () => {
    const state = createMockState("ws-1", [], ["src/a.ts"]);
    const api = createMockAPI(state);

    // Middleware creation should prune src/a.ts
    const middleware = createFileContentPruneService()(api);
    let dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual(removeFileContentEntry("ws-1", "src/a.ts"));

    // Clear dispatched actions
    (api as any)._clearDispatched();

    const next = vi.fn((action) => {
      // Simulate the reducer removing the file entry
      if (action.type === removeFileContentEntry.type) {
        state.files.byWorkspaceId["ws-1"].files.ids = [];
      }
      return action;
    });

    // Manually dispatch removeFileContentEntry
    const action = removeFileContentEntry("ws-1", "src/a.ts");
    middleware(next)(action);

    expect(next).toHaveBeenCalledWith(action);
    // Should NOT dispatch additional removeFileContentEntry actions (no loop)
    dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(0);
  });

  it("prunes on retroactive check when middleware is created with stale content", () => {
    const state = createMockState("ws-1", [], ["src/stale.ts"]);
    const api = createMockAPI(state);

    // Creating the middleware should trigger an initial prune
    createFileContentPruneService()(api);

    const dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual(removeFileContentEntry("ws-1", "src/stale.ts"));
  });

  it("does not prune the same paths twice (payload equality check)", () => {
    // Start with NO stale files initially
    const state = createMockState("ws-1", ["src/a.ts"], ["src/a.ts"]);
    const api = createMockAPI(state);
    const middleware = createFileContentPruneService()(api);

    // Middleware creation should NOT prune (no stale files initially)
    let dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(0);

    const next = vi.fn((action) => {
      // Simulate closing the tab on first action
      if (action === action1) {
        const newState = createMockState("ws-1", [], ["src/a.ts"]);
        (api as any)._updateState(newState);
      }
      return action;
    });

    // First action closes the tab, making src/a.ts stale - should prune
    const action1 = closeTab("ws-1", "tab-0");
    middleware(next)(action1);

    dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual(removeFileContentEntry("ws-1", "src/a.ts"));

    // Clear dispatched actions
    (api as any)._clearDispatched();

    // Second action with same stale paths (src/a.ts still stale) should NOT prune again
    const action2 = closeTab("ws-1", "tab-other");
    middleware(next)(action2);

    dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(0);
  });

  it("keeps file content when the same path remains open in another tab", () => {
    const state = createMockState("ws-1", ["src/a.ts", "src/a.ts"], ["src/a.ts"]);
    const api = createMockAPI(state);
    const middleware = createFileContentPruneService()(api);
    const next = vi.fn((action) => action);

    const action = closeTab("ws-1", "tab-0");
    middleware(next)(action);

    expect(next).toHaveBeenCalledWith(action);
    const dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(0);
  });

  it("prunes the old file content path when a file tab path changes", () => {
    const state = createMockState("ws-1", ["src/new.ts"], ["src/old.ts", "src/new.ts"]);
    const api = createMockAPI(state);
    const middleware = createFileContentPruneService()(api);
    const next = vi.fn((action) => action);

    const action = workspaceMounted("ws-1");
    middleware(next)(action);

    expect(next).toHaveBeenCalledWith(action);
    const dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual(removeFileContentEntry("ws-1", "src/old.ts"));
  });

  it("prunes entry created via loadFileContentRequested for path not open in any tab", () => {
    // Start with no files open, no content entries
    const state = createMockState("ws-1", [], []);
    const api = createMockAPI(state);
    const middleware = createFileContentPruneService()(api);

    const next = vi.fn((action) => {
      // Simulate the reducer upserting a file-content entry on loadFileContentRequested
      if (action.type === loadFileContentRequested.type) {
        const newState = createMockState("ws-1", [], ["src/background.ts"]);
        (api as any)._updateState(newState);
      }
      return action;
    });

    // Load a file that is NOT open in any tab (e.g., background read by FilesReadService)
    const action = loadFileContentRequested("ws-1", "src/background.ts", "/abs/background.ts");
    middleware(next)(action);

    expect(next).toHaveBeenCalledWith(action);
    // The middleware should immediately prune src/background.ts since it's not open in any tab
    const dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual(removeFileContentEntry("ws-1", "src/background.ts"));
  });
});
