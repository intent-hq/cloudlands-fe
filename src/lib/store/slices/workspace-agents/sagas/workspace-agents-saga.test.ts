import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import * as sagaEffects from "redux-saga/effects";
import { loadGitStatus } from "$lib/store/slices/git/git-slice";
import { initWorkspace as initFileTracking } from "$lib/store/slices/file-tracking/file-tracking-slice";

function cancelEffect(task: unknown) {
  return {
    type: "CANCEL",
    payload: task,
  };
}

vi.mock("typed-redux-saga", () => ({
  all: function* (effects: any) {
    return yield sagaEffects.all(effects);
  },
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  cancel: function* (task: any) {
    return yield cancelEffect(task);
  },
  delay: function* (ms: any) {
    return yield sagaEffects.delay(ms);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any) {
    return yield sagaEffects.select(selector);
  },
  take: function* (patternOrChannel: any) {
    return yield sagaEffects.take(patternOrChannel);
  },
  takeEvery: function* (pattern: any, saga: any) {
    return yield sagaEffects.takeEvery(pattern, saga);
  },
}));

const {
  takeEveryFromElectronChannelMock,
  takeEveryFromWindowEventMock,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  disposeEventListenerMock,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  initEventListenerMock,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadStatusMock,
  getSessionMock,
  hasAgentMock,
  setWorkspaceMock,
  getSessionsForWorkspaceMock,
  activateInitialAgentMock,
  resumeSessionMock,
  reconnectStreamHandlersMock,
  getStoredAgentsFromDiskMock,
  hasPanelLayoutManagerMock,
  getPanelLayoutManagerMock,
  getReduxStateMock,
} = vi.hoisted(() => ({
  takeEveryFromElectronChannelMock: vi.fn(function* () {}),
  takeEveryFromWindowEventMock: vi.fn(function* () {}),
  disposeEventListenerMock: vi.fn(),
  initEventListenerMock: vi.fn(),
  loadStatusMock: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getSessionMock: vi.fn((_agentId: string) => null),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  hasAgentMock: vi.fn((_agentId: string) => false),
  setWorkspaceMock: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getSessionsForWorkspaceMock: vi.fn((_wsId: string) => []),
  activateInitialAgentMock: vi.fn(async () => null),
  resumeSessionMock: vi.fn(async () => null),
  reconnectStreamHandlersMock: vi.fn(async () => {}),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getStoredAgentsFromDiskMock: vi.fn(async (_wsId: string) => []),
  hasPanelLayoutManagerMock: vi.fn(() => false),
  getPanelLayoutManagerMock: vi.fn(() => ({
    focusPanel: vi.fn(),
    setActiveTab: vi.fn(),
    openTab: vi.fn(),
    openTabInAdjacentOrSplit: vi.fn(),
    reconcileStaleAgentTabs: vi.fn(),
  })),
  getReduxStateMock: vi.fn(() => ({})),
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: takeEveryFromElectronChannelMock,
  takeEveryFromWindowEvent: takeEveryFromWindowEventMock,
}));

// fileTrackingStore mock removed — now uses Redux (file-tracking slice + saga)

// gitStore has been migrated to Redux (git slice + saga)

vi.mock("$features/agent/agent.service", () => ({
  agentService: {
    getSession: getSessionMock,
    hasAgent: hasAgentMock,
    getSessionsForWorkspace: getSessionsForWorkspaceMock,
    activateInitialAgent: activateInitialAgentMock,
    resumeSession: resumeSessionMock,
    reconnectStreamHandlersForWorkspace: reconnectStreamHandlersMock,
  },
}));

vi.mock("$lib/utils/agent-loader", () => ({
  getStoredAgentsFromDisk: getStoredAgentsFromDiskMock,
}));

vi.mock("$features/layout/panel-layout-adapter", () => ({
  hasPanelLayoutManager: hasPanelLayoutManagerMock,
  getPanelLayoutManager: getPanelLayoutManagerMock,
}));

vi.mock("$lib/store/slices/workspace/utils/workspace-storage-manager", () => ({
  workspaceStorageManager: { loadState: () => null },
}));

vi.mock("$lib/store/slices/app-layout/sagas/spec-panel-saga", () => ({
  shouldDeferSpecPanel: () => false,
}));

vi.mock("$lib/utils/agent-subscription.svelte", () => ({
  acquireAgentLoadLock: async () => {},
  releaseAgentLoadLock: async () => {},
}));

vi.mock("$lib/store/redux-dispatch-bridge", () => ({
  getReduxStore: () => ({ getState: getReduxStateMock, dispatch: vi.fn() }),
}));

// lockReactiveSelectors: pass-through mock that executes the handler directly.
// In tests we track the lock/unlock actions to verify batching.
const { lockUpdatesMock, unlockUpdatesMock } = vi.hoisted(() => {
  const lockUpdatesMock = { type: "storeUtility/lockUpdates", payload: [] };
  const unlockUpdatesMock = { type: "storeUtility/unlockUpdates", payload: [] };
  return { lockUpdatesMock, unlockUpdatesMock };
});

vi.mock("../../store-utility/sagas/lock-reactive-selectors", () => ({
  lockReactiveSelectors: function* (handler: () => Generator) {
    yield sagaEffects.put(lockUpdatesMock);
    yield* handler();
    yield sagaEffects.put(unlockUpdatesMock);
  },
}));

import type { AgentSession, AgentStatus } from "$shared/types";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { clearCurrentlyViewed } from "../../note-read-tracking/note-read-tracking-slice";
import { clearWorkspaceUnread } from "../../unread-tracking/unread-tracking-slice";
import {
  removeAgent,
  renameAgent,
  setAgents,
  setAgentsLoaded,
  setInitialAgentConfig,
  setInitialAgentConfigProcessed,
  setInitialAgentId,
  setIsLoadingAgents,
  setWaitingForFirstMessage,
} from "../workspace-agents-slice";
import {
  removeSession as removeAgentSession,
  renameSession as renameAgentSession,
  removeWorkspaceSessions,
} from "../../agent-session/agent-session-slice";
import {
  ensureFallbackLayout,
  loadAgentsFromDiskSaga,
  restoreInitialAgent,
  restoreLayoutState,
  waitForPanelLayoutRestore,
} from "./agent-loading-saga";
import {
  cancelWorkspaceAgentEventsForWorkspaceSaga,
  recoverLateInitialAgentHydrationSaga,
  retroactiveWorkspaceMountCheckSaga,
  watchAgentDeletedSaga,
  watchFileTrackingLifecycleSaga,
  watchLateInitialAgentHydrationRecoverySaga,
  watchAgentRenamedSaga,
  watchWaitingForFirstMessageSaga,
  watchWorkspaceAgentEventsForWorkspaceSaga,
  workspaceAgentsSaga,
} from "./workspace-agents-saga";

function mockAgent(id: string, workspaceId: string, name = "Agent"): AgentSession {
  return {
    id,
    backendSessionId: null,
    workspaceId,
    name,
    status: "active" as AgentStatus,
    messages: [],
    createdAt: "2026-03-19T00:00:00.000Z",
    updatedAt: "2026-03-19T00:00:00.000Z",
  };
}

function getElectronHandler(eventName: string) {
  const call = takeEveryFromElectronChannelMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

function getWindowHandler(eventName: string) {
  const call = takeEveryFromWindowEventMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

describe("workspaceAgentsSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPanelLayoutManagerMock.mockReturnValue(false);
    getPanelLayoutManagerMock.mockReturnValue({
      focusPanel: vi.fn(),
      setActiveTab: vi.fn(),
      openTab: vi.fn(),
      openTabInAdjacentOrSplit: vi.fn(),
      reconcileStaleAgentTabs: vi.fn(),
    });
    getReduxStateMock.mockReturnValue({});
    const windowStub = Object.assign(new EventTarget(), {
      electronAPI: {},
    }) as Window & typeof globalThis;
    vi.stubGlobal("window", windowStub);
  });

  it("starts a workspace listener for every workspace mount", () => {
    const iterator = workspaceAgentsSaga();
    const effect = iterator.next().value as any;

    expect(effect.type).toBe("ALL");
  });

  it("registers agent watchers on mount and cancels them from the workspace unmount handler", () => {
    const fileTrackingTask = { type: "file-tracking-task" } as const;
    const drawerGuardTask = { type: "drawer-guard-task" } as const;
    const iterator = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-1"));

    // First effect: clearUnreadForMountedWorkspace -> put(clearWorkspaceUnread)
    expect(iterator.next()).toEqual({
      value: sagaEffects.put(clearWorkspaceUnread("ws-1")),
      done: false,
    });

    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchFileTrackingLifecycleSaga, "ws-1"),
      done: false,
    });

    const drawerGuardEffect = iterator.next(fileTrackingTask).value as any;
    expect(drawerGuardEffect.type).toBe("FORK");

    expect(iterator.next(drawerGuardTask)).toEqual({
      value: sagaEffects.fork(loadAgentsFromDiskSaga, "ws-1"),
      done: false,
    });

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const cancelIterator = cancelWorkspaceAgentEventsForWorkspaceSaga(workspaceUnmounted("ws-1"));

    expect(cancelIterator.next()).toEqual({
      value: sagaEffects.put(clearCurrentlyViewed()),
      done: false,
    });
    expect(cancelIterator.next()).toEqual({
      value: cancelEffect(fileTrackingTask),
      done: false,
    });
    expect(cancelIterator.next()).toEqual({
      value: cancelEffect(drawerGuardTask),
      done: false,
    });
    expect(cancelIterator.next()).toEqual({ value: undefined, done: true });
  });

  it("removes an agent when agent:deleted is received (global, uses payload workspaceId)", () => {
    const iterator = watchAgentDeletedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(takeEveryFromElectronChannelMock).toHaveBeenCalledWith(
      "agent:deleted",
      expect.any(Function),
    );

    const handler = getElectronHandler("agent:deleted")({ agentId: "agent-1", workspaceId: "ws-1" });
    // Dual-dispatch: agent-session first, then workspace-agents
    expect(handler.next()).toEqual({
      value: sagaEffects.put(removeAgentSession("agent-1")),
      done: false,
    });
    expect(handler.next()).toEqual({
      value: sagaEffects.put(removeAgent("ws-1", "agent-1")),
      done: false,
    });
  });

  it("handles agent:deleted events for any workspace", () => {
    const iterator = watchAgentDeletedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    const handler = getElectronHandler("agent:deleted")({ agentId: "agent-1", workspaceId: "ws-2" });
    expect(handler.next()).toEqual({
      value: sagaEffects.put(removeAgentSession("agent-1")),
      done: false,
    });
    expect(handler.next()).toEqual({
      value: sagaEffects.put(removeAgent("ws-2", "agent-1")),
      done: false,
    });
  });

  it("renames an agent when agent:renamed is received (global, uses payload workspaceId)", () => {
    const iterator = watchAgentRenamedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(takeEveryFromElectronChannelMock).toHaveBeenCalledWith(
      "agent:renamed",
      expect.any(Function),
    );
    const handler = getElectronHandler("agent:renamed")({
      payload: { agentId: "agent-1", workspaceId: "ws-1", name: "Renamed" },
    });
    // Dual-dispatch: agent-session first, then workspace-agents
    expect(handler.next()).toEqual({
      value: sagaEffects.put(renameAgentSession("agent-1", "Renamed")),
      done: false,
    });
    expect(handler.next()).toEqual({
      value: sagaEffects.put(renameAgent("ws-1", "agent-1", "Renamed")),
      done: false,
    });
  });

  it("handles agent:renamed events for any workspace", () => {
    const iterator = watchAgentRenamedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    const handler = getElectronHandler("agent:renamed")({
      payload: { agentId: "agent-2", workspaceId: "ws-other", name: "Other" },
    });
    expect(handler.next()).toEqual({
      value: sagaEffects.put(renameAgentSession("agent-2", "Other")),
      done: false,
    });
    expect(handler.next()).toEqual({
      value: sagaEffects.put(renameAgent("ws-other", "agent-2", "Other")),
      done: false,
    });
  });

  it("sets waiting-for-first-message (global, uses payload workspaceId)", () => {
    const iterator = watchWaitingForFirstMessageSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(takeEveryFromWindowEventMock).toHaveBeenCalledWith(
      "workspace:waiting-for-first-message",
      expect.any(Function),
    );

    expect(getWindowHandler("workspace:waiting-for-first-message")({ agentId: "agent-1", workspaceId: "ws-1" }).next()).toEqual({
      value: sagaEffects.put(setWaitingForFirstMessage("ws-1", "agent-1", true)),
      done: false,
    });
  });

  it("handles waiting-for-first-message events for any workspace", () => {
    const iterator = watchWaitingForFirstMessageSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(getWindowHandler("workspace:waiting-for-first-message")({ agentId: "agent-1", workspaceId: "ws-2" }).next()).toEqual({
      value: sagaEffects.put(setWaitingForFirstMessage("ws-2", "agent-1", true)),
      done: false,
    });
  });

  it("initializes file tracking on mount and dispatches loadGitStatus", () => {
    const iterator = watchFileTrackingLifecycleSaga("ws-file-tracking");

    // Should dispatch initFileTracking first
    const initEffect = iterator.next().value as any;
    expect(initEffect.type).toBe("PUT");
    expect(initEffect.payload.action).toEqual(initFileTracking("ws-file-tracking"));

    // Then delay
    expect(iterator.next()).toEqual({
      value: sagaEffects.delay(50),
      done: false,
    });

    // Should dispatch loadGitStatus via put
    const putEffect = iterator.next().value as any;
    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action).toEqual(loadGitStatus("ws-file-tracking"));

    // Should enter keep-alive loop
    const keepAliveEffect = iterator.next().value as any;
    expect(keepAliveEffect).toEqual(sagaEffects.delay(60_000));

    expect(iterator.return(undefined)).toEqual({
      value: undefined,
      done: true,
    });
  });

  it("skips file tracking setup for invalid workspace ids", () => {
    const iterator = watchFileTrackingLifecycleSaga("new");

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(setWorkspaceMock).not.toHaveBeenCalled();
  });

  it("loads agents for a new workspace when mounting (workspace-switch agent visibility)", () => {
    // Mount workspace B — should fork watchers and load agents
    const mountB = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-switch-B"));

    // First effect: clearUnreadForMountedWorkspace -> put(clearWorkspaceUnread)
    expect(mountB.next()).toEqual({
      value: sagaEffects.put(clearWorkspaceUnread("ws-switch-B")),
      done: false,
    });

    // Collect remaining effects
    const effects: any[] = [];
    let step = mountB.next();
    while (!step.done) {
      effects.push(step.value);
      step = mountB.next({} as any);
    }

    // Verify loadAgentsFromDiskSaga("ws-switch-B") was forked
    const loadAgentsFork = effects.find(
      (e) => e?.type === "FORK" && e?.payload?.fn === loadAgentsFromDiskSaga
    );
    expect(loadAgentsFork).toBeDefined();
    expect(loadAgentsFork.payload.args).toEqual(["ws-switch-B"]);
  });

  it("deduplicates mount for an already-watched workspace", () => {
    // Mount workspace A
    const mountA = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-dedup"));
    let step = mountA.next();
    while (!step.done) step = mountA.next({} as any);

    // Mount same workspace again — should return immediately (dedup guard)
    const mountA2 = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-dedup"));
    const result = mountA2.next();
    expect(result.done).toBe(true);
  });

  it("clears unread on workspace mount", () => {
    const mountB = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-unread-test"));

    expect(mountB.next()).toEqual({
      value: sagaEffects.put(clearWorkspaceUnread("ws-unread-test")),
      done: false,
    });
  });
});

describe("restoreInitialAgent — workspace-scoped session access", () => {
  it("uses Redux select for workspace-scoped agent lookup instead of global getSession", () => {
    const wsId = "ws-scoped-test";
    const initialAgentId = "agent-initial-1";
    const diskAgents = [
      { id: initialAgentId, name: "Initial Agent", workspaceId: wsId },
    ] as any[];
    const existingAgentIds = new Set<string>();

    const gen = restoreInitialAgent(wsId, initialAgentId, diskAgents, existingAgentIds);

    // The first yielded effect must be a SELECT (workspace-scoped Redux lookup),
    // NOT a CALL to sessionStore (which depends on global current workspace).
    const firstEffect = gen.next().value as any;

    expect(firstEffect.type).toBe("SELECT");
  });

  it("does not call agentService.getSession or hasAgent (global-scoped)", () => {
    const wsId = "ws-scoped-test-2";
    const initialAgentId = "agent-initial-2";
    const diskAgents = [
      { id: initialAgentId, name: "Initial Agent", workspaceId: wsId },
    ] as any[];
    const existingAgentIds = new Set<string>();

    // Walk the generator to completion, providing mock values
    const gen = restoreInitialAgent(wsId, initialAgentId, diskAgents, existingAgentIds);
    let result = gen.next();
    // Feed undefined (no existing session) to the select call
    result = gen.next(undefined);
    // Continue stepping until done, feeding null for remaining calls
    while (!result.done) {
      result = gen.next(null);
    }

    // Neither global-scoped method should have been called
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(hasAgentMock).not.toHaveBeenCalled();
  });
});

describe("late initial-agent hydration recovery", () => {
  it("re-runs agent loading when initialAgentId arrives after an empty loaded snapshot", () => {
    const gen = recoverLateInitialAgentHydrationSaga("ws-late");
    const initialState = {
      workspaceAgents: {
        byWorkspaceId: {
          "ws-late": {
            agentIds: [],
            agentsLoaded: true,
            isLoadingAgents: false,
            initialAgentId: "agent-late-1",
            initialAgentConfigProcessed: false,
            recentlyCreatedAgents: [],
            isWaitingForFirstMessage: {},
            initialAgentConfig: null,
          },
        },
      },
      agentSessions: { byAgentId: {}, agentIdsByWorkspace: {} },
    };

    const selectState = gen.next().value as any;
    expect(selectState.type).toBe("SELECT");

    expect(gen.next(initialState)).toEqual({
      value: sagaEffects.put(setAgentsLoaded("ws-late", false)),
      done: false,
    });

    expect(gen.next()).toEqual({
      value: sagaEffects.call(loadAgentsFromDiskSaga, "ws-late"),
      done: false,
    });

    expect(gen.next()).toEqual({ value: undefined, done: true });
  });

  it("waits for an in-flight load to finish before retrying recovery", () => {
    const gen = recoverLateInitialAgentHydrationSaga("ws-racing");
    const loadingState = {
      workspaceAgents: {
        byWorkspaceId: {
          "ws-racing": {
            agentIds: [],
            agentsLoaded: false,
            isLoadingAgents: true,
            initialAgentId: "agent-race-1",
            initialAgentConfigProcessed: false,
            recentlyCreatedAgents: [],
            isWaitingForFirstMessage: {},
            initialAgentConfig: null,
          },
        },
      },
      agentSessions: { byAgentId: {}, agentIdsByWorkspace: {} },
    };
    const settledState = {
      workspaceAgents: {
        byWorkspaceId: {
          "ws-racing": {
            ...loadingState.workspaceAgents.byWorkspaceId["ws-racing"],
            agentsLoaded: true,
            isLoadingAgents: false,
          },
        },
      },
      agentSessions: { byAgentId: {}, agentIdsByWorkspace: {} },
    };

    expect((gen.next().value as any).type).toBe("SELECT");
    expect((gen.next(loadingState).value as any).type).toBe("SELECT");

    expect(gen.next(true)).toEqual({
      value: sagaEffects.take(setIsLoadingAgents.type),
      done: false,
    });

    expect((gen.next(setIsLoadingAgents("other-ws", false)).value as any).type).toBe("SELECT");

    expect(gen.next(true)).toEqual({
      value: sagaEffects.take(setIsLoadingAgents.type),
      done: false,
    });

    expect((gen.next(setIsLoadingAgents("ws-racing", false)).value as any).type).toBe("SELECT");

    expect(gen.next(settledState)).toEqual({
      value: sagaEffects.put(setAgentsLoaded("ws-racing", false)),
      done: false,
    });

    expect(gen.next()).toEqual({
      value: sagaEffects.call(loadAgentsFromDiskSaga, "ws-racing"),
      done: false,
    });
  });

  it("hydrates a missing initialAgentId from late initialAgentConfig before recovering", () => {
    const gen = recoverLateInitialAgentHydrationSaga("ws-config-late");
    const initialState = {
      workspaceAgents: {
        byWorkspaceId: {
          "ws-config-late": {
            agentIds: [],
            agentsLoaded: true,
            isLoadingAgents: false,
            initialAgentId: null,
            initialAgentConfigProcessed: false,
            recentlyCreatedAgents: [],
            isWaitingForFirstMessage: {},
            initialAgentConfig: {
              agentId: "agent-from-config",
              config: {},
              timestamp: 1,
            },
          },
        },
      },
      agentSessions: { byAgentId: {}, agentIdsByWorkspace: {} },
    };

    expect((gen.next().value as any).type).toBe("SELECT");
    expect(gen.next(initialState)).toEqual({
      value: sagaEffects.put(setInitialAgentId("ws-config-late", "agent-from-config")),
      done: false,
    });
    expect(gen.next()).toEqual({ value: undefined, done: true });
  });

  it("cancels previous recovery task only for the same workspace (per-workspace tracking)", () => {
    const firstTask = { type: "recovery-task-1" } as const;
    const secondTask = { type: "recovery-task-2" } as const;
    const gen = watchLateInitialAgentHydrationRecoverySaga();

    expect(gen.next()).toEqual({
      value: sagaEffects.take([setInitialAgentId.type, setInitialAgentConfig.type]),
      done: false,
    });

    // First workspace triggers recovery
    expect(gen.next(setInitialAgentId("ws-a", "agent-1"))).toEqual({
      value: sagaEffects.fork(recoverLateInitialAgentHydrationSaga, "ws-a"),
      done: false,
    });

    expect(gen.next(firstTask)).toEqual({
      value: sagaEffects.take([setInitialAgentId.type, setInitialAgentConfig.type]),
      done: false,
    });

    // Different workspace does NOT cancel the first workspace's task
    expect(
      gen.next(
        setInitialAgentConfig("ws-b", {
          agentId: "agent-1",
          config: {},
          timestamp: 1,
        })
      )
    ).toEqual({
      value: sagaEffects.fork(recoverLateInitialAgentHydrationSaga, "ws-b"),
      done: false,
    });

    expect(gen.next(secondTask)).toEqual({
      value: sagaEffects.take([setInitialAgentId.type, setInitialAgentConfig.type]),
      done: false,
    });

    // Same workspace (ws-a) DOES cancel the previous task for ws-a
    expect(gen.next(setInitialAgentId("ws-a", "agent-2"))).toEqual({
      value: cancelEffect(firstTask),
      done: false,
    });

    expect(gen.next()).toEqual({
      value: sagaEffects.fork(recoverLateInitialAgentHydrationSaga, "ws-a"),
      done: false,
    });
  });
});

describe("loadAgentsFromDiskSaga — mount-race hardening", () => {
  it("skips loading when agents are already loaded for the workspace", () => {
    const gen = loadAgentsFromDiskSaga("ws-already-loaded");

    // First effect: select alreadyLoaded
    const selectLoaded = gen.next().value as any;
    expect(selectLoaded.type).toBe("SELECT");

    // Return true for alreadyLoaded
    const selectLoading = gen.next(true).value as any;
    expect(selectLoading.type).toBe("SELECT");

    // Return false for alreadyLoading — but alreadyLoaded is true, so saga exits
    const result = gen.next(false);
    expect(result.done).toBe(true);
  });

  it("skips loading when agents are already being loaded for the workspace (concurrent load prevention)", () => {
    const gen = loadAgentsFromDiskSaga("ws-concurrent");

    // First effect: select alreadyLoaded
    const selectLoaded = gen.next().value as any;
    expect(selectLoaded.type).toBe("SELECT");

    // Return false for alreadyLoaded
    const selectLoading = gen.next(false).value as any;
    expect(selectLoading.type).toBe("SELECT");

    // Return true for alreadyLoading — saga exits without starting a second load
    const result = gen.next(true);
    expect(result.done).toBe(true);
  });

  it("sets isLoadingAgents before async work begins (race guard)", () => {
    const gen = loadAgentsFromDiskSaga("ws-guard");

    // select alreadyLoaded
    gen.next();
    // select alreadyLoading
    gen.next(false);

    // Neither loaded nor loading — next effect must be setIsLoadingAgents(true)
    const putEffect = gen.next(false).value as any;
    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action).toEqual(setIsLoadingAgents("ws-guard", true));
  });

  it("publishes agents and agentsLoaded atomically inside lockReactiveSelectors (regression: sidebar empty-state flash)", async () => {
    vi.useFakeTimers();

    try {
      const agents = [mockAgent("agent-load-1", "ws-atomic")];
      getSessionsForWorkspaceMock.mockResolvedValue(agents);
      getStoredAgentsFromDiskMock.mockResolvedValue([]);

      const dispatched: unknown[] = [];
      const task = runSaga(
        {
          dispatch: (action) => {
            dispatched.push(action);
          },
          getState: () => ({
            workspaceAgents: { byWorkspaceId: {} },
          }),
        },
        loadAgentsFromDiskSaga,
        "ws-atomic"
      );

      await vi.runAllTimersAsync();
      await task.toPromise().catch(() => {});

      // Verify that lockUpdates appears before setAgents and setAgentsLoaded,
      // and unlockUpdates appears after them — proving atomic publication.
      const actionTypes = dispatched.map((a: any) => a.type);
      const lockIdx = actionTypes.indexOf("storeUtility/lockUpdates");
      const setAgentsIdx = actionTypes.indexOf("workspaceAgents/setAgents");
      const setLoadedIdx = actionTypes.indexOf("workspaceAgents/setAgentsLoaded");
      const unlockIdx = actionTypes.indexOf("storeUtility/unlockUpdates");

      // All four actions must be present
      expect(lockIdx).toBeGreaterThanOrEqual(0);
      expect(setAgentsIdx).toBeGreaterThan(lockIdx);
      expect(setLoadedIdx).toBeGreaterThan(lockIdx);
      expect(unlockIdx).toBeGreaterThan(setAgentsIdx);
      expect(unlockIdx).toBeGreaterThan(setLoadedIdx);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for panel-layout restore completion before mutating tabs", () => {
    const gen = loadAgentsFromDiskSaga("ws-restore-sync");

    expect((gen.next().value as any).type).toBe("SELECT");
    expect((gen.next(false).value as any).type).toBe("SELECT");
    expect(gen.next(false)).toEqual({
      value: sagaEffects.put(setIsLoadingAgents("ws-restore-sync", true)),
      done: false,
    });
    expect((gen.next().value as any).type).toBe("CALL");

    expect((gen.next().value as any).type).toBe("CALL");
    expect((gen.next([]).value as any).type).toBe("CALL");
    expect((gen.next({ getStoredAgentsFromDisk: getStoredAgentsFromDiskMock }).value as any).type).toBe("SELECT");
    expect((gen.next(null).value as any).type).toBe("CALL");
    expect((gen.next([]).value as any).type).toBe("CALL");
    expect((gen.next([]).value as any).type).toBe("PUT");
    expect((gen.next().value as any).type).toBe("PUT");
    expect((gen.next().value as any).type).toBe("PUT");
    expect((gen.next().value as any).type).toBe("PUT");
    expect((gen.next().value as any).type).toBe("PUT");

    expect(gen.next()).toEqual({
      value: sagaEffects.call(waitForPanelLayoutRestore, "ws-restore-sync"),
      done: false,
    });
  });
});

describe("agent-loading layout guards", () => {
  it("stops waiting once restore status is complete", () => {
    hasPanelLayoutManagerMock.mockReturnValue(true);

    const gen = waitForPanelLayoutRestore("ws-layout");

    expect((gen.next().value as any).type).toBe("SELECT");
    expect(gen.next({ hasTabs: false, restoreStatus: "restored" })).toEqual({ value: undefined, done: true });
  });

  it("polls while restore status is idle", () => {
    hasPanelLayoutManagerMock.mockReturnValue(true);

    const gen = waitForPanelLayoutRestore("ws-layout");

    expect((gen.next().value as any).type).toBe("SELECT");
    expect(gen.next({ hasTabs: false, restoreStatus: "idle" })).toEqual({
      value: sagaEffects.delay(100),
      done: false,
    });
    expect((gen.next().value as any).type).toBe("SELECT");
  });

  it("skips restoreLayoutState when layout tabs already exist", () => {
    hasPanelLayoutManagerMock.mockReturnValue(true);
    const openTabInAdjacentOrSplit = vi.fn();
    getPanelLayoutManagerMock.mockReturnValue({
      focusPanel: vi.fn(),
      setActiveTab: vi.fn(),
      openTab: vi.fn(),
      openTabInAdjacentOrSplit,
      reconcileStaleAgentTabs: vi.fn(),
    });
    getReduxStateMock.mockReturnValue({
      panelLayout: {
        byWorkspaceId: {
          "ws-layout": {
            panels: {
              "panel-1": {
                id: "panel-1",
                tabs: [{ id: "tab-1", type: "note", title: "Spec", noteId: "spec", closable: true }],
                activeTabId: "tab-1",
              },
            },
          },
        },
      },
    });

    restoreLayoutState("ws-layout", [], [], false, null);

    expect(openTabInAdjacentOrSplit).not.toHaveBeenCalled();
  });

  it("skips ensureFallbackLayout when layout tabs already exist", () => {
    hasPanelLayoutManagerMock.mockReturnValue(true);
    const openTabInAdjacentOrSplit = vi.fn();
    getPanelLayoutManagerMock.mockReturnValue({
      focusPanel: vi.fn(),
      setActiveTab: vi.fn(),
      openTab: vi.fn(),
      openTabInAdjacentOrSplit,
      reconcileStaleAgentTabs: vi.fn(),
    });
    getReduxStateMock.mockReturnValue({
      panelLayout: {
        byWorkspaceId: {
          "ws-layout": {
            panels: {
              "panel-1": {
                id: "panel-1",
                tabs: [{ id: "tab-1", type: "note", title: "Spec", noteId: "spec", closable: true }],
                activeTabId: "tab-1",
              },
            },
          },
        },
      },
    });

    ensureFallbackLayout("ws-layout", [], []);

    expect(openTabInAdjacentOrSplit).not.toHaveBeenCalled();
  });
});

describe("retroactiveWorkspaceMountCheckSaga — early workspaceMounted guard", () => {
  it("forks workspace watcher when a workspace is already mounted but agents not loaded", () => {
    const gen = retroactiveWorkspaceMountCheckSaga();

    // First effect: select activeWorkspaceId
    const selectEffect = gen.next().value as any;
    expect(selectEffect.type).toBe("SELECT");

    // Should fork watchWorkspaceAgentEventsForWorkspaceSaga with synthetic action
    const forkEffect = gen.next("ws-early").value as any;
    expect(forkEffect.type).toBe("FORK");
    expect(forkEffect.payload.fn).toBe(watchWorkspaceAgentEventsForWorkspaceSaga);
    expect(forkEffect.payload.args[0]).toEqual(workspaceMounted("ws-early"));

    expect(gen.next({}).done).toBe(true);
  });

  it("does nothing when no active workspace exists", () => {
    const gen = retroactiveWorkspaceMountCheckSaga();

    const selectEffect = gen.next().value as any;
    expect(selectEffect.type).toBe("SELECT");

    expect(gen.next(null).done).toBe(true);
  });

  it("does nothing when activeWorkspaceId is 'new'", () => {
    const gen = retroactiveWorkspaceMountCheckSaga();

    const selectEffect = gen.next().value as any;
    expect(selectEffect.type).toBe("SELECT");

    expect(gen.next("new").done).toBe(true);
  });

  it("does nothing when activeWorkspaceId is optimistic", () => {
    const gen = retroactiveWorkspaceMountCheckSaga();

    const selectEffect = gen.next().value as any;
    expect(selectEffect.type).toBe("SELECT");

    expect(gen.next("optimistic-abc123").done).toBe(true);
  });

  it("does nothing when activeWorkspaceId is 'undefined' (string)", () => {
    const gen = retroactiveWorkspaceMountCheckSaga();

    const selectEffect = gen.next().value as any;
    expect(selectEffect.type).toBe("SELECT");

    expect(gen.next("undefined").done).toBe(true);
  });
});

describe("watchWorkspaceAgentEventsForWorkspaceSaga — deduplication", () => {
  it("skips duplicate mount when a watcher is already running for the same workspace ID", () => {
    // First mount sets the sentinel in workspaceAgentTasks
    const first = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-dedup-2"));
    const firstStep = first.next();
    // Verify first mount proceeds normally (first yield is a fork)
    expect(firstStep.done).toBe(false);

    // Second mount for the same workspace ID should return immediately
    // because the first mount already registered the sentinel.
    const second = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-dedup-2"));
    const secondStep = second.next();
    expect(secondStep.done).toBe(true);
  });
});
