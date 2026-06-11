import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runSaga } from "redux-saga";
import { testSaga } from "redux-saga-test-plan";

const {
  activeStreamsListeners,
  startPollingMock,
  stopPollingMock,
} = vi.hoisted(() => ({
  activeStreamsListeners: new Set<() => void>(),
  startPollingMock: vi.fn(),
  stopPollingMock: vi.fn(),
}));

vi.mock("$features/agent/services/active-streams-tracker", () => ({
  activeStreamsTracker: {
    startPolling: startPollingMock,
    stopPolling: stopPollingMock,
    subscribe: (listener: () => void) => {
      activeStreamsListeners.add(listener);
      return () => activeStreamsListeners.delete(listener);
    },
  },
}));

import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";

import {
  getLocalStorageJSON,
  setLocalStorageItem,
  setLocalStorageJSON,
} from "$store/renderer/utils/safe-local-storage-saga";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import {
  hydrateWorkspaceSidebarUi,
  MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX,
  MULTISELECT_SIDEBAR_TAB_ORDER_KEY,
  PINNED_WORKSPACES_KEY,
  setMultiSelectSidebarSelectedTabs,
  setWorkspaceCollapsedNoteIds,
  setWorkspaceNoteOrder,
  bumpActiveStreamsVersion,
  togglePinWorkspace,
  WORKSPACE_COLLAPSED_NOTES_PREFIX,
  WORKSPACE_NOTE_ORDER_PREFIX,
} from "../sidebar-nav-slice";
import {
  selectMultiSelectSidebarSelectedTabIds,
  selectMultiSelectSidebarTabOrder,
  selectPinnedWorkspaceIds,
  selectWorkspaceCollapsedNoteIds,
  selectWorkspaceNoteOrder,
} from "../sidebar-nav-selectors";
import {
  hydrateActiveWorkspaceSidebarUiSaga,
  hydrateWorkspaceSidebarUiSaga,
  persistMultiSelectSidebarTabOrderSaga,
  persistWorkspaceCollapsedNotesSaga,
  persistWorkspaceNoteOrderSaga,
  persistWorkspaceSelectedTabsSaga,
  sidebarNavSaga,
  watchActiveStreamsTrackerSaga,
} from "./sidebar-nav-saga";

describe("sidebarNav persistence sagas", () => {
  beforeEach(() => {
    activeStreamsListeners.clear();
    startPollingMock.mockClear();
    stopPollingMock.mockClear();
  });

  it("replays persisted sidebar UI hydration for an already-active workspace", () => {
    testSaga(hydrateActiveWorkspaceSidebarUiSaga)
      .next()
      .select(selectActiveWorkspaceId.select)
      .next("ws-1")
      .call(hydrateWorkspaceSidebarUiSaga, workspaceMounted("ws-1"))
      .next()
      .isDone();
  });

  it("skips active workspace sidebar UI replay when there is no active workspace", () => {
    testSaga(hydrateActiveWorkspaceSidebarUiSaga)
      .next()
      .select(selectActiveWorkspaceId.select)
      .next(null)
      .isDone();
  });

  it("hydrates workspace sidebar UI persistence through safe storage helpers", () => {
    testSaga(hydrateWorkspaceSidebarUiSaga, workspaceMounted("ws-1"))
      .next()
      .call(getLocalStorageJSON, `${MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX}ws-1`)
      .next(["overview", "context"])
      .call(getLocalStorageJSON, `${WORKSPACE_NOTE_ORDER_PREFIX}ws-1`)
      .next(["spec", "note-1"])
      .call(getLocalStorageJSON, `${WORKSPACE_COLLAPSED_NOTES_PREFIX}ws-1`)
      .next(["note-1"])
      .put(
        hydrateWorkspaceSidebarUi("ws-1", {
          selectedTabIds: ["overview", "context"],
          noteOrder: ["spec", "note-1"],
          collapsedNoteIds: ["note-1"],
        })
      )
      .next()
      .isDone();
  });

  it("normalizes malformed workspace sidebar UI hydration data", () => {
    testSaga(hydrateWorkspaceSidebarUiSaga, workspaceMounted("ws-1"))
      .next()
      .call(getLocalStorageJSON, `${MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX}ws-1`)
      .next(["overview", 123, "context"])
      .call(getLocalStorageJSON, `${WORKSPACE_NOTE_ORDER_PREFIX}ws-1`)
      .next("not-an-array")
      .call(getLocalStorageJSON, `${WORKSPACE_COLLAPSED_NOTES_PREFIX}ws-1`)
      .next([false, "note-1"])
      .put(
        hydrateWorkspaceSidebarUi("ws-1", {
          selectedTabIds: ["overview", "context"],
          noteOrder: undefined,
          collapsedNoteIds: ["note-1"],
        })
      )
      .next()
      .isDone();
  });

  it("falls back to default workspace sidebar UI hydration when storage throws", () => {
    testSaga(hydrateWorkspaceSidebarUiSaga, workspaceMounted("ws-1"))
      .next()
      .call(getLocalStorageJSON, `${MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX}ws-1`)
      .throw(new Error("storage failure"))
      .call(getLocalStorageJSON, `${WORKSPACE_NOTE_ORDER_PREFIX}ws-1`)
      .throw(new Error("storage failure"))
      .call(getLocalStorageJSON, `${WORKSPACE_COLLAPSED_NOTES_PREFIX}ws-1`)
      .throw(new Error("storage failure"))
      .put(
        hydrateWorkspaceSidebarUi("ws-1", {
          selectedTabIds: undefined,
          noteOrder: undefined,
          collapsedNoteIds: undefined,
        })
      )
      .next()
      .isDone();
  });

  it("persists multiselect sidebar tab order and swallows storage failure", () => {
    testSaga(persistMultiSelectSidebarTabOrderSaga)
      .next()
      .select(selectMultiSelectSidebarTabOrder.select)
      .next(["overview", "context"])
      .call(setLocalStorageJSON, MULTISELECT_SIDEBAR_TAB_ORDER_KEY, ["overview", "context"])
      .throw(new Error("storage failure"))
      .isDone();
  });

  it("persists workspace selected tabs", () => {
    testSaga(persistWorkspaceSelectedTabsSaga, setMultiSelectSidebarSelectedTabs("ws-1", ["overview"]))
      .next()
      .select(selectMultiSelectSidebarSelectedTabIds.select, "ws-1")
      .next(["overview"])
      .call(setLocalStorageJSON, `${MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX}ws-1`, ["overview"])
      .next()
      .isDone();
  });

  it("persists workspace note order and swallows storage failure", () => {
    testSaga(persistWorkspaceNoteOrderSaga, setWorkspaceNoteOrder("ws-1", ["spec", "note-1"]))
      .next()
      .select(selectWorkspaceNoteOrder.select, "ws-1")
      .next(["spec", "note-1"])
      .call(setLocalStorageJSON, `${WORKSPACE_NOTE_ORDER_PREFIX}ws-1`, ["spec", "note-1"])
      .throw(new Error("storage failure"))
      .isDone();
  });

  it("persists workspace collapsed notes and swallows storage failure", () => {
    testSaga(persistWorkspaceCollapsedNotesSaga, setWorkspaceCollapsedNoteIds("ws-1", ["note-1"]))
      .next()
      .select(selectWorkspaceCollapsedNoteIds.select, "ws-1")
      .next(["note-1"])
      .call(setLocalStorageJSON, `${WORKSPACE_COLLAPSED_NOTES_PREFIX}ws-1`, ["note-1"])
      .throw(new Error("storage failure"))
      .isDone();
  });

  it("registers workspace sidebar UI persistence watchers", () => {
    const iterator = sidebarNavSaga();
    iterator.next();
    iterator.next();

    const effects = Array.from({ length: 10 }, () => iterator.next().value as any);
    const names = effects
      .filter((effect) => effect?.type === "FORK")
      .map((effect) => effect.payload.fn.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "persistMultiSelectSidebarTabOrder",
        "persistWorkspaceSelectedTabs",
        "persistWorkspaceNoteOrder",
        "persistWorkspaceCollapsedNotes",
      ])
    );
    expect(effects.some((effect) => effect?.payload?.args?.[0] === workspaceMounted)).toBe(true);
    expect(iterator.next().value).toMatchObject({
      type: "CALL",
      payload: { fn: hydrateActiveWorkspaceSidebarUiSaga },
    });
  });

  it("persists pinned workspaces from the full root saga despite long-running subscriptions (regression)", async () => {
    // Regression: initSubscriptions attaches the never-ending active-streams
    // watcher fork. When the root saga reached it via a blocking call() instead
    // of fork(), the persistence watchers below were never registered, so
    // pinned workspaces were never written to localStorage.
    await expectSaga(sidebarNavSaga)
      .provide([
        [matchers.select(selectActiveWorkspaceId.select), null],
        [matchers.select(selectPinnedWorkspaceIds.select), ["ws-1"]],
      ])
      .dispatch(togglePinWorkspace("ws-1"))
      .call(setLocalStorageItem, PINNED_WORKSPACES_KEY, JSON.stringify(["ws-1"]))
      .silentRun(100);
  });

  it("bridges active stream tracker callbacks through saga puts", async () => {
    const dispatched: any[] = [];
    const task = runSaga(
      { dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      watchActiveStreamsTrackerSaga,
    );

    await Promise.resolve();
    expect(startPollingMock).toHaveBeenCalledTimes(1);

    activeStreamsListeners.forEach((listener) => listener());
    await Promise.resolve();

    expect(dispatched).toContainEqual(bumpActiveStreamsVersion());
    task.cancel();
    await task.toPromise();
    expect(activeStreamsListeners.size).toBe(0);
    expect(stopPollingMock).toHaveBeenCalledTimes(1);
  });
});
