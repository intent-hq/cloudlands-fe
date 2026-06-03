import {
  describe,
  it,
  vi,
} from "vitest";
import { expectSaga } from "redux-saga-test-plan";
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
}));

import {
  getLocalStorageItem,
  getLocalStorageJSON,
} from "$store/renderer/utils/safe-local-storage-saga";
import {
  defaultWorkspaceSidebarPanelLayout,
  loadSidebarState,
  loadWorkspaceSidebarPanelLayout,
} from "../ui-layout-slice";
import { initSaga } from "./init-saga";

describe("ui-layout init saga", () => {
  it("hydrates sidebar expanded width and workspace sidebar panel layout from persisted storage", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });

    const storedWorkspaceLayout = {
      collapsed: { notes: true, activity: false },
      heights: { notes: 120, explorer: 240 },
    };
    const expectedWorkspaceLayout = {
      collapsed: {
        ...defaultWorkspaceSidebarPanelLayout.collapsed,
        ...storedWorkspaceLayout.collapsed,
      },
      heights: storedWorkspaceLayout.heights,
    };
    const storedItems: Record<string, string | null> = {
      "workspace-left-panel-width": "35",
      "workspace-left-panel-expanded-width": "55",
      "workspace-left-panel-collapsed": "true",
    };

    await expectSaga(initSaga)
      .provide({
        call: (effect, next) => {
          const [key] = effect.args;
          if (effect.fn === getLocalStorageItem) {
            return storedItems[key as string] ?? null;
          }
          if (effect.fn === getLocalStorageJSON) {
            return key === "vscode-resizable-panels" ? storedWorkspaceLayout : undefined;
          }
          return next();
        },
      })
      .put(loadSidebarState(420, true, 660))
      .put(loadWorkspaceSidebarPanelLayout(expectedWorkspaceLayout))
      .run();
  });
});