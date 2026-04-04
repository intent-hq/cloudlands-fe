import { beforeEach, describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  cancel: function* (task: any) {
    return yield {
      "@@redux-saga/IO": true,
      combinator: false,
      type: "CANCEL",
      payload: task,
    };
  },
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  take: function* (patternOrChannel: any) {
    return yield sagaEffects.take(patternOrChannel);
  },
  takeEvery: function* (pattern: any, saga: any, ...args: any[]) {
    return yield sagaEffects.takeEvery(pattern, saga, ...args);
  },
}));

const {
  takeEveryFromElectronChannelMock,
  takeEveryFromWindowEventMock,
  createDockNavigationWatcherMock,
  dispatchMock,
  getFileExtensionMock,
  getReduxStoreMock,
  getPanelLayoutManagerMock,
  getSettingsPreviousPathMock,
  gotoMock,
  hasPanelLayoutManagerMock,
  isFocusInTerminalMock,
  navigateToSettingsMock,
  reduxState,
  trackMock,
  windowStub,
} = vi.hoisted(() => {
  const location = { pathname: "/" };
  const reduxState: Record<string, any> = {
    workspace: {
      activeWorkspaceId: "ws-current",
      workspaces: {
        ids: ["ws-current"],
        map: {
          "ws-current": {
            id: "ws-current",
            environmentConfig: {
              type: "remote",
              ssh: { host: "example.com" },
            },
          },
        },
      },
    },
    panelLayout: {
      byWorkspaceId: {},
    },
  };

  const dispatchMock = vi.fn();
  const storeMock = { getState: () => reduxState, dispatch: dispatchMock };

  return {
    takeEveryFromElectronChannelMock: vi.fn(function* () {}),
    takeEveryFromWindowEventMock: vi.fn(function* () {}),
    createDockNavigationWatcherMock: vi.fn(),
    dispatchMock,
    getFileExtensionMock: vi.fn(),
    getReduxStoreMock: vi.fn(() => storeMock),
    getPanelLayoutManagerMock: vi.fn(),
    getSettingsPreviousPathMock: vi.fn(),
    gotoMock: vi.fn(),
    hasPanelLayoutManagerMock: vi.fn(),
    isFocusInTerminalMock: vi.fn(),
    navigateToSettingsMock: vi.fn(),
    reduxState,
    trackMock: vi.fn(),
    windowStub: {
      electronAPI: {},
      location,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    },
  };
});

vi.mock("$app/navigation", () => ({
  goto: gotoMock,
}));

vi.mock("$features/layout/panel-layout-adapter", () => ({
  getPanelLayoutManager: getPanelLayoutManagerMock,
  hasPanelLayoutManager: hasPanelLayoutManagerMock,
}));

vi.mock("$lib/store/redux-dispatch-bridge", () => ({
  getReduxStore: getReduxStoreMock,
}));

vi.mock("$lib/services/analytics", () => ({
  getFileExtension: getFileExtensionMock,
  track: trackMock,
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: takeEveryFromElectronChannelMock,
  takeEveryFromWindowEvent: takeEveryFromWindowEventMock,
}));

vi.mock("$lib/utils/keyboardShortcuts", () => ({
  isFocusInTerminal: isFocusInTerminalMock,
}));

vi.mock("$lib/utils/workspace-navigation", () => ({
  getSettingsPreviousPath: getSettingsPreviousPathMock,
  navigateToSettings: navigateToSettingsMock,
}));

vi.mock("./dock-navigation-saga", () => ({
  watchDockNavigationForWorkspaceSaga: createDockNavigationWatcherMock,
}));

import { openNewSpaceModal } from "../../global-modals/global-modals-slice";
import {
  focusPanel as focusPanelAction,
  setActiveTab as setActiveTabAction,
  updateTabBrowserUrl as updateTabBrowserUrlAction,
} from "../../panel-layout/panel-layout-slice";
import { selectAllTabs } from "../../panel-layout/panel-layout-selectors";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { selectActiveWorkspace } from "../../workspace/workspace-selectors";
import { createAgentRequested } from "../../workspace-agents/workspace-agents-slice";
import {
  appLayoutSaga,
  cancelWorkspaceWindowEventsForWorkspaceSaga,
  retroactiveAppLayoutMountCheckSaga,
  watchBrowserOpenTabSaga,
  watchMenuNewAgentSaga,
  watchNavigateSaga,
  watchNavigateToSettingsSaga,
  watchOpenNewSpaceModalSaga,
  watchWorkspaceCreateForRepoSaga,
  watchMenuNewBrowserSaga,
  watchMenuZoomInSaga,
  watchMenuCloseTabSaga,
  watchMenuReopenClosedTabSaga,
  watchMenuResetZoomSaga,
  watchMenuSelectNextTabSaga,
  watchMenuSelectPreviousTabSaga,
  watchMenuNewNoteSaga,
  watchMenuNewTerminalSaga,
  watchMenuZoomOutSaga,
  watchOpenAgentSaga,
  watchOpenCommitChangesetSaga,
  watchOpenDiffSaga,
  watchOpenFileSaga,
  watchOpenNoteSaga,
  watchOpenTerminalSaga,
  watchShowAgentSaga,
  watchWorkspaceWindowEventLifecyclesSaga,
  watchWorkspaceWindowEventsForWorkspaceSaga,
  watchWorkspaceWindowEventsSaga,
} from "./app-layout-saga";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import { specPanelSaga } from "./spec-panel-saga";

function getWindowEventHandler(eventName: string) {
  const call = takeEveryFromWindowEventMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

function getElectronHandler(eventName: string) {
  const call = takeEveryFromElectronChannelMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}



describe("appLayoutSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", windowStub as unknown as Window & typeof globalThis);
    windowStub.location.pathname = "/";
    reduxState.workspace.activeWorkspaceId = "ws-current";
    reduxState.workspace.workspaces = {
      ids: ["ws-current"],
      map: {
        "ws-current": {
      id: "ws-current",
      notes: [{ id: "note-1", title: "Note One" }],
      agents: [{ id: "agent-1", title: "Agent One", name: "Agent One" }],
      environmentConfig: {
        type: "remote",
        ssh: { host: "example.com" },
      },
        },
      },
    };
    reduxState.workspaceNotes = {
      byWorkspaceId: {
        "ws-current": {
          notes: {
            ids: ["note-1"],
            map: { "note-1": { id: "note-1", title: "Note One" } },
          },
        },
      },
    };
    reduxState.agentSessions = {
      byAgentId: {
        "agent-1": { id: "agent-1", name: "Agent One" },
      },
    };
    getFileExtensionMock.mockReturnValue("ts");
    hasPanelLayoutManagerMock.mockReturnValue(true);
  });

  it("forks all layout watchers", () => {
    const iterator = appLayoutSaga();

    expect(iterator.next()).toEqual({ value: sagaEffects.fork(watchNavigateSaga), done: false });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchNavigateToSettingsSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchMenuNewAgentSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: sagaEffects.fork(watchMenuNewNoteSaga), done: false });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchMenuNewTerminalSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchMenuNewBrowserSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchBrowserOpenTabSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: sagaEffects.fork(watchMenuCloseTabSaga), done: false });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchMenuReopenClosedTabSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchMenuSelectPreviousTabSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchMenuSelectNextTabSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: sagaEffects.fork(watchMenuZoomInSaga), done: false });
    expect(iterator.next()).toEqual({ value: sagaEffects.fork(watchMenuZoomOutSaga), done: false });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchMenuResetZoomSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchWorkspaceCreateForRepoSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchOpenNewSpaceModalSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchWorkspaceWindowEventLifecyclesSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(retroactiveAppLayoutMountCheckSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: sagaEffects.fork(specPanelSaga), done: false });
    expect((iterator.next().value as any)?.type).toBe("FORK");
    expect((iterator.next().value as any)?.type).toBe("FORK");
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("forks the workspace window event lifecycle watcher", () => {
    const iterator = appLayoutSaga();

    for (let index = 0; index < 16; index += 1) {
      iterator.next();
    }

    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchWorkspaceWindowEventLifecyclesSaga),
      done: false,
    });
  });

  it("forks individual workspace window watchers", () => {
    const iterator = watchWorkspaceWindowEventsSaga("ws-current");

    expect(iterator.next()).toEqual({ value: sagaEffects.fork(watchShowAgentSaga, "ws-current"), done: false });
    expect(iterator.next()).toEqual({ value: sagaEffects.fork(watchOpenFileSaga, "ws-current"), done: false });
    expect(iterator.next()).toEqual({ value: sagaEffects.fork(watchOpenDiffSaga, "ws-current"), done: false });
    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchOpenCommitChangesetSaga, "ws-current"),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: sagaEffects.fork(watchOpenNoteSaga, "ws-current"), done: false });
    expect(iterator.next()).toEqual({ value: sagaEffects.fork(watchOpenAgentSaga, "ws-current"), done: false });
    expect(iterator.next()).toEqual({ value: sagaEffects.fork(watchOpenTerminalSaga, "ws-current"), done: false });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("registers workspace window watchers on mount and cancels them from the unmount handler", () => {
    const task = { id: "task-1" };
    const dockNavigationTask = { id: "task-2" };
    const mountIterator = watchWorkspaceWindowEventsForWorkspaceSaga(workspaceMounted("ws-current"));

    expect(mountIterator.next()).toEqual({
      value: sagaEffects.fork(watchWorkspaceWindowEventsSaga, "ws-current"),
      done: false,
    });
    expect(mountIterator.next(task)).toEqual({
      value: sagaEffects.fork(createDockNavigationWatcherMock, "ws-current"),
      done: false,
    });
    expect(mountIterator.next(dockNavigationTask)).toEqual({ value: undefined, done: true });

    const cancelIterator = cancelWorkspaceWindowEventsForWorkspaceSaga(
      workspaceUnmounted("ws-current")
    );

    expect(cancelIterator.next()).toEqual({
      value: {
        "@@redux-saga/IO": true,
        combinator: false,
        type: "CANCEL",
        payload: task,
      },
      done: false,
    });
    expect(cancelIterator.next()).toEqual({
      value: {
        "@@redux-saga/IO": true,
        combinator: false,
        type: "CANCEL",
        payload: dockNavigationTask,
      },
      done: false,
    });
    expect(cancelIterator.next()).toEqual({ value: undefined, done: true });
  });

  it("subscribes to workspace mount and unmount events for window routing", () => {
    const iterator = watchWorkspaceWindowEventLifecyclesSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(workspaceMounted, watchWorkspaceWindowEventsForWorkspaceSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(workspaceUnmounted, cancelWorkspaceWindowEventsForWorkspaceSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("creates an uncaptured channel for workspace:show-agent and focuses an existing agent tab", () => {
    // Set up panel data in Redux state so showAgentInLayout can find the agent tab
    reduxState.panelLayout = {
      byWorkspaceId: {
        "ws-current": {
          panels: {
            "panel-1": {
              tabs: [{ id: "tab-1", type: "agent", agentId: "agent-1" }],
              activeTabId: null,
            },
          },
          focusedPanelId: null,
          root: { type: "panel", panelId: "panel-1" },
          recentlyClosed: [],
          layoutHistory: [],
          historyIndex: -1,
          historyLoaded: false,
          focusHistory: [],
          focusHistoryIndex: -1,
          expandedPanelId: null,
          deferSpecTab: false,
          pendingFocusTabId: null,
        },
      },
    };

    const iterator = watchShowAgentSaga("ws-current");

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(takeEveryFromWindowEventMock).toHaveBeenCalledWith(
      "workspace:show-agent",
      expect.any(Function),
    );

    const handler = getWindowEventHandler("workspace:show-agent");
    expect(handler({ agentId: "agent-1" }).next()).toEqual({ value: undefined, done: true });

    // The saga now dispatches Redux actions directly via store.dispatch()
    expect(dispatchMock).toHaveBeenCalledWith(focusPanelAction("ws-current", "panel-1"));
    expect(dispatchMock).toHaveBeenCalledWith(setActiveTabAction("ws-current", "tab-1", "panel-1"));
  });

  it("opens files through Redux dispatch and tracks analytics", () => {
    // Set up panel state so requestFocusedPanelFocus can read focusedPanelId
    reduxState.panelLayout = {
      byWorkspaceId: {
        "ws-current": {
          panels: { "panel-2": { tabs: [], activeTabId: null } },
          focusedPanelId: "panel-2",
          root: { type: "panel", panelId: "panel-2" },
          recentlyClosed: [],
          layoutHistory: [],
          historyIndex: -1,
          historyLoaded: false,
          focusHistory: [],
          focusHistoryIndex: -1,
          expandedPanelId: null,
          deferSpecTab: false,
          pendingFocusTabId: null,
        },
      },
    };

    const iterator = watchOpenFileSaga("ws-current");

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(takeEveryFromWindowEventMock).toHaveBeenCalledWith(
      "workspace:open-file",
      expect.any(Function),
      {
        capture: true,
        stopImmediatePropagation: true,
      },
    );

    const handler = getWindowEventHandler("workspace:open-file");
    expect(
      handler({
        filePath: "src/main.ts",
        openInAdjacentPanel: true,
        sourcePanelId: "panel-1",
      }).next(),
    ).toEqual({ value: undefined, done: true });

    // The saga now dispatches Redux actions directly via store.dispatch()
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panelLayout/openTabInAdjacentOrSplit",
        payload: expect.objectContaining({
          tab: expect.objectContaining({
            type: "file",
            title: "main.ts",
            filePath: "src/main.ts",
            closable: true,
          }),
          sourcePanelId: "panel-1",
        }),
      }),
    );
    expect(trackMock).toHaveBeenCalledWith("Opened File", {
      workspace_id: "ws-current",
      file_extension: "ts",
    });
    expect(windowStub.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "panel:request-focus" }),
    );
  });

  it("opens notes in an adjacent panel when launched from an active agent tab", () => {
    // Set up panel state so selectPanel can find the source panel with an active agent tab
    reduxState.panelLayout = {
      byWorkspaceId: {
        "ws-current": {
          panels: {
            "panel-1": {
              tabs: [{ id: "tab-agent", type: "agent" }],
              activeTabId: "tab-agent",
            },
            "panel-2": { tabs: [], activeTabId: null },
          },
          focusedPanelId: "panel-2",
          root: { type: "panel", panelId: "panel-2" },
          recentlyClosed: [],
          layoutHistory: [],
          historyIndex: -1,
          historyLoaded: false,
          focusHistory: [],
          focusHistoryIndex: -1,
          expandedPanelId: null,
          deferSpecTab: false,
          pendingFocusTabId: null,
        },
      },
    };

    const iterator = watchOpenNoteSaga("ws-current");

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(takeEveryFromWindowEventMock).toHaveBeenCalledWith(
      "workspace:open-note",
      expect.any(Function),
      {
        capture: true,
        stopImmediatePropagation: true,
      },
    );

    const handler = getWindowEventHandler("workspace:open-note");
    expect(
      handler({
        noteId: "note-1",
        openInAdjacentPanel: false,
        sourcePanelId: "panel-1",
      }).next(),
    ).toEqual({ value: undefined, done: true });

    // The saga detects the active tab is an agent tab and opens in adjacent panel
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "panelLayout/openTabInAdjacentOrSplit",
        payload: expect.objectContaining({
          tab: expect.objectContaining({
            type: "note",
            title: "Note One",
            noteId: "note-1",
            closable: true,
          }),
          sourcePanelId: "panel-1",
        }),
      }),
    );
  });

  it("opens the new space modal instead of navigating for /?create=true", () => {
    const iterator = watchNavigateSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(takeEveryFromElectronChannelMock).toHaveBeenCalledWith("navigate", expect.any(Function));

    const handler = getElectronHandler("navigate");
    expect(handler("/?create=true").next()).toEqual({
      value: sagaEffects.put(openNewSpaceModal(undefined)),
      done: false,
    });
  });

  it("navigates directly for normal navigate events", () => {
    const iterator = watchNavigateSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getElectronHandler("navigate");
    expect(handler("/workspace/ws-2").next()).toEqual({
      value: sagaEffects.call(gotoMock, "/workspace/ws-2"),
      done: false,
    });
  });

  it("toggles back from settings using the stored previous path", () => {
    getSettingsPreviousPathMock.mockReturnValue("/workspace/ws-9");
    windowStub.location.pathname = "/settings";

    const iterator = watchNavigateToSettingsSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getElectronHandler("navigate-to-settings");
    expect(handler(undefined).next()).toEqual({
      value: sagaEffects.call(gotoMock, "/workspace/ws-9"),
      done: false,
    });
  });

  it("navigates to settings when triggered outside the settings page", () => {
    windowStub.location.pathname = "/workspace/ws-current";

    const iterator = watchNavigateToSettingsSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getElectronHandler("navigate-to-settings");
    expect(handler(undefined).next()).toEqual({
      value: sagaEffects.call(navigateToSettingsMock),
      done: false,
    });
  });

  it("creates a terminal instead of an agent when terminal focus is active", () => {
    isFocusInTerminalMock.mockReturnValue(true);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    const iterator = watchMenuNewAgentSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getElectronHandler("menu:new-agent");
    const handlerIterator = handler(undefined);
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.call(isFocusInTerminalMock),
      done: false,
    });
    expect(handlerIterator.next(true)).toEqual({ value: undefined, done: true });
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "terminal:create-new" }),
    );
  });

  it("dispatches createAgentRequested when terminal focus is not active", () => {
    isFocusInTerminalMock.mockReturnValue(false);

    const iterator = watchMenuNewAgentSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getElectronHandler("menu:new-agent");
    const handlerIterator = handler(undefined);
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.call(isFocusInTerminalMock),
      done: false,
    });
    expect(handlerIterator.next(false)).toEqual({
      value: sagaEffects.select(selectActiveWorkspace.select),
      done: false,
    });
    expect(handlerIterator.next(reduxState.workspace.workspaces.map["ws-current"])).toEqual({
      value: sagaEffects.put(createAgentRequested("ws-current")),
      done: false,
    });
    expect(handlerIterator.next()).toEqual({ value: undefined, done: true });
  });

  it("reuses an existing browser tab when replace mode is requested", () => {
    const iterator = watchBrowserOpenTabSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getElectronHandler("browser:open-tab");
    const handlerIterator = handler({
        url: "https://augmentcode.com",
        position: "replace",
        workspaceId: "ws-target",
      });

    // The saga selects all tabs to find an existing browser tab
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.select(selectAllTabs.select, "ws-target"),
      done: false,
    });
    // Provide an existing browser tab
    expect(handlerIterator.next([{ id: "tab-1", type: "browser" }])).toEqual({
      value: sagaEffects.put(updateTabBrowserUrlAction("ws-target", "tab-1", "https://augmentcode.com")),
      done: false,
    });
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.put(setActiveTabAction("ws-target", "tab-1")),
      done: false,
    });
  });

  it("opens a browser tab in an adjacent panel by default", () => {
    const iterator = watchBrowserOpenTabSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getElectronHandler("browser:open-tab");
    const handlerIterator = handler({ url: "https://augmentcode.com" });
    // No workspaceId provided, so it selects the active workspace first
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.select(selectActiveWorkspace.select),
      done: false,
    });
    // After getting workspace, it dispatches openTabInAdjacentOrSplit via PUT
    const step = handlerIterator.next(reduxState.workspace.workspaces.map["ws-current"]);
    expect(step.done).toBe(false);
    const putEffect = step.value as any;
    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action).toEqual(
      expect.objectContaining({
        type: "panelLayout/openTabInAdjacentOrSplit",
        payload: expect.objectContaining({
          tab: expect.objectContaining({
            type: "browser",
            title: "Browser",
            browserUrl: "https://augmentcode.com",
            closable: true,
          }),
        }),
      }),
    );
  });

  it("opens the new space modal from workspace:create-for-repo with environment carry-over", () => {
    const iterator = watchWorkspaceCreateForRepoSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getWindowEventHandler("workspace:create-for-repo");
    const handlerIterator = handler({
      repositoryPath: "/repo/intent",
      workspaceId: "ws-old",
      workspaceTitle: "Old Space",
    });
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.select(selectActiveWorkspace.select),
      done: false,
    });
    expect(handlerIterator.next(reduxState.workspace.workspaces.map["ws-current"])).toEqual({
      value: sagaEffects.put(
        openNewSpaceModal({
          repoPath: "/repo/intent",
          environmentType: "remote",
          sshConfig: { host: "example.com" },
          previousWorkspaceId: "ws-old",
          previousWorkspaceTitle: "Old Space",
        }),
      ),
      done: false,
    });
  });

  it("opens the new space modal from app:open-new-space-modal", () => {
    const iterator = watchOpenNewSpaceModalSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getWindowEventHandler("app:open-new-space-modal");
    expect(
      handler({
        initialRepo: {
          repoPath: "/repo/intent",
          owner: "augmentcode",
          name: "intent",
        },
      }).next(),
    ).toEqual({
      value: sagaEffects.put(
        openNewSpaceModal({
          repoPath: "/repo/intent",
          owner: "augmentcode",
          name: "intent",
        }),
      ),
      done: false,
    });
  });

  describe("retroactiveAppLayoutMountCheckSaga", () => {
    it("forks workspace window events when a workspace is already active but no tasks exist", () => {
      const iterator = retroactiveAppLayoutMountCheckSaga();

      expect(iterator.next()).toEqual({
        value: sagaEffects.select(selectActiveWorkspaceId.select),
        done: false,
      });
      // Provide active workspace ID
      const forkResult = iterator.next("ws-current");
      expect(forkResult.done).toBe(false);
      expect((forkResult.value as any).type).toBe("FORK");
      expect((forkResult.value as any).payload.args[0]).toEqual(
        workspaceMounted("ws-current"),
      );
    });

    it("does nothing when no workspace is active", () => {
      const iterator = retroactiveAppLayoutMountCheckSaga();

      expect(iterator.next()).toEqual({
        value: sagaEffects.select(selectActiveWorkspaceId.select),
        done: false,
      });
      expect(iterator.next(null)).toEqual({ value: undefined, done: true });
    });

    it("skips invalid workspace IDs", () => {
      for (const invalidId of ["", "new", "optimistic-abc123", "undefined"]) {
        const iterator = retroactiveAppLayoutMountCheckSaga();
        iterator.next(); // select
        expect(iterator.next(invalidId)).toEqual({ value: undefined, done: true });
      }
    });
  });
});