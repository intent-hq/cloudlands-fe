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
  delay: function* (ms: number, val?: any) {
    return yield sagaEffects.delay(ms, val);
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
  takeEvery: function* (pattern: any, saga: any) {
    return yield sagaEffects.takeEvery(pattern, saga);
  },
}));

const { hasPanelLayoutManagerMock, getPanelLayoutManagerMock, getReduxStoreMock, dispatchMock, storeStateRef, selectSpecMock, selectPanelsMock, selectDeferSpecTabMock: selectDeferSpecTabSelectorMock, selectActiveWorkspaceIdMock } =
  vi.hoisted(() => {
    const dispatchMock = vi.fn();
    const storeStateRef = { current: {} as any };

    return {
      hasPanelLayoutManagerMock: vi.fn(),
      getPanelLayoutManagerMock: vi.fn(),
      dispatchMock,
      storeStateRef,
      getReduxStoreMock: vi.fn(() => ({
        getState: () => storeStateRef.current,
        dispatch: dispatchMock,
      })),
      selectSpecMock: vi.fn(() => undefined),
      selectPanelsMock: vi.fn(() => ({})),
      selectDeferSpecTabMock: vi.fn(() => false),
      selectActiveWorkspaceIdMock: vi.fn(() => null),
    };
  });

vi.mock("$features/layout/panel-layout-adapter", () => ({
  getPanelLayoutManager: getPanelLayoutManagerMock,
  hasPanelLayoutManager: hasPanelLayoutManagerMock,
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

vi.mock("$lib/store/slices/workspace-notes/workspace-notes-selectors", () => ({
  selectSpec: {
    select: (...args: any[]) => selectSpecMock(...args),
  },
}));

vi.mock("$lib/store/slices/panel-layout/panel-layout-selectors", () => ({
  selectPanels: {
    select: (...args: any[]) => selectPanelsMock(...args),
  },
  selectDeferSpecTab: {
    select: (...args: any[]) => selectDeferSpecTabSelectorMock(...args),
  },
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
  selectIsInitialSpecWriteInProgress: {
    select: vi.fn(() => false),
  },
}));

vi.mock("../../workspace/workspace-selectors", () => ({
  selectActiveWorkspaceId: {
    select: (...args: any[]) => selectActiveWorkspaceIdMock(...args),
  },
}));

import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import {
  cancelSpecPanelForWorkspaceSaga,
  specPanelSaga,
  specPanelForWorkspaceSaga,
  watchSpecPanelForWorkspace,
  retroactiveSpecPanelMountCheckSaga,
} from "./spec-panel-saga";

describe("specPanelSaga", () => {
  let setDeferSpecTabMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    storeStateRef.current = {};
    hasPanelLayoutManagerMock.mockReturnValue(true);
    setDeferSpecTabMock = vi.fn();
    getPanelLayoutManagerMock.mockReturnValue({
      isDeferringSpecTab: false,
      setDeferSpecTab: setDeferSpecTabMock,
      layout: { panels: {} },
      openTabInAdjacentOrSplit: vi.fn(),
    });

    // Default: no spec content, no panels, not deferring
    selectSpecMock.mockReturnValue(undefined);
    selectPanelsMock.mockReturnValue({});
    selectDeferSpecTabSelectorMock.mockReturnValue(false);

    // Stub sessionStorage
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  it("starts watching for workspace mount and unmount lifecycle actions, then forks retroactive check", () => {
    const iterator = specPanelSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(workspaceMounted, specPanelForWorkspaceSaga),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(workspaceUnmounted, cancelSpecPanelForWorkspaceSaga),
      done: false,
    });
    // Should fork the retroactive mount check
    const forkEffect = iterator.next();
    expect(forkEffect.done).toBe(false);
    expect((forkEffect.value as any)?.type).toBe("FORK");
  });

  it("registers the spec panel watcher on mount after restore status settles", () => {
    const task = { id: "mock-task" };
    const iterator = specPanelForWorkspaceSaga(workspaceMounted("ws-123"));

    // First: wait briefly for restore status to settle
    expect(iterator.next().done).toBe(false);

    // Then: call shouldDeferSpecPanel for a fresh workspace
    expect(iterator.next("empty").done).toBe(false);

    // shouldDeferSpecPanel returns false, but watcher still starts for fresh workspaces
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

  it("skips the watcher and cleans up deferral keys when layout was restored", () => {
    const iterator = specPanelForWorkspaceSaga(workspaceMounted("ws-restored"));

    expect(iterator.next().done).toBe(false);
    expect(iterator.next("restored")).toEqual({ value: undefined, done: true });

    expect(dispatchMock).toHaveBeenCalledWith({
      type: "workspace-agents/clearInitialAgentConfig",
      payload: ["ws-restored"],
    });
    expect(sessionStorage.removeItem).toHaveBeenCalledWith("workspace:ws-restored:agent-config");
    expect(sessionStorage.removeItem).toHaveBeenCalledWith("workspace:ws-restored:initial-agent-pending");
  });

  it("sets deferSpecTab in the parent saga when a fresh workspace should defer", () => {
    const task = { id: "mock-task" };
    const iterator = specPanelForWorkspaceSaga(workspaceMounted("ws-defer"));

    expect(iterator.next().done).toBe(false);
    expect(iterator.next("empty").done).toBe(false);
    const forkEffect = iterator.next(true);

    expect(forkEffect.done).toBe(false);
    expect(setDeferSpecTabMock).toHaveBeenCalledWith(true);
    expect(iterator.next(task)).toEqual({ value: undefined, done: true });
  });

  describe("watchSpecPanelForWorkspace — polling approach", () => {
    it("does not set deferSpecTab(true) on start", () => {
      const iterator = watchSpecPanelForWorkspace("ws-test");

      const firstStep = iterator.next();

      expect((firstStep.value as any)?.type).toBe("CALL");
      expect((firstStep.value as any)?.payload?.fn?.name).toBe("delayP");
      expect(setDeferSpecTabMock).not.toHaveBeenCalledWith(true);
    });

    it("calls slideInSpecPanel when spec content is available on first poll", () => {
      // Set up spec content via selector mock
      selectSpecMock.mockReturnValue({ content: "# My Spec\nSome content here" });

      const iterator = watchSpecPanelForWorkspace("ws-test");

      // Step through — the saga should find content on first poll and call slideInSpecPanel
      let step = iterator.next();
      while (!step.done) {
        const value = step.value as any;
        if (value?.type === "CALL") {
          // Should be calling slideInSpecPanel
          expect(value.payload?.args).toEqual(["ws-test"]);
          return;
        }
        step = iterator.next();
      }
      expect.fail("Expected a CALL to slideInSpecPanel but saga completed without one");
    });

    it("yields delay(2000) when no content found and keeps polling", () => {
      const iterator = watchSpecPanelForWorkspace("ws-test");

      // Step through effects looking for the delay effect (fn name is "delayP" in redux-saga)
      let step = iterator.next();
      let foundDelay = false;
      let iterations = 0;
      const MAX_ITERATIONS = 20;
      while (!step.done && iterations < MAX_ITERATIONS) {
        iterations++;
        const value = step.value as any;
        if (value?.type === "CALL" && value?.payload?.fn?.name === "delayP") {
          expect(value.payload.args[0]).toBe(2000);
          foundDelay = true;
          break;
        }
        step = iterator.next();
      }
      expect(foundDelay).toBe(true);
    });

    it("clears deferSpecTab in finally block on normal exit", () => {
      // Set up spec content so saga completes normally
      selectSpecMock.mockReturnValue({ content: "# Spec content" });

      const iterator = watchSpecPanelForWorkspace("ws-test");

      // Run to completion
      let step = iterator.next();
      while (!step.done) {
        step = iterator.next();
      }

      // setDeferSpecTab should have been called with false in the finally block
      expect(setDeferSpecTabMock).toHaveBeenCalledWith(false);
    });

    it("clears deferSpecTab in finally block on cancellation (via return)", () => {
      const iterator = watchSpecPanelForWorkspace("ws-test");

      // Start the saga
      iterator.next();

      // Simulate cancellation by calling return
      iterator.return(undefined);

      // setDeferSpecTab should have been called with false in the finally block
      expect(setDeferSpecTabMock).toHaveBeenCalledWith(false);
    });
  });

  describe("retroactiveSpecPanelMountCheckSaga", () => {
    it("does nothing when no active workspace", () => {
      selectActiveWorkspaceIdMock.mockReturnValue(null);

      const iterator = retroactiveSpecPanelMountCheckSaga();
      // select effect
      const selectEffect = iterator.next();
      expect(selectEffect.done).toBe(false);
      // provide null as the selected value — saga should return
      const result = iterator.next(null);
      expect(result.done).toBe(true);
    });

    it("skips invalid workspace IDs like 'new'", () => {
      selectActiveWorkspaceIdMock.mockReturnValue("new");

      const iterator = retroactiveSpecPanelMountCheckSaga();
      iterator.next(); // select effect
      const result = iterator.next("new");
      expect(result.done).toBe(true);
    });

    it("skips optimistic workspace IDs", () => {
      selectActiveWorkspaceIdMock.mockReturnValue("optimistic-123");

      const iterator = retroactiveSpecPanelMountCheckSaga();
      iterator.next(); // select effect
      const result = iterator.next("optimistic-123");
      expect(result.done).toBe(true);
    });

    it("forks specPanelForWorkspaceSaga when workspace is active but not yet tracked", () => {
      selectActiveWorkspaceIdMock.mockReturnValue("ws-already-mounted");

      const iterator = retroactiveSpecPanelMountCheckSaga();
      iterator.next(); // select effect
      const forkEffect = iterator.next("ws-already-mounted");
      expect(forkEffect.done).toBe(false);
      // Should be a FORK effect for specPanelForWorkspaceSaga
      expect((forkEffect.value as any)?.type).toBe("FORK");
      expect((forkEffect.value as any)?.payload?.args?.[0]).toEqual(
        workspaceMounted("ws-already-mounted")
      );
    });
  });
});

