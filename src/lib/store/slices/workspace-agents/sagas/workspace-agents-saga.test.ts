import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import * as sagaEffects from "redux-saga/effects";

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
  disposeEventListenerMock,
  initEventListenerMock,
  loadStatusMock,
  sessionStoreSnapshotRef,
  sessionStoreSubscribersRef,
  sessionStoreSubscribeMock,
  getSessionForWorkspaceMock,
  getSessionMock,
  hasAgentMock,
  setWorkspaceMock,
  getSessionsForWorkspaceMock,
  activateInitialAgentMock,
  resumeSessionMock,
  reconnectStreamHandlersMock,
  getStoredAgentsFromDiskMock,
} = vi.hoisted(() => ({
  takeEveryFromElectronChannelMock: vi.fn(function* () {}),
  takeEveryFromWindowEventMock: vi.fn(function* () {}),
  disposeEventListenerMock: vi.fn(),
  initEventListenerMock: vi.fn(),
  loadStatusMock: vi.fn(),
  sessionStoreSnapshotRef: { current: { sessions: [] as any[] } },
  sessionStoreSubscribersRef: { current: [] as Array<(value: unknown) => void> },
  sessionStoreSubscribeMock: vi.fn((run: (value: unknown) => void) => {
    sessionStoreSubscribersRef.current.push(run);
    run(sessionStoreSnapshotRef.current);
    return () => {
      sessionStoreSubscribersRef.current = sessionStoreSubscribersRef.current.filter(
        (subscriber) => subscriber !== run
      );
    };
  }),
  getSessionForWorkspaceMock: vi.fn((_wsId: string, _agentId: string) => undefined),
  getSessionMock: vi.fn((_agentId: string) => null),
  hasAgentMock: vi.fn((_agentId: string) => false),
  setWorkspaceMock: vi.fn(),
  getSessionsForWorkspaceMock: vi.fn((_wsId: string) => []),
  activateInitialAgentMock: vi.fn(async () => null),
  resumeSessionMock: vi.fn(async () => null),
  reconnectStreamHandlersMock: vi.fn(async () => {}),
  getStoredAgentsFromDiskMock: vi.fn(async (_wsId: string) => []),
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: takeEveryFromElectronChannelMock,
  takeEveryFromWindowEvent: takeEveryFromWindowEventMock,
}));

vi.mock("$features/file-tracking/file-tracking.store.svelte", () => ({
  fileTrackingStore: {
    setWorkspace: setWorkspaceMock,
  },
}));

vi.mock("$features/git/git.store.svelte", () => ({
  gitStore: {
    disposeEventListener: disposeEventListenerMock,
    initEventListener: initEventListenerMock,
    loadStatus: loadStatusMock,
  },
}));

vi.mock("$features/agent/browser", () => ({
  sessionStore: {
    getStore: () => ({
      subscribe: sessionStoreSubscribeMock,
    }),
    getAllSessions: () => sessionStoreSnapshotRef.current.sessions,
    getAllSessionsAcrossWorkspaces: () => [],
    getSessionForWorkspace: getSessionForWorkspaceMock,
  },
}));

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

vi.mock("$features/layout/panel-layout-manager.svelte", () => ({
  hasPanelLayoutManager: () => false,
  getPanelLayoutManager: () => null,
}));

vi.mock("$features/workspace/workspace-storage-manager", () => ({
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
  getReduxStore: () => ({ getState: () => ({}), dispatch: vi.fn() }),
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
import {
  markAgentRecentlyCreated,
  removeAgent,
  replaceWorkspaceAgentSnapshots,
  renameAgent,
  setAgents,
  setAgentsLoaded,
  setInitialAgentConfig,
  setInitialAgentConfigProcessed,
  setInitialAgentId,
  setIsLoadingAgents,
  setWaitingForFirstMessage,
} from "../workspace-agents-slice";
import { lockUpdates, unlockUpdates } from "../../store-utility/store-utility-slice";
import { watchAgentCreationSaga } from "./agent-creation-saga";
import { loadAgentsFromDiskSaga, restoreInitialAgent } from "./agent-loading-saga";
import {
  cancelWorkspaceAgentEventsForWorkspaceSaga,
  recoverLateInitialAgentHydrationSaga,
  retroactiveWorkspaceMountCheckSaga,
  watchAgentDeletedSaga,
  watchFileTrackingLifecycleSaga,
  watchLateInitialAgentHydrationRecoverySaga,
  watchAgentRenamedSaga,
  watchSessionStoreSyncSaga,
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

function emitSessionStoreSnapshot(sessions: AgentSession[]) {
  sessionStoreSnapshotRef.current = { sessions };

  for (const subscriber of sessionStoreSubscribersRef.current) {
    subscriber(sessionStoreSnapshotRef.current);
  }
}

describe("workspaceAgentsSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStoreSnapshotRef.current = { sessions: [] };
    sessionStoreSubscribersRef.current = [];
    const windowStub = Object.assign(new EventTarget(), {
      electronAPI: {},
    }) as Window & typeof globalThis;
    vi.stubGlobal("window", windowStub);
    loadStatusMock.mockResolvedValue(undefined);
  });

  it("starts a workspace listener for every workspace mount", () => {
    const iterator = workspaceAgentsSaga();
    const effect = iterator.next().value as any;

    expect(effect.type).toBe("ALL");
  });

  it("registers agent watchers on mount and cancels them from the workspace unmount handler", () => {
    const fileTrackingTask = { type: "file-tracking-task" } as const;
    const drawerGuardTask = { type: "drawer-guard-task" } as const;
    const sessionStoreSyncTask = { type: "session-store-sync-task" } as const;
    const iterator = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-1"));

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

    expect(iterator.next()).toEqual({
      value: sagaEffects.fork(watchSessionStoreSyncSaga, "ws-1"),
      done: false,
    });

    expect(iterator.next(sessionStoreSyncTask)).toEqual({ value: undefined, done: true });

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
    expect(cancelIterator.next()).toEqual({
      value: cancelEffect(sessionStoreSyncTask),
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

    expect(getElectronHandler("agent:deleted")({ agentId: "agent-1", workspaceId: "ws-1" }).next()).toEqual({
      value: sagaEffects.put(removeAgent("ws-1", "agent-1")),
      done: false,
    });
  });

  it("handles agent:deleted events for any workspace", () => {
    const iterator = watchAgentDeletedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(getElectronHandler("agent:deleted")({ agentId: "agent-1", workspaceId: "ws-2" }).next()).toEqual({
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
    expect(
      getElectronHandler("agent:renamed")({
        payload: { agentId: "agent-1", workspaceId: "ws-1", name: "Renamed" },
      }).next()
    ).toEqual({
      value: sagaEffects.put(renameAgent("ws-1", "agent-1", "Renamed")),
      done: false,
    });
  });

  it("handles agent:renamed events for any workspace", () => {
    const iterator = watchAgentRenamedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(
      getElectronHandler("agent:renamed")({
        payload: { agentId: "agent-2", workspaceId: "ws-other", name: "Other" },
      }).next()
    ).toEqual({
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

  it("initializes file tracking on mount and disposes git listeners when cancelled", () => {
    const iterator = watchFileTrackingLifecycleSaga("ws-file-tracking");

    expect(iterator.next()).toEqual({
      value: sagaEffects.delay(50),
      done: false,
    });
    expect(setWorkspaceMock).toHaveBeenCalledWith("ws-file-tracking");

    const loadStatusEffect = iterator.next().value as any;
    expect(loadStatusEffect.type).toBe("CALL");
    expect(loadStatusEffect.payload.fn).toBe(loadStatusMock);
    expect(loadStatusEffect.payload.args).toEqual(["ws-file-tracking"]);

    const keepAliveEffect = iterator.next().value as any;
    expect(initEventListenerMock).toHaveBeenCalledWith("ws-file-tracking");
    expect(keepAliveEffect).toEqual(sagaEffects.delay(60_000));

    expect(iterator.return(undefined)).toEqual({
      value: undefined,
      done: true,
    });
    expect(disposeEventListenerMock).toHaveBeenCalledOnce();
  });

  it("skips file tracking setup for invalid workspace ids", () => {
    const iterator = watchFileTrackingLifecycleSaga("new");

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(setWorkspaceMock).not.toHaveBeenCalled();
    expect(loadStatusMock).not.toHaveBeenCalled();
    expect(initEventListenerMock).not.toHaveBeenCalled();
  });

  it("syncs full sessionStore snapshots across workspaces and marks new agents recently created", async () => {
    vi.useFakeTimers();

    try {
      const backgroundAgent = {
        ...mockAgent("agent-2", "ws-2", "Background"),
        isBackground: true,
      } satisfies AgentSession;

      sessionStoreSnapshotRef.current = {
        sessions: [
          mockAgent("agent-1", "ws-1"),
          backgroundAgent,
          mockAgent("terminal-1", "ws-1", "Terminal"),
        ],
      };

      const dispatched: unknown[] = [];
      const task = runSaga(
        {
          dispatch: (action) => {
            dispatched.push(action);
          },
          getState: () => ({}),
        },
        watchSessionStoreSyncSaga,
        "ws-1"
      );

      await vi.advanceTimersByTimeAsync(101);
      task.cancel();
      await task.toPromise();

      // The first sync should only dispatch replaceWorkspaceAgentSnapshots,
      // NOT markAgentRecentlyCreated — existing agents on first load are not "new".
      expect(dispatched).toEqual([
        replaceWorkspaceAgentSnapshots({
          "ws-1": [mockAgent("agent-1", "ws-1")],
          "ws-2": [backgroundAgent],
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("replaces dropped workspace buckets on later sessionStore snapshots without re-marking unchanged agents", async () => {
    vi.useFakeTimers();

    try {
      const ws1Agent = mockAgent("agent-1", "ws-1");
      const ws2Agent = mockAgent("agent-2", "ws-2");
      const ws3Agent = mockAgent("agent-3", "ws-3");

      emitSessionStoreSnapshot([ws1Agent, ws2Agent]);

      const dispatched: unknown[] = [];
      const task = runSaga(
        {
          dispatch: (action) => {
            dispatched.push(action);
          },
          getState: () => ({}),
        },
        watchSessionStoreSyncSaga,
        "ws-1"
      );

      await vi.advanceTimersByTimeAsync(101);

      emitSessionStoreSnapshot([ws1Agent, ws3Agent]);
      await vi.advanceTimersByTimeAsync(101);

      task.cancel();
      await task.toPromise();

      // First snapshot: no markAgentRecentlyCreated (existing agents are not "new").
      // Second snapshot: only agent-3 is truly new — agents 1 and 2 were in the first snapshot.
      expect(dispatched).toEqual([
        replaceWorkspaceAgentSnapshots({
          "ws-1": [ws1Agent],
          "ws-2": [ws2Agent],
        }),
        replaceWorkspaceAgentSnapshots({
          "ws-1": [ws1Agent],
          "ws-3": [ws3Agent],
        }),
        markAgentRecentlyCreated("ws-3", "agent-3"),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark hydrated agents as recently created when first sync sees empty store (hydration race)", async () => {
    vi.useFakeTimers();

    try {
      // First snapshot: empty store (hydration hasn't finished yet)
      sessionStoreSnapshotRef.current = { sessions: [] };

      const dispatched: unknown[] = [];
      const task = runSaga(
        {
          dispatch: (action) => {
            dispatched.push(action);
          },
          getState: () => ({}),
        },
        watchSessionStoreSyncSaga,
        "ws-1"
      );

      // Process empty snapshot
      await vi.advanceTimersByTimeAsync(101);

      // Second snapshot: hydration completes, agents appear
      const ws1Agent = mockAgent("agent-1", "ws-1");
      const ws2Agent = mockAgent("agent-2", "ws-2");
      emitSessionStoreSnapshot([ws1Agent, ws2Agent]);
      await vi.advanceTimersByTimeAsync(101);

      task.cancel();
      await task.toPromise();

      // The first sync sees an empty store and dispatches replaceWorkspaceAgentSnapshots({}).
      // The second sync sees hydrated agents — these should NOT be marked as recently
      // created because the previous snapshot was empty (hydration race).
      expect(dispatched).toEqual([
        replaceWorkspaceAgentSnapshots({}),
        replaceWorkspaceAgentSnapshots({
          "ws-1": [ws1Agent],
          "ws-2": [ws2Agent],
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears and reloads agents when switching between workspaces (regression: workspace-switch agent visibility)", () => {
    // Step 1: Mount workspace A — sets module-level previousMountedWorkspaceId
    const mountA = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-A"));
    // Step through all effects to completion (provide dummy task values)
    let step = mountA.next();
    while (!step.done) {
      step = mountA.next({} as any);
    }

    // Step 2: Mount workspace B — simulates A → B workspace switch.
    const mountB = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-B"));

    // handleWorkspaceChangeOnMount detects ws-A → ws-B (non-optimistic) and:
    // 1. Triggers memory cleanup
    const callEffect = mountB.next().value as any;
    expect(callEffect.type).toBe("CALL");

    const selectEffect = mountB.next().value as any;
    expect(selectEffect.type).toBe("SELECT");

    // 2. lockReactiveSelectors batches the agent-state resets so the sidebar
    //    never sees an intermediate empty state.
    //    The mock emits lockUpdates, then the inner puts, then unlockUpdates.
    expect(mountB.next(null)).toEqual({
      value: sagaEffects.put(lockUpdatesMock),
      done: false,
    });
    expect(mountB.next()).toEqual({
      value: sagaEffects.put(setAgentsLoaded("ws-B", false)),
      done: false,
    });
    expect(mountB.next()).toEqual({
      value: sagaEffects.put(setAgents("ws-B", [])),
      done: false,
    });
    expect(mountB.next()).toEqual({
      value: sagaEffects.put(setInitialAgentId("ws-B", null)),
      done: false,
    });
    expect(mountB.next()).toEqual({
      value: sagaEffects.put(setInitialAgentConfigProcessed("ws-B", false)),
      done: false,
    });
    expect(mountB.next()).toEqual({
      value: sagaEffects.put(unlockUpdatesMock),
      done: false,
    });

    // After handleWorkspaceChangeOnMount, the saga forks watchers for ws-B.
    // Skip through watcher forks to verify loadAgentsFromDiskSaga is forked for ws-B.
    const effects: any[] = [];
    step = mountB.next();
    while (!step.done) {
      effects.push(step.value);
      step = mountB.next({} as any);
    }

    // Verify loadAgentsFromDiskSaga("ws-B") was forked — this is the critical
    // effect that loads agents from disk and makes them visible in the sidebar.
    const loadAgentsFork = effects.find(
      (e) => e?.type === "FORK" && e?.payload?.fn === loadAgentsFromDiskSaga
    );
    expect(loadAgentsFork).toBeDefined();
    expect(loadAgentsFork.payload.args).toEqual(["ws-B"]);
  });

  it("batches workspace-switch agent clearing inside lockReactiveSelectors (regression: sidebar empty-state flash)", () => {
    // Mount workspace A first
    const mountA = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-race-A"));
    let step = mountA.next();
    while (!step.done) step = mountA.next({} as any);

    // Mount workspace B — triggers workspace switch
    const mountB = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-race-B"));

    // Collect all effects from handleWorkspaceChangeOnMount
    const effects: any[] = [];
    step = mountB.next();
    effects.push(step.value);
    step = mountB.next();
    effects.push(step.value);
    step = mountB.next(null);
    while (!step.done) {
      effects.push(step.value);
      step = mountB.next({} as any);
    }

    // Find the lockUpdates/unlockUpdates bracket.
    // sagaEffects.put() wraps the action under payload.action.
    const getActionType = (e: any) => e?.payload?.action?.type ?? e?.payload?.type;
    const lockIdx = effects.findIndex(
      (e) => e?.type === "PUT" && getActionType(e) === "storeUtility/lockUpdates"
    );
    const unlockIdx = effects.findIndex(
      (e) => e?.type === "PUT" && getActionType(e) === "storeUtility/unlockUpdates"
    );

    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(unlockIdx).toBeGreaterThan(lockIdx);

    // All agent-state resets must be between lock and unlock
    const batchedEffects = effects.slice(lockIdx + 1, unlockIdx);
    const batchedActionTypes = batchedEffects
      .filter((e) => e?.type === "PUT")
      .map((e) => getActionType(e));

    expect(batchedActionTypes).toContain("workspaceAgents/setAgentsLoaded");
    expect(batchedActionTypes).toContain("workspaceAgents/setAgents");
    expect(batchedActionTypes).toContain("workspaceAgents/setInitialAgentId");
    expect(batchedActionTypes).toContain("workspaceAgents/setInitialAgentConfigProcessed");
  });

  it("preserves a pre-hydrated initial agent id during workspace-switch clearing", () => {
    const mountA = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-existing"));
    let step = mountA.next();
    while (!step.done) {
      step = mountA.next({} as any);
    }

    const mountB = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-new"));

    const callEffect = mountB.next().value as any;
    expect(callEffect.type).toBe("CALL");

    const selectEffect = mountB.next().value as any;
    expect(selectEffect.type).toBe("SELECT");

    const effects: any[] = [];
    step = mountB.next("agent-new-1");
    while (!step.done) {
      effects.push(step.value);
      step = mountB.next({} as any);
    }

    const getActionType = (e: any) => e?.payload?.action?.type ?? e?.payload?.type;
    const batchedActionTypes = effects
      .filter((e) => e?.type === "PUT")
      .map((e) => getActionType(e));

    expect(batchedActionTypes).toContain("workspaceAgents/setAgentsLoaded");
    expect(batchedActionTypes).toContain("workspaceAgents/setAgents");
    expect(batchedActionTypes).toContain("workspaceAgents/setInitialAgentConfigProcessed");
    expect(batchedActionTypes).not.toContain("workspaceAgents/setInitialAgentId");
  });
});

describe("restoreInitialAgent — workspace-scoped session access", () => {
  it("uses sessionStore.getSessionForWorkspace(wsId, agentId) instead of global getSession", () => {
    const wsId = "ws-scoped-test";
    const initialAgentId = "agent-initial-1";
    const diskAgents = [
      { id: initialAgentId, name: "Initial Agent", workspaceId: wsId },
    ] as any[];
    const existingAgentIds = new Set<string>();

    const gen = restoreInitialAgent(wsId, initialAgentId, diskAgents, existingAgentIds);

    // The first yielded effect must be a CALL to sessionStore.getSessionForWorkspace,
    // NOT agentService.getSession (which depends on global current workspace).
    const firstEffect = gen.next().value as any;

    expect(firstEffect.type).toBe("CALL");
    const { fn, args } = firstEffect.payload;
    expect(fn).toBe(getSessionForWorkspaceMock);
    expect(args).toEqual([wsId, initialAgentId]);
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
    // Feed undefined (no existing session) to the getSessionForWorkspace call
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
            agents: { ids: [], map: {} },
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
            agents: { ids: [], map: {} },
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
            agents: { ids: [], map: {} },
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
    const first = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-dedup"));
    const firstStep = first.next();
    // Verify first mount proceeds normally (first yield is a fork)
    expect(firstStep.done).toBe(false);

    // Second mount for the same workspace ID should return immediately
    // because the first mount already registered the sentinel.
    const second = watchWorkspaceAgentEventsForWorkspaceSaga(workspaceMounted("ws-dedup"));
    const secondStep = second.next();
    expect(secondStep.done).toBe(true);
  });
});
