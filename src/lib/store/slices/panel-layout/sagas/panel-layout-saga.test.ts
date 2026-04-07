import * as sagaEffects from "redux-saga/effects";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";

vi.mock("typed-redux-saga", async () => {
  const actual = await import("$lib/store/utils/test-helpers/typed-redux-saga-mock");

  return {
    ...actual,
    debounce: function* (ms: number, pattern: any, worker: any) {
      return yield sagaEffects.debounce(ms, pattern, worker);
    },
  };
});

const { clearPanelLayoutAdapterMock } = vi.hoisted(() => ({
  clearPanelLayoutAdapterMock: vi.fn(),
}));

vi.mock("$features/layout/panel-layout-adapter", () => ({
  clearPanelLayoutAdapter: clearPanelLayoutAdapterMock,
}));

vi.mock("$features/layout/panel-layout-history.client", () => ({
  panelLayoutHistoryClient: {
    save: vi.fn(),
    load: vi.fn(),
  },
}));

import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { setLocalStorageJSON } from "../../../utils/safe-local-storage-saga";
import {
  PANEL_LAYOUT_STORAGE_KEY_PREFIX,
  type WorkspacePanelLayout,
} from "../panel-layout-types";
import {
  initializeLayout,
  initialState,
  panelLayoutReducer,
  setRestoreStatus,
} from "../panel-layout-slice";
import {
  handleWorkspaceMountedRestore,
  handleWorkspaceUnmounted,
  isStoredLayoutValid,
  loadLayoutFromStorage,
  panelLayoutSaga,
  retroactivePanelLayoutMountCheckSaga,
} from "./panel-layout-saga";

describe("panelLayoutSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forks all watchers including workspace restore lifecycle watchers", () => {
    const gen = panelLayoutSaga();

    for (let i = 0; i < 7; i++) {
      const result = gen.next();
      expect(result.done).toBe(false);
      expect((result.value as any).type).toBe("FORK");
    }

    expect(gen.next().done).toBe(true);
  });

  it("calls clearPanelLayoutAdapter when workspace is unmounted", () => {
    const action = workspaceUnmounted("ws-cleanup");
    const gen = handleWorkspaceUnmounted(action);
    gen.next();

    expect(clearPanelLayoutAdapterMock).toHaveBeenCalledWith("ws-cleanup");
  });

  it("marks restore pending, initializes layout, then marks restored", () => {
    const action = workspaceMounted("ws-restore");
    const storedLayout = {
      root: { type: "panel" as const, panelId: "p1" },
      panels: { p1: { id: "p1", tabs: [], activeTabId: null } },
      focusedPanelId: "p1",
    };

    const gen = handleWorkspaceMountedRestore(action);

    expect(gen.next().value).toEqual(sagaEffects.put(setRestoreStatus("ws-restore", "pending")));
    expect(gen.next().value).toEqual(sagaEffects.call(loadLayoutFromStorage, "ws-restore"));
    expect(gen.next(storedLayout).value).toEqual(
      sagaEffects.put(initializeLayout("ws-restore", storedLayout)),
    );
    expect(gen.next().value).toEqual(sagaEffects.put(setRestoreStatus("ws-restore", "restored")));
    expect(gen.next().done).toBe(true);
  });

  it("marks restore invalid when stored layout fails validation", () => {
    const gen = handleWorkspaceMountedRestore(workspaceMounted("ws-invalid"));

    expect(gen.next().value).toEqual(sagaEffects.put(setRestoreStatus("ws-invalid", "pending")));
    expect(gen.next().value).toEqual(sagaEffects.call(loadLayoutFromStorage, "ws-invalid"));
    expect(gen.next("invalid").value).toEqual(sagaEffects.put(setRestoreStatus("ws-invalid", "invalid")));
    expect(gen.next().done).toBe(true);
  });

  it("marks restore empty when nothing is stored", () => {
    const gen = handleWorkspaceMountedRestore(workspaceMounted("ws-empty"));

    expect(gen.next().value).toEqual(sagaEffects.put(setRestoreStatus("ws-empty", "pending")));
    expect(gen.next().value).toEqual(sagaEffects.call(loadLayoutFromStorage, "ws-empty"));
    expect(gen.next(null).value).toEqual(sagaEffects.put(setRestoreStatus("ws-empty", "empty")));
    expect(gen.next().done).toBe(true);
  });

  it("replays a missed workspace mount during retroactive check", () => {
    const gen = retroactivePanelLayoutMountCheckSaga();

    expect(gen.next().value).toEqual(sagaEffects.select(selectActiveWorkspaceId.select));
    const forkEffect = gen.next("ws-retro").value as any;
    expect(forkEffect.type).toBe("FORK");
    expect(forkEffect.payload.args[0]).toEqual(workspaceMounted("ws-retro"));
  });

  it("validates root refs, focusedPanelId, activeTabIds, and malformed tab entries", () => {
    expect(
      isStoredLayoutValid({
        root: { type: "panel", panelId: "missing" },
        panels: {},
        focusedPanelId: null,
      }),
    ).toBe(false);

    expect(
      isStoredLayoutValid({
        root: { type: "panel", panelId: "p1" },
        panels: { p1: { id: "p1", tabs: [], activeTabId: null } },
        focusedPanelId: "missing",
      }),
    ).toBe(false);

    expect(
      isStoredLayoutValid({
        root: { type: "panel", panelId: "p1" },
        panels: { p1: { id: "p1", tabs: [{ id: "tab-1" } as any], activeTabId: "missing" } },
        focusedPanelId: "p1",
      }),
    ).toBe(false);

    expect(
      isStoredLayoutValid({
        root: { type: "panel", panelId: "p1" },
        panels: { p1: { id: "p1", tabs: [null] as any, activeTabId: "tab-1" } },
        focusedPanelId: "p1",
      } as any),
    ).toBe(false);

    expect(
      isStoredLayoutValid({
        root: { type: "panel", panelId: "p1" },
        panels: { p1: { id: "p1", tabs: ["bad-tab"] as any, activeTabId: "tab-1" } },
        focusedPanelId: "p1",
      } as any),
    ).toBe(false);
  });

  it("persists initialized layouts without ephemeral pending focus state", async () => {
    const wsId = "ws-persist";
    const layout: WorkspacePanelLayout = {
      root: { type: "panel", panelId: "panel-1" },
      panels: {
        "panel-1": {
          id: "panel-1",
          tabs: [],
          activeTabId: null,
        },
      },
      focusedPanelId: "panel-1",
    };
    const action = initializeLayout(wsId, layout);
    const state = {
      panelLayout: panelLayoutReducer(initialState, action),
      workspace: { activeWorkspaceId: null },
    };

    await expectSaga(panelLayoutSaga)
      .withState(state)
      .dispatch(action)
      .call(setLocalStorageJSON, `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${wsId}`, layout)
      .silentRun(0);
  });
});

