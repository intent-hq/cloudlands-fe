import { describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  debounce: function* (ms: any, pattern: any, saga: any) {
    return yield sagaEffects.debounce(ms, pattern, saga);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  takeEvery: function* (pattern: any, saga: any) {
    return yield sagaEffects.takeEvery(pattern, saga);
  },
}));

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

import { workspaceUnmounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { panelLayoutSaga, handleWorkspaceUnmounted } from "./panel-layout-saga";

describe("panelLayoutSaga", () => {
  it("forks all watchers including workspaceUnmounted watcher", () => {
    const gen = panelLayoutSaga();

    // Should fork 5 watchers total
    for (let i = 0; i < 5; i++) {
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
});

