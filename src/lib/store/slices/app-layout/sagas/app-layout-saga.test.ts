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
  getFileExtensionMock,
  getPanelLayoutManagerMock,
  getSettingsPreviousPathMock,
  gotoMock,
  hasPanelLayoutManagerMock,
  isFocusInTerminalMock,
  navigateToSettingsMock,
  trackMock,
  windowStub,
  workspaceStoreMock,
} = vi.hoisted(() => {
  const location = { pathname: "/" };

  return {
    takeEveryFromElectronChannelMock: vi.fn(function* () {}),
    takeEveryFromWindowEventMock: vi.fn(function* () {}),
    createDockNavigationWatcherMock: vi.fn(),
    getFileExtensionMock: vi.fn(),
    getPanelLayoutManagerMock: vi.fn(),
    getSettingsPreviousPathMock: vi.fn(),
    gotoMock: vi.fn(),
    hasPanelLayoutManagerMock: vi.fn(),
    isFocusInTerminalMock: vi.fn(),
    navigateToSettingsMock: vi.fn(),
    trackMock: vi.fn(),
    windowStub: {
      electronAPI: {},
      location,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    },
    workspaceStoreMock: {
      current: {
        id: "ws-current",
        environmentConfig: {
          type: "remote",
          ssh: { host: "example.com" },
        },
      },
    },
  };
});

vi.mock("$app/navigation", () => ({
  goto: gotoMock,
}));

vi.mock("$features/layout/panel-layout-manager.svelte", () => ({
  getPanelLayoutManager: getPanelLayoutManagerMock,
  hasPanelLayoutManager: hasPanelLayoutManagerMock,
}));

vi.mock("$features/workspace/workspace.store.svelte", () => ({
  workspaceStore: workspaceStoreMock,
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
import { createNoteRequested } from "../../note-read-tracking/note-read-tracking-slice";
import { createTerminalRequested } from "../../terminals/terminals-slice";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { createAgentRequested } from "../../workspace-agents/workspace-agents-slice";
import {
  appLayoutSaga,
  cancelWorkspaceWindowEventsForWorkspaceSaga,
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
    workspaceStoreMock.current = {
      id: "ws-current",
      notes: [{ id: "note-1", title: "Note One" }],
      agents: [{ id: "agent-1", title: "Agent One", name: "Agent One" }],
      environmentConfig: {
        type: "remote",
        ssh: { host: "example.com" },
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
    const manager = {
      layout: {
        panels: {
          "panel-1": {
            tabs: [{ id: "tab-1", type: "agent", agentId: "agent-1" }],
            activeTabId: null,
          },
        },
      },
      focusPanel: vi.fn(),
      setActiveTab: vi.fn(),
      openTab: vi.fn(),
    };
    getPanelLayoutManagerMock.mockReturnValue(manager);

    const iterator = watchShowAgentSaga("ws-current");

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(takeEveryFromWindowEventMock).toHaveBeenCalledWith(
      "workspace:show-agent",
      expect.any(Function),
    );

    const handler = getWindowEventHandler("workspace:show-agent");
    expect(handler({ agentId: "agent-1" }).next()).toEqual({ value: undefined, done: true });

    expect(manager.focusPanel).toHaveBeenCalledWith("panel-1");
    expect(manager.setActiveTab).toHaveBeenCalledWith("tab-1", "panel-1");
    expect(manager.openTab).not.toHaveBeenCalled();
  });

  it("opens files through the panel layout manager and tracks analytics", () => {
    const manager = {
      openTab: vi.fn(),
      openTabInAdjacentOrSplit: vi.fn(),
      focusedPanelId: "panel-2",
    };
    getPanelLayoutManagerMock.mockReturnValue(manager);

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

    expect(manager.openTabInAdjacentOrSplit).toHaveBeenCalledWith(
      {
        type: "file",
        title: "main.ts",
        filePath: "src/main.ts",
        closable: true,
      },
      "panel-1",
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
    const manager = {
      getPanel: vi.fn().mockReturnValue({
        tabs: [{ id: "tab-agent", type: "agent" }],
        activeTabId: "tab-agent",
      }),
      openTab: vi.fn(),
      openTabInAdjacentOrSplit: vi.fn(),
      focusedPanelId: "panel-2",
    };
    getPanelLayoutManagerMock.mockReturnValue(manager);

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

    expect(manager.openTabInAdjacentOrSplit).toHaveBeenCalledWith(
      {
        type: "note",
        title: "Note One",
        noteId: "note-1",
        closable: true,
      },
      "panel-1",
    );
    expect(manager.openTab).not.toHaveBeenCalled();
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
      value: sagaEffects.put(createAgentRequested("ws-current")),
      done: false,
    });
    expect(handlerIterator.next()).toEqual({ value: undefined, done: true });
  });

  it("reuses an existing browser tab when replace mode is requested", () => {
    const manager = {
      allOpenTabs: [{ id: "tab-1", type: "browser" }],
      updateTabBrowserUrl: vi.fn(),
      setActiveTab: vi.fn(),
      openBrowserPanel: vi.fn(),
      openTabInAdjacentOrSplit: vi.fn(),
      closeActiveTab: vi.fn(),
      reopenClosedTab: vi.fn(),
      selectPreviousTab: vi.fn(),
      selectNextTab: vi.fn(),
    };
    getPanelLayoutManagerMock.mockReturnValue(manager);

    const iterator = watchBrowserOpenTabSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getElectronHandler("browser:open-tab");
    const handlerIterator = handler({
        url: "https://augmentcode.com",
        position: "replace",
        workspaceId: "ws-target",
      });

    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.call(
        [manager, manager.updateTabBrowserUrl],
        "tab-1",
        "https://augmentcode.com",
      ),
      done: false,
    });
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.call([manager, manager.setActiveTab], "tab-1"),
      done: false,
    });
  });

  it("opens a browser tab in an adjacent panel by default", () => {
    const manager = {
      allOpenTabs: [],
      updateTabBrowserUrl: vi.fn(),
      setActiveTab: vi.fn(),
      openBrowserPanel: vi.fn(),
      openTabInAdjacentOrSplit: vi.fn(),
      closeActiveTab: vi.fn(),
      reopenClosedTab: vi.fn(),
      selectPreviousTab: vi.fn(),
      selectNextTab: vi.fn(),
    };
    getPanelLayoutManagerMock.mockReturnValue(manager);

    const iterator = watchBrowserOpenTabSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getElectronHandler("browser:open-tab");
    expect(handler({ url: "https://augmentcode.com" }).next()).toEqual({
      value: sagaEffects.call(
        { context: manager, fn: manager.openTabInAdjacentOrSplit },
        {
          type: "browser",
          title: "Browser",
          browserUrl: "https://augmentcode.com",
          closable: true,
        },
      ),
      done: false,
    });
  });

  it("opens the new space modal from workspace:create-for-repo with environment carry-over", () => {
    const iterator = watchWorkspaceCreateForRepoSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handler = getWindowEventHandler("workspace:create-for-repo");
    expect(
      handler({
        repositoryPath: "/repo/intent",
        workspaceId: "ws-old",
        workspaceTitle: "Old Space",
      }).next(),
    ).toEqual({
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
});