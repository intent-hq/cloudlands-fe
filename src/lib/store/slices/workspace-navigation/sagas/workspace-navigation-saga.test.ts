import { beforeEach, describe, expect, it, vi } from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";
import { safeLocalStorage } from "$lib/utils/safe-storage";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  cancel: function* (task: any) {
    return yield { "@@redux-saga/IO": true, combinator: false, type: "CANCEL", payload: task };
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
  takeEvery: function* (pattern: any, saga: any, ...args: any[]) {
    return yield sagaEffects.takeEvery(pattern, saga, ...args);
  },
}));

const { takeEveryFromWindowEventMock } = vi.hoisted(() => ({
  takeEveryFromWindowEventMock: vi.fn(function* () {}),
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromWindowEvent: takeEveryFromWindowEventMock,
}));

import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { hydrateWorkspaceNavigation, openWorkspaceActivityChanges, openWorkspaceFile, updateWorkspaceCodeReview, workspaceNavigationStorageKey } from "../workspace-navigation-slice";
import { selectWorkspaceNavigationState } from "../workspace-navigation-selectors";
import { panelContextSaga } from "./panel-context-saga";
import { removeWorkspaceEntity } from "../../workspace/workspace-slice";
import { cleanupDeletedWorkspaceCacheSaga, hydrateWorkspaceNavigationStateSaga, persistWorkspaceNavigationSaga, retroactiveNavigationMountCheckSaga, watchNavigateToChangesSaga, watchOpenAcceptChangesSaga, watchOpenFileSaga, watchWorkspaceNavigationForWorkspaceSaga, watchWorkspaceNavigationLifecycleSaga, watchWorkspaceNavigationPersistenceSaga, workspaceNavigationSaga } from "./workspace-navigation-saga";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";

function getWindowHandler(eventName: string) {
  const call = takeEveryFromWindowEventMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (detail: any) => Generator;
}

describe("workspaceNavigationSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forks lifecycle and persistence watchers", () => {
    testSaga(workspaceNavigationSaga)
      .next()
      .fork(watchWorkspaceNavigationLifecycleSaga)
      .next()
      .fork(retroactiveNavigationMountCheckSaga)
      .next()
      .fork(watchWorkspaceNavigationPersistenceSaga)
      .next()
      .fork(panelContextSaga)
      .next()
      .isDone();
  });

  it("subscribes to workspace mount, unmount, and remove lifecycle actions", () => {
    const iterator = watchWorkspaceNavigationLifecycleSaga();

    expect((iterator.next().value as any).type).toBe("FORK");
    expect((iterator.next().value as any).type).toBe("FORK");
    expect((iterator.next().value as any).type).toBe("FORK");
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("cleans up navigation cache when a workspace is deleted via removeWorkspaceEntity", () => {
    const saga = cleanupDeletedWorkspaceCacheSaga(removeWorkspaceEntity("ws-deleted"));
    const result = saga.next();
    expect(result.done).toBe(true);
  });

  it("hydrates persisted workspace navigation state on mount before forking event watchers", () => {
    testSaga(watchWorkspaceNavigationForWorkspaceSaga, workspaceMounted("ws-1"))
      .next()
      .call(hydrateWorkspaceNavigationStateSaga, "ws-1")
      .next()
      .fork(watchOpenAcceptChangesSaga, "ws-1")
      .next();
  });

  it("loads persisted state from localStorage and dispatches hydrate", () => {
    const stored = {
      version: 2,
      workspace: { id: "ws-1", status: "ready" },
      mainPanel: { type: "notes", selectedNoteId: "note-1" },
      drawer: { open: false, type: null, itemId: null },
      navigation: { history: [], currentIndex: -1 },
      ui: { hasInitialized: true },
    };

    const iterator = hydrateWorkspaceNavigationStateSaga("ws-1");

    expect(iterator.next().value).toEqual(
      sagaEffects.call([safeLocalStorage, safeLocalStorage.getJSON], workspaceNavigationStorageKey("ws-1"))
    );

    const putEffect = iterator.next(stored).value as any;
    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action.type).toBe(hydrateWorkspaceNavigation.type);
    expect(putEffect.payload.action.payload[0]).toBe("ws-1");
    expect(putEffect.payload.action.payload[1].workspace).toEqual({
      id: "ws-1",
      status: "ready",
    });
    expect(putEffect.payload.action.payload[1].mainPanel).toMatchObject({
      type: "notes",
      selectedNoteId: "note-1",
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("registers a workspace:open-file listener that strips legacy @ prefixes", () => {
    testSaga(watchOpenFileSaga, "ws-1").next().isDone();
    expect(takeEveryFromWindowEventMock).toHaveBeenCalledWith("workspace:open-file", expect.any(Function), { capture: true });
    expect(getWindowHandler("workspace:open-file")({ path: "@src/main.ts", line: 12 }).next().value).toEqual(
      sagaEffects.put(openWorkspaceFile("ws-1", "src/main.ts", { line: 12 }))
    );
  });

  it("routes navigate-to-changes activity events into the slice", () => {
    testSaga(watchNavigateToChangesSaga, "ws-1").next().isDone();
    const event = { id: "evt-1", type: "file_changed", timestamp: 10 } as any;
    expect(
      getWindowHandler("workspace:navigate-to-changes")({ type: "activity-changes", event }).next().value
    ).toEqual(sagaEffects.put(openWorkspaceActivityChanges("ws-1", event)));
  });

  it("persists workspace navigation changes using the selector snapshot", () => {
    const workspaceState = {
      version: 2,
      workspace: { id: "ws-1", status: "ready" },
      mainPanel: { type: "notes", selectedNoteId: "spec" },
      drawer: { open: false, type: null, itemId: null },
      navigation: { history: [], currentIndex: -1 },
      ui: { hasInitialized: false },
    };

    testSaga(persistWorkspaceNavigationSaga, updateWorkspaceCodeReview("ws-1", { status: "running" }))
      .next()
      .select(selectWorkspaceNavigationState.select, "ws-1")
      .next(workspaceState)
      .call([safeLocalStorage, safeLocalStorage.setJSON], workspaceNavigationStorageKey("ws-1"), workspaceState)
      .next()
      .isDone();
  });

  describe("retroactiveNavigationMountCheckSaga", () => {
    it("forks navigation handlers when a workspace is already active but no tasks exist", () => {
      const iterator = retroactiveNavigationMountCheckSaga();

      expect(iterator.next()).toEqual({
        value: sagaEffects.select(selectActiveWorkspaceId.select),
        done: false,
      });
      const forkResult = iterator.next("ws-1");
      expect(forkResult.done).toBe(false);
      expect((forkResult.value as any).type).toBe("FORK");
      expect((forkResult.value as any).payload.args[0]).toEqual(
        workspaceMounted("ws-1"),
      );
    });

    it("does nothing when no workspace is active", () => {
      const iterator = retroactiveNavigationMountCheckSaga();

      expect(iterator.next()).toEqual({
        value: sagaEffects.select(selectActiveWorkspaceId.select),
        done: false,
      });
      expect(iterator.next(null)).toEqual({ value: undefined, done: true });
    });

    it("skips invalid workspace IDs", () => {
      for (const invalidId of ["", "new", "optimistic-abc123", "undefined"]) {
        const iterator = retroactiveNavigationMountCheckSaga();
        iterator.next(); // select
        expect(iterator.next(invalidId)).toEqual({ value: undefined, done: true });
      }
    });
  });
});

