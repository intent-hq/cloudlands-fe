import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

vi.mock("$lib/store/slices/workspace/utils/first-visit-state.client", () => ({
  firstVisitStateClient: { load: vi.fn() },
}));

import type { FirstVisitState } from "$shared/types";
import { WorkspaceId } from "$shared/types/branded-ids";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { setPanelVisibilityBulk } from "../ui-layout-slice";
import {
  handleFirstVisitHydration,
  mapFirstVisitToPanelVisibility,
  panelVisibilitySaga,
} from "./panel-visibility-saga";

function makeFirstVisitState(overrides: Partial<FirstVisitState> = {}): FirstVisitState {
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

describe("panel visibility saga", () => {
  it("maps first-visit state into ui-layout visibility fields", () => {
    expect(
      mapFirstVisitToPanelVisibility(
        makeFirstVisitState({
          navigationRailRevealed: false,
          mainContentRevealed: false,
          workspaceDockRevealed: false,
        }),
      ),
    ).toEqual({
      showNavigationRail: false,
      showMainContent: false,
      showChatHeader: false,
      isChatFocusedMode: true,
      showWorkspaceDock: false,
    });
  });

  it("hydrates stored first-visit state into ui-layout", () => {
    const iterator = handleFirstVisitHydration(workspaceMounted("ws-1"));
    expect((iterator.next().value as any).type).toBe("CALL");
    expect(iterator.next(makeFirstVisitState({ navigationRailRevealed: false })).value).toEqual(
      sagaEffects.put(
        setPanelVisibilityBulk("ws-1", {
          showNavigationRail: false,
          showMainContent: true,
          showChatHeader: true,
          isChatFocusedMode: false,
          showWorkspaceDock: true,
        }),
      ),
    );
    expect(iterator.next().done).toBe(true);
  });

  it("does nothing when no persisted first-visit state exists", () => {
    const iterator = handleFirstVisitHydration(workspaceMounted("ws-new"));
    iterator.next();
    expect(iterator.next(null).done).toBe(true);
  });

  it("swallows first-visit load errors", () => {
    const iterator = handleFirstVisitHydration(workspaceMounted("ws-err"));
    iterator.next();
    expect(iterator.throw?.(new Error("IPC failure")).done).toBe(true);
  });

  it("watches workspace mounts", () => {
    const iterator = panelVisibilitySaga();
    expect(iterator.next().value).toEqual(sagaEffects.takeEvery(workspaceMounted, handleFirstVisitHydration));
    expect(iterator.next().done).toBe(true);
  });
});