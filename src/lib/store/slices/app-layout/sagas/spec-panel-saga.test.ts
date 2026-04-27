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
  race: function* (effects: any) {
    return yield sagaEffects.race(effects);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  takeEvery: function* (pattern: any, saga: any) {
    return yield sagaEffects.takeEvery(pattern, saga);
  },
}));

const { getReduxStoreMock, dispatchMock, storeStateRef, selectSpecMock, selectPanelsMock, selectRestoreStatusMock, selectDeferSpecTabMock: selectDeferSpecTabSelectorMock, selectActiveWorkspaceIdMock } =
  vi.hoisted(() => {
    const dispatchMock = vi.fn();
    const storeStateRef = { current: {} as any };

    return {
      dispatchMock,
      storeStateRef,
      getReduxStoreMock: vi.fn(() => ({
        getState: () => storeStateRef.current,
        dispatch: dispatchMock,
      })),
      selectSpecMock: vi.fn(() => undefined),
      selectPanelsMock: vi.fn(() => ({})),
      selectRestoreStatusMock: vi.fn(() => "empty"),
      selectDeferSpecTabMock: vi.fn(() => false),
      selectActiveWorkspaceIdMock: vi.fn(() => null),
    };
  });

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
    effect: function* (...args: any[]) {
      return selectSpecMock(undefined, ...args);
    },
  },
}));

vi.mock("$lib/store/slices/panel-layout/panel-layout-selectors", () => ({
  selectPanels: {
    select: (...args: any[]) => selectPanelsMock(...args),
    effect: function* (...args: any[]) {
      return selectPanelsMock(undefined, ...args);
    },
  },
  selectRestoreStatus: {
    select: (...args: any[]) => selectRestoreStatusMock(...args),
    effect: function* (...args: any[]) {
      return selectRestoreStatusMock(undefined, ...args);
    },
  },
  selectDeferSpecTab: {
    select: (...args: any[]) => selectDeferSpecTabSelectorMock(...args),
    effect: function* (...args: any[]) {
      return selectDeferSpecTabSelectorMock(undefined, ...args);
    },
  },
}));

vi.mock("../../workspace-agents/workspace-agents-slice", () => ({
  clearInitialAgentConfig: vi.fn((wsId: string) => ({
    type: "workspace-agents/clearInitialAgentConfig",
    payload: [wsId],
  })),
}));

const { selectInitialAgentConfigMock, selectIsInitialSpecWriteInProgressMock } = vi.hoisted(() => ({
  selectInitialAgentConfigMock: vi.fn(() => null),
  selectIsInitialSpecWriteInProgressMock: vi.fn(() => false),
}));

vi.mock("../../workspace-agents/workspace-agents-selectors", () => ({
  selectInitialAgentConfig: {
    select: selectInitialAgentConfigMock,
    effect: function* (...args: any[]) {
      return selectInitialAgentConfigMock(undefined, ...args);
    },
  },
  selectIsInitialSpecWriteInProgress: {
    select: selectIsInitialSpecWriteInProgressMock,
    effect: function* (...args: any[]) {
      return selectIsInitialSpecWriteInProgressMock(undefined, ...args);
    },
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
import { setDeferSpecTab } from "$lib/store/slices/panel-layout/panel-layout-slice";

describe("specPanelSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeStateRef.current = {};

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

    // 1. CALL waitForRestoreStatusToSettle
    expect(iterator.next().done).toBe(false);
    // 2. CALL isSpecAlreadyOpen — provide restoreStatus="empty"
    expect(iterator.next("empty").done).toBe(false);
    // 3. CALL shouldDeferSpecPanel — provide specAlreadyOpen=false
    expect(iterator.next(false).done).toBe(false);
    // 4. CALL getSpecContent — provide shouldDefer=false
    expect(iterator.next(false).done).toBe(false);
    // 5. FORK watchSpecPanelForWorkspace — provide specContent=""
    const forkEffect = iterator.next("");
    expect(forkEffect.done).toBe(false);
    expect((forkEffect.value as any)?.type).toBe("FORK");

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
    // PUT setDeferSpecTab(wsId, false) before the saga returns
    const putStep = cancelIterator.next();
    expect((putStep.value as any)?.type).toBe("PUT");
    expect((putStep.value as any)?.payload?.action).toEqual(setDeferSpecTab("ws-123", false));
    expect(cancelIterator.next()).toEqual({ value: undefined, done: true });
  });

  it("trusts restored layouts without spec and does not re-open the spec tab", () => {
    const iterator = specPanelForWorkspaceSaga(workspaceMounted("ws-restored"));
    selectSpecMock.mockReturnValue({ content: "# Restored spec" });

    // 1. CALL waitForRestoreStatusToSettle
    expect(iterator.next().done).toBe(false);
    // 2. CALL isSpecAlreadyOpen — provide restoreStatus="restored"
    expect(iterator.next("restored").done).toBe(false);
    // 3. specAlreadyOpen=false, restoreStatus="restored" → done
    expect(iterator.next(false)).toEqual({ value: undefined, done: true });

    expect(dispatchMock).toHaveBeenCalledWith({
      type: "workspace-agents/clearInitialAgentConfig",
      payload: ["ws-restored"],
    });
    expect(sessionStorage.removeItem).toHaveBeenCalledWith("workspace:ws-restored:agent-config");
    expect(sessionStorage.removeItem).toHaveBeenCalledWith("workspace:ws-restored:initial-agent-pending");
    // The saga returned without dispatching openTabInAdjacentOrSplit (iterator already done)
  });

  it("skips re-opening when a restored layout already includes spec", () => {
    selectPanelsMock.mockReturnValue({
      "panel-1": {
        id: "panel-1",
        tabs: [{ id: "tab-spec", type: "note", title: "Spec", noteId: "spec", closable: true }],
        activeTabId: "tab-spec",
      },
    });

    const iterator = specPanelForWorkspaceSaga(workspaceMounted("ws-restored"));

    // 1. CALL waitForRestoreStatusToSettle
    expect(iterator.next().done).toBe(false);
    // 2. CALL isSpecAlreadyOpen — provide restoreStatus="restored"
    expect(iterator.next("restored").done).toBe(false);
    // 3. specAlreadyOpen=true → PUT setDeferSpecTab(wsId, false) then done
    const putStep = iterator.next(true);
    expect((putStep.value as any)?.type).toBe("PUT");
    expect((putStep.value as any)?.payload?.action).toEqual(setDeferSpecTab("ws-restored", false));
    expect(iterator.next()).toEqual({ value: undefined, done: true });

    expect(dispatchMock).toHaveBeenCalledWith({
      type: "workspace-agents/clearInitialAgentConfig",
      payload: ["ws-restored"],
    });
    expect(sessionStorage.removeItem).toHaveBeenCalledWith("workspace:ws-restored:agent-config");
    expect(sessionStorage.removeItem).toHaveBeenCalledWith("workspace:ws-restored:initial-agent-pending");
  });

  it("opens spec for empty or new layouts when content already exists", () => {
    const iterator = specPanelForWorkspaceSaga(workspaceMounted("ws-new-with-spec"));
    selectSpecMock.mockReturnValue({ content: "# Existing spec" });

    // 1. CALL waitForRestoreStatusToSettle
    expect(iterator.next().done).toBe(false);
    // 2. CALL isSpecAlreadyOpen — provide restoreStatus="empty"
    expect(iterator.next("empty").done).toBe(false);
    // 3. CALL shouldDeferSpecPanel — provide specAlreadyOpen=false
    expect(iterator.next(false).done).toBe(false);
    // 4. CALL getSpecContent — provide shouldDefer=false
    expect(iterator.next(false).done).toBe(false);
    // 5. CALL openSpecNormally — provide specContent="# Existing spec"
    const openEffect = iterator.next("# Existing spec");
    expect(openEffect.done).toBe(false);
    expect((openEffect.value as any)?.type).toBe("CALL");
    expect((openEffect.value as any)?.payload?.args).toEqual(["ws-new-with-spec", false]);
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("starts the watcher for empty or new layouts when spec is still empty", () => {
    const task = { id: "new-watch-task" };
    const iterator = specPanelForWorkspaceSaga(workspaceMounted("ws-new-empty"));

    // 1. CALL waitForRestoreStatusToSettle
    expect(iterator.next().done).toBe(false);
    // 2. CALL isSpecAlreadyOpen — provide restoreStatus="empty"
    expect(iterator.next("empty").done).toBe(false);
    // 3. CALL shouldDeferSpecPanel — provide specAlreadyOpen=false
    expect(iterator.next(false).done).toBe(false);
    // 4. CALL getSpecContent — provide shouldDefer=false
    expect(iterator.next(false).done).toBe(false);
    // 5. FORK watchSpecPanelForWorkspace — provide specContent=""
    const forkEffect = iterator.next("");

    expect(forkEffect.done).toBe(false);
    expect((forkEffect.value as any)?.type).toBe("FORK");
    expect(iterator.next(task)).toEqual({ value: undefined, done: true });
  });

  it("sets deferSpecTab in the parent saga when a fresh workspace should defer", () => {
    const task = { id: "mock-task" };
    const iterator = specPanelForWorkspaceSaga(workspaceMounted("ws-defer"));

    // 1. CALL waitForRestoreStatusToSettle
    expect(iterator.next().done).toBe(false);
    // 2. CALL isSpecAlreadyOpen — provide restoreStatus="empty"
    expect(iterator.next("empty").done).toBe(false);
    // 3. CALL shouldDeferSpecPanel — provide specAlreadyOpen=false
    expect(iterator.next(false).done).toBe(false);
    // 4. CALL getSpecContent — provide shouldDefer=true
    expect(iterator.next(true).done).toBe(false);
    // 5. PUT setDeferSpecTab(true) — provide specContent=""
    const putStep = iterator.next("");
    expect((putStep.value as any)?.type).toBe("PUT");
    expect((putStep.value as any)?.payload?.action).toEqual(setDeferSpecTab("ws-defer", true));
    // 6. FORK watchSpecPanelForWorkspace
    const forkEffect = iterator.next();
    expect(forkEffect.done).toBe(false);
    expect((forkEffect.value as any)?.type).toBe("FORK");
    expect(iterator.next(task)).toEqual({ value: undefined, done: true });
  });

  describe("watchSpecPanelForWorkspace — polling approach", () => {
    it("does not set deferSpecTab(true) on start", () => {
      const iterator = watchSpecPanelForWorkspace("ws-test");

      const firstStep = iterator.next();

      // First effect is now CALL getSpecContent (no PUT setDeferSpecTab(true) ever yielded)
      expect((firstStep.value as any)?.type).toBe("CALL");
      expect((firstStep.value as any)?.payload?.fn?.name).toBe("getSpecContent");
    });

    it("calls slideInSpecPanel when spec content is available on first poll", () => {
      const iterator = watchSpecPanelForWorkspace("ws-test");

      // Step 1: CALL getSpecContent
      const getContentStep = iterator.next();
      expect((getContentStep.value as any)?.type).toBe("CALL");
      expect((getContentStep.value as any)?.payload?.fn?.name).toBe("getSpecContent");

      // Step 2: provide content → CALL slideInSpecPanel
      const slideStep = iterator.next("# My Spec\nSome content here");
      expect((slideStep.value as any)?.type).toBe("CALL");
      expect((slideStep.value as any)?.payload?.fn?.name).toBe("slideInSpecPanel");
      expect((slideStep.value as any)?.payload?.args).toEqual(["ws-test"]);
    });

    it("yields delay(2000) when no content found and keeps polling", () => {
      const iterator = watchSpecPanelForWorkspace("ws-test");

      // Step 1: CALL getSpecContent
      const getContentStep = iterator.next();
      expect((getContentStep.value as any)?.type).toBe("CALL");
      expect((getContentStep.value as any)?.payload?.fn?.name).toBe("getSpecContent");

      // Step 2: provide empty content → CALL delay(2000)
      const delayStep = iterator.next("");
      expect((delayStep.value as any)?.type).toBe("CALL");
      expect((delayStep.value as any)?.payload?.fn?.name).toBe("delayP");
      expect((delayStep.value as any)?.payload?.args[0]).toBe(2000);
    });

    it("clears deferSpecTab in finally block on normal exit", () => {
      const iterator = watchSpecPanelForWorkspace("ws-test");

      // Step 1: CALL getSpecContent — provide content to make saga complete
      iterator.next();
      // Step 2: CALL slideInSpecPanel — provide undefined return
      iterator.next("# Spec content");
      // Step 3: slideInSpecPanel returns → finally runs → PUT setDeferSpecTab(false)
      const finallyStep = iterator.next();
      expect((finallyStep.value as any)?.type).toBe("PUT");
      expect((finallyStep.value as any)?.payload?.action).toEqual(setDeferSpecTab("ws-test", false));
      expect(iterator.next()).toEqual({ value: undefined, done: true });
    });

    it("clears deferSpecTab in finally block on cancellation (via return)", () => {
      const iterator = watchSpecPanelForWorkspace("ws-test");

      // Start the saga
      iterator.next();

      // Simulate cancellation by calling return — finally yields a PUT
      const finallyStep = iterator.return(undefined);
      expect((finallyStep.value as any)?.type).toBe("PUT");
      expect((finallyStep.value as any)?.payload?.action).toEqual(setDeferSpecTab("ws-test", false));
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

