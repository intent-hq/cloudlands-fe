import { beforeEach, describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";
import { eventChannel } from "redux-saga";

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
  delay: function* (ms: number, val?: any) {
    return yield sagaEffects.delay(ms, val);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  race: function* (effects: any) {
    return yield sagaEffects.race(effects);
  },
  take: function* (patternOrChannel: any) {
    return yield sagaEffects.take(patternOrChannel);
  },
  takeEvery: function* (pattern: any, saga: any) {
    return yield sagaEffects.takeEvery(pattern, saga);
  },
}));

const { createListenSyncChannelMock, hasPanelLayoutManagerMock, getPanelLayoutManagerMock, getReduxStoreMock } =
  vi.hoisted(() => ({
    createListenSyncChannelMock: vi.fn(),
    hasPanelLayoutManagerMock: vi.fn(),
    getPanelLayoutManagerMock: vi.fn(),
    getReduxStoreMock: vi.fn(() => ({
      getState: () => ({}),
      dispatch: vi.fn(),
    })),
  }));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  createListenSyncChannel: createListenSyncChannelMock,
}));

vi.mock("$features/layout/panel-layout-manager.svelte", () => ({
  getPanelLayoutManager: getPanelLayoutManagerMock,
  hasPanelLayoutManager: hasPanelLayoutManagerMock,
}));

vi.mock("$features/notes/notes.store.svelte", () => ({
  notesStateManager: { spec: null },
}));

vi.mock("$features/agent/services/unified-state-store", () => ({
  unifiedStateStore: {
    getInitialSpecWriteInProgress: vi.fn(() => false),
    getAgentsForWorkspace: vi.fn(() => []),
  },
}));

vi.mock("$shared/constants/notes", () => ({
  SPEC_NOTE_ID: "spec",
}));

vi.mock("$shared/types/branded-ids", () => ({
  WorkspaceId: (id: string) => id,
}));

vi.mock("$lib/store/redux-dispatch-bridge", () => ({
  getReduxStore: getReduxStoreMock,
}));

vi.mock("../../workspace-agents/workspace-agents-slice", () => ({
  clearInitialAgentConfig: vi.fn((wsId: string) => ({
    type: "workspace-agents/clearInitialAgentConfig",
    payload: [wsId],
  })),
}));

vi.mock("../../workspace-agents/workspace-agents-selectors", () => ({
  selectInitialAgentConfig: {
    select: vi.fn(() => null),
  },
}));

import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { notesStateManager } from "$features/notes/notes.store.svelte";
import {
  cancelSpecPanelForWorkspaceSaga,
  specPanelSaga,
  specPanelForWorkspaceSaga,
  watchSpecPanelForWorkspace,
} from "./spec-panel-saga";

describe("specPanelSaga", () => {
  let channel: ReturnType<typeof eventChannel>;
  let setDeferSpecTabMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    channel = eventChannel(() => () => {});
    vi.spyOn(channel, "close");
    createListenSyncChannelMock.mockReturnValue(channel);
    hasPanelLayoutManagerMock.mockReturnValue(true);
    setDeferSpecTabMock = vi.fn();
    getPanelLayoutManagerMock.mockReturnValue({
      isDeferringSpecTab: false,
      setDeferSpecTab: setDeferSpecTabMock,
      layout: { panels: {} },
      openTabInAdjacentOrSplit: vi.fn(),
    });

    // Stub sessionStorage
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    notesStateManager.spec = null;
  });

  it("starts watching for workspace mount and unmount lifecycle actions", () => {
    const iterator = specPanelSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(workspaceMounted, specPanelForWorkspaceSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(workspaceUnmounted, cancelSpecPanelForWorkspaceSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("registers the spec panel watcher on mount and cancels it on workspace unmount", () => {
    const task = { id: "mock-task" };
    const iterator = specPanelForWorkspaceSaga(workspaceMounted("ws-123"));

    // First: call shouldDeferSpecPanel
    const callEffect = iterator.next();
    expect(callEffect.done).toBe(false);

    // shouldDeferSpecPanel returns false
    const forkEffect = iterator.next(false);
    expect(forkEffect.done).toBe(false);

    // Should fork watchSpecPanelForWorkspace
    expect(iterator.next(task)).toEqual({ value: undefined, done: true });

    const cancelIterator = cancelSpecPanelForWorkspaceSaga(workspaceUnmounted("ws-123"));
    expect(cancelIterator.next()).toEqual({
      value: {
        "@@redux-saga/IO": true,
        combinator: false,
        type: "CANCEL",
        payload: task,
      },
      done: false,
    });
    expect(cancelIterator.next()).toEqual({ value: undefined, done: true });
    expect(setDeferSpecTabMock).toHaveBeenCalledWith(false);
  });

  describe("watchSpecPanelForWorkspace — first-write semantics", () => {
    it("does NOT include a fallback timer when isDeferring=false (existing workspace revisit)", () => {
      // Simulate an existing workspace where isDeferring is false
      getPanelLayoutManagerMock.mockReturnValue({
        isDeferringSpecTab: false,
        setDeferSpecTab: setDeferSpecTabMock,
        layout: { panels: {} },
        openTabInAdjacentOrSplit: vi.fn(),
      });

      const iterator = watchSpecPanelForWorkspace("ws-existing");

      // Step through until we hit the race effect
      let step = iterator.next();
      while (!step.done) {
        const value = step.value as any;
        // The race effect has type "RACE"
        if (value && value.type === "RACE") {
          const racePayload = value.payload;
          // Should have noteUpdated but NOT fallbackTimer, agentIdle, or safetyTimer
          expect(racePayload).toHaveProperty("noteUpdated");
          expect(racePayload).not.toHaveProperty("fallbackTimer");
          expect(racePayload).not.toHaveProperty("agentIdle");
          expect(racePayload).not.toHaveProperty("safetyTimer");
          return; // Test passes
        }
        step = iterator.next();
      }
      // If we get here, no RACE effect was found — fail
      expect.fail("Expected a RACE effect but saga completed without one");
    });

    it("includes fallback timer, agent:idle, and safety timer when isDeferring=true (new workspace)", () => {
      // Simulate a new workspace where isDeferring is true
      getPanelLayoutManagerMock.mockReturnValue({
        isDeferringSpecTab: true,
        setDeferSpecTab: setDeferSpecTabMock,
        layout: { panels: {} },
        openTabInAdjacentOrSplit: vi.fn(),
      });

      const iterator = watchSpecPanelForWorkspace("ws-new");

      // Step through until we hit the race effect
      let step = iterator.next();
      while (!step.done) {
        const value = step.value as any;
        if (value && value.type === "RACE") {
          const racePayload = value.payload;
          // Should have all four race branches
          expect(racePayload).toHaveProperty("noteUpdated");
          expect(racePayload).toHaveProperty("fallbackTimer");
          expect(racePayload).toHaveProperty("agentIdle");
          expect(racePayload).toHaveProperty("safetyTimer");
          return; // Test passes
        }
        step = iterator.next();
      }
      expect.fail("Expected a RACE effect but saga completed without one");
    });

    it("keeps waiting after the 8s fallback until the first spec write arrives", () => {
      getPanelLayoutManagerMock.mockReturnValue({
        isDeferringSpecTab: true,
        setDeferSpecTab: setDeferSpecTabMock,
        layout: { panels: {} },
        openTabInAdjacentOrSplit: vi.fn(),
      });
      notesStateManager.spec = { content: "" } as any;

      const iterator = watchSpecPanelForWorkspace("ws-slow");

      let step = iterator.next();
      while (!step.done) {
        const value = step.value as any;
        if (value?.type === "RACE") {
          step = iterator.next({ fallbackTimer: true });
          const continuedRace = step.value as any;
          expect(continuedRace?.type).toBe("RACE");
          expect(continuedRace.payload).toHaveProperty("noteUpdated");
          expect(continuedRace.payload).toHaveProperty("agentIdle");
          expect(continuedRace.payload).toHaveProperty("safetyTimer");
          expect(continuedRace.payload).not.toHaveProperty("fallbackTimer");

          notesStateManager.spec = { content: "Generated spec" } as any;
          const callEffect = iterator.next({ noteUpdated: true }).value as any;
          expect(callEffect?.type).toBe("CALL");
          expect(callEffect.payload?.fn?.name || "").toContain("slideIn");
          expect(callEffect.payload?.args).toEqual(["ws-slow"]);
          return;
        }

        step = iterator.next();
      }

      expect.fail("Expected a RACE effect but saga completed without one");
    });

    it("clears deferral on the safety timer if no spec write arrives after fallback", () => {
      getPanelLayoutManagerMock.mockReturnValue({
        isDeferringSpecTab: true,
        setDeferSpecTab: setDeferSpecTabMock,
        layout: { panels: {} },
        openTabInAdjacentOrSplit: vi.fn(),
      });
      notesStateManager.spec = { content: "" } as any;

      const iterator = watchSpecPanelForWorkspace("ws-slow");

      let step = iterator.next();
      while (!step.done) {
        const value = step.value as any;
        if (value?.type === "RACE") {
          step = iterator.next({ fallbackTimer: true });
          expect((step.value as any)?.type).toBe("RACE");
          expect(iterator.next({ safetyTimer: true })).toEqual({ value: undefined, done: true });
          expect(setDeferSpecTabMock).toHaveBeenCalledWith(false);
          return;
        }

        step = iterator.next();
      }

      expect.fail("Expected a RACE effect but saga completed without one");
    });

    it("calls openSpecNormally (not slideInSpecPanel) via note:updated on existing workspace (isDeferring=false)", () => {
      getPanelLayoutManagerMock.mockReturnValue({
        isDeferringSpecTab: false,
        setDeferSpecTab: setDeferSpecTabMock,
        layout: { panels: {} },
        openTabInAdjacentOrSplit: vi.fn(),
      });

      const iterator = watchSpecPanelForWorkspace("ws-existing");

      // Step through until we hit the race effect
      let step = iterator.next();
      while (!step.done) {
        const value = step.value as any;
        if (value && value.type === "RACE") {
          // Simulate noteUpdated winning the race
          step = iterator.next({ noteUpdated: true });
          // The next effect should be a CALL to openSpecNormally (not slideInSpecPanel)
          const callEffect = step.value as any;
          expect(callEffect).toBeDefined();
          expect(callEffect.type).toBe("CALL");
          // The called function should be openSpecNormally, not slideInSpecPanel
          const calledFn = callEffect.payload?.fn;
          expect(calledFn?.name || "").not.toContain("slideIn");
          // The args should include the workspace ID and isDeferring=false
          expect(callEffect.payload?.args).toEqual(["ws-existing", false]);
          return;
        }
        step = iterator.next();
      }
      expect.fail("Expected a RACE effect but saga completed without one");
    });

    it("existing workspace does NOT auto-open spec just because content exists (no fallback timer)", () => {
      // This is the key regression test: an existing workspace with spec content
      // should NOT auto-open the spec tab via a fallback timer.
      // Only note:updated events should trigger spec opening for existing workspaces.
      getPanelLayoutManagerMock.mockReturnValue({
        isDeferringSpecTab: false,
        setDeferSpecTab: setDeferSpecTabMock,
        layout: { panels: {} },
        openTabInAdjacentOrSplit: vi.fn(),
      });

      const iterator = watchSpecPanelForWorkspace("ws-existing");

      // Step through and verify no fallback timer is in the race
      let step = iterator.next();
      while (!step.done) {
        const value = step.value as any;
        if (value && value.type === "RACE") {
          const racePayload = value.payload;
          // The race should only contain noteUpdated — no timer-based auto-open
          expect(Object.keys(racePayload)).toEqual(["noteUpdated"]);
          return;
        }
        step = iterator.next();
      }
      expect.fail("Expected a RACE effect but saga completed without one");
    });
  });
});

