import { beforeEach, describe, expect, it, vi } from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
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
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

const { takeEveryFromListenSyncMock, mockLoad } = vi.hoisted(() => ({
  takeEveryFromListenSyncMock: vi.fn(function* () {}),
  mockLoad: vi.fn(),
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromListenSync: takeEveryFromListenSyncMock,
}));

vi.mock("$features/workspace/first-visit-state.client", () => ({
  firstVisitStateClient: { load: mockLoad },
}));

import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { defaultPanelVisibility, setPanelVisibilityBulk, updateWorkspaceEntity } from "../workspace-slice";
import {
  workspaceSaga,
  watchWorkspaceUpdatedSaga,
  watchWorkspaceLifecycleSaga,
  handleFirstVisitHydration,
  mapFirstVisitToVisibility,
} from "./workspace-saga";
import type { FirstVisitState, WorkspaceId } from "$shared/types";

function getListenSyncHandler(eventName: string) {
  const call = takeEveryFromListenSyncMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFirstVisitState(
  overrides: Partial<FirstVisitState> = {},
): FirstVisitState {
  return {
    version: 1,
    workspaceId: "ws-1" as WorkspaceId,
    firstVisitSetupReady: true,
    mainContentRevealed: true,
    navigationRailRevealed: true,
    workspaceDockRevealed: true,
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("workspaceSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forks both sub-sagas", () => {
    testSaga(workspaceSaga)
      .next()
      .fork(watchWorkspaceUpdatedSaga)
      .next()
      .fork(watchWorkspaceLifecycleSaga)
      .next()
      .isDone();
  });

  it("applies workspace updates locally when the IPC event arrives", () => {
    const data = {
      workspaceId: "ws-1",
      changes: { title: "Updated title" },
    };
    const iterator = watchWorkspaceUpdatedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const effect = getListenSyncHandler("workspace:updated")(data).next().value as any;
    expect(effect.type).toBe("CALL");
    expect(effect.payload.args).toEqual([data]);
  });

  it("dispatches updateWorkspaceEntity to keep Redux entity in sync on workspace:updated", () => {
    const data = {
      workspaceId: "ws-1",
      changes: { title: "IPC Updated" },
    };
    const iterator = watchWorkspaceUpdatedSaga();
    iterator.next(); // register listener

    const handler = getListenSyncHandler("workspace:updated")(data);
    // Step 1: CALL applyWorkspaceUpdate
    handler.next();
    // Step 2: PUT updateWorkspaceEntity
    const putEffect = handler.next().value as any;
    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action).toEqual(
      updateWorkspaceEntity("ws-1", { title: "IPC Updated" }),
    );
  });
});

describe("mapFirstVisitToVisibility", () => {
  it("maps fully-revealed state to default visibility", () => {
    const fvs = makeFirstVisitState();
    const result = mapFirstVisitToVisibility(fvs);
    expect(result).toEqual({
      showNavigationRail: true,
      showMainContent: true,
      showChatHeader: true,
      isChatFocusedMode: false,
      showWorkspaceDock: true,
    });
  });

  it("maps hidden panels to correct visibility flags", () => {
    const fvs = makeFirstVisitState({
      mainContentRevealed: false,
      navigationRailRevealed: false,
      workspaceDockRevealed: false,
    });
    const result = mapFirstVisitToVisibility(fvs);
    expect(result).toEqual({
      showNavigationRail: false,
      showMainContent: false,
      showChatHeader: false,
      isChatFocusedMode: true,
      showWorkspaceDock: false,
    });
  });
});

describe("handleFirstVisitHydration", () => {
  it("dispatches setPanelVisibilityBulk when persisted state exists", () => {
    const fvs = makeFirstVisitState({
      navigationRailRevealed: false,
      mainContentRevealed: false,
      workspaceDockRevealed: false,
    });

    const iterator = handleFirstVisitHydration(workspaceMounted("ws-1"));

    // call firstVisitStateClient.load
    const callEffect = iterator.next().value as any;
    expect(callEffect.type).toBe("CALL");

    // provide the loaded state
    const putEffect = iterator.next(fvs).value as any;
    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action).toEqual(
      setPanelVisibilityBulk("ws-1", {
        showNavigationRail: false,
        showMainContent: false,
        showChatHeader: false,
        isChatFocusedMode: true,
        showWorkspaceDock: false,
      }),
    );

    expect(iterator.next().done).toBe(true);
  });

  it("does not dispatch when no persisted state exists (brand-new workspace)", () => {
    const iterator = handleFirstVisitHydration(workspaceMounted("ws-new"));

    // call firstVisitStateClient.load
    const callEffect = iterator.next().value as any;
    expect(callEffect.type).toBe("CALL");

    // provide null (no persisted state)
    const result = iterator.next(null);
    // Should be done — no PUT
    expect(result.done).toBe(true);
  });

  it("swallows errors and does not dispatch", () => {
    const iterator = handleFirstVisitHydration(workspaceMounted("ws-err"));

    // call firstVisitStateClient.load
    iterator.next();

    // Simulate IPC error
    const result = iterator.throw!(new Error("IPC failure"));
    // Should be done — error caught
    expect(result.done).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Regression: direct Redux ownership — workspace switch hydration
  // -----------------------------------------------------------------------

  it("hydrates each workspace independently on sequential mounts (no cross-contamination)", () => {
    // Mount ws-A with hidden panels
    const fvsA = makeFirstVisitState({
      workspaceId: "ws-A" as WorkspaceId,
      navigationRailRevealed: false,
      mainContentRevealed: false,
      workspaceDockRevealed: false,
    });
    const iterA = handleFirstVisitHydration(workspaceMounted("ws-A"));
    iterA.next(); // call
    const putA = iterA.next(fvsA).value as any;
    expect(putA.type).toBe("PUT");
    expect(putA.payload.action).toEqual(
      setPanelVisibilityBulk("ws-A", {
        showNavigationRail: false,
        showMainContent: false,
        showChatHeader: false,
        isChatFocusedMode: true,
        showWorkspaceDock: false,
      }),
    );

    // Mount ws-B with all panels visible
    const fvsB = makeFirstVisitState({
      workspaceId: "ws-B" as WorkspaceId,
      navigationRailRevealed: true,
      mainContentRevealed: true,
      workspaceDockRevealed: true,
    });
    const iterB = handleFirstVisitHydration(workspaceMounted("ws-B"));
    iterB.next(); // call
    const putB = iterB.next(fvsB).value as any;
    expect(putB.type).toBe("PUT");
    // ws-B gets its own visibility — not ws-A's
    expect(putB.payload.action).toEqual(
      setPanelVisibilityBulk("ws-B", {
        showNavigationRail: true,
        showMainContent: true,
        showChatHeader: true,
        isChatFocusedMode: false,
        showWorkspaceDock: true,
      }),
    );
  });

  it("brand-new workspace with no persisted state skips dispatch (defaults apply)", () => {
    const iter = handleFirstVisitHydration(workspaceMounted("ws-fresh"));
    iter.next(); // call
    // No persisted state → null
    const result = iter.next(null);
    // Should complete without dispatching — defaults are already correct
    expect(result.done).toBe(true);
  });
});