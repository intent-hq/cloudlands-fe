import {
  describe,
  it,
  vi,
} from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
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
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

import {
  getLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageItem,
  setLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
import {
  hydrateCollapsiblePanelCollapsed,
  hydrateResizablePanelGroupLayout,
  hydrateResizablePanelSize,
  initialState as uiLayoutInitialState,
  requestCollapsiblePanelCollapsed,
  requestResizablePanelGroupLayout,
  requestResizablePanelSize,
  setCollapsiblePanelCollapsed,
  setResizablePanelGroupLayout,
  setResizablePanelSize,
  setSidebarExpandedWidth,
  setWorkspaceSidebarPanelLayout,
} from "../ui-layout-slice";
import { persistenceSaga } from "./persistence-saga";

const makeState = (uiLayout = uiLayoutInitialState) => ({ uiLayout }) as any;

function* runPersistenceSagaAndDispatch(action: any) {
  yield sagaEffects.fork(persistenceSaga);
  yield sagaEffects.delay(0);
  yield sagaEffects.put(action);
}

describe("ui-layout persistence saga", () => {
  it("hydrates requested resizable panel size from persisted storage", async () => {
    await expectSaga(runPersistenceSagaAndDispatch, requestResizablePanelSize("panel-width"))
      .provide([[matchers.call.fn(getLocalStorageItem), "42"]])
      .put(hydrateResizablePanelSize("panel-width", 42))
      .silentRun(20);
  });

  it("persists resizable panel size from Redux state", async () => {
    await expectSaga(runPersistenceSagaAndDispatch, setResizablePanelSize("panel-width", 33))
      .withState(makeState({
        ...uiLayoutInitialState,
        resizablePanelSizes: { "panel-width": 33 },
      }))
      .provide([[matchers.call.fn(setLocalStorageItem), undefined]])
      .call(setLocalStorageItem, "panel-width", "33")
      .silentRun(20);
  });

  it("persists sidebar expanded width to the preserved storage key", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });

    await expectSaga(runPersistenceSagaAndDispatch, setSidebarExpandedWidth(600))
      .withState(makeState({
        ...uiLayoutInitialState,
        sidebarExpandedWidth: 600,
      }))
      .provide([[matchers.call.fn(setLocalStorageItem), undefined]])
      .call(setLocalStorageItem, "workspace-left-panel-expanded-width", "50")
      .silentRun(20);
  });

  it("hydrates requested resizable panel group layout from persisted storage", async () => {
    const layout = { sizes: [40, 60], collapsed: ["left"] };

    await expectSaga(runPersistenceSagaAndDispatch, requestResizablePanelGroupLayout("panel-group"))
      .provide([[matchers.call.fn(getLocalStorageJSON), layout]])
      .put(hydrateResizablePanelGroupLayout("panel-group", layout))
      .silentRun(20);
  });

  it("persists resizable panel group layout from Redux state", async () => {
    const layout = { sizes: [40, 60], collapsed: ["left"] };

    await expectSaga(
      runPersistenceSagaAndDispatch,
      setResizablePanelGroupLayout("panel-group", layout)
    )
      .withState(makeState({
        ...uiLayoutInitialState,
        resizablePanelGroupLayouts: { "panel-group": layout },
      }))
      .provide([[matchers.call.fn(setLocalStorageJSON), undefined]])
      .call(setLocalStorageJSON, "panel-group", layout)
      .silentRun(20);
  });

  it("hydrates requested collapsible panel state from persisted storage", async () => {
    await expectSaga(runPersistenceSagaAndDispatch, requestCollapsiblePanelCollapsed("activity"))
      .provide([[matchers.call.fn(getLocalStorageItem), "true"]])
      .put(hydrateCollapsiblePanelCollapsed("activity", true))
      .silentRun(20);
  });

  it("persists collapsible panel state from dispatched action", async () => {
    await expectSaga(runPersistenceSagaAndDispatch, setCollapsiblePanelCollapsed("activity", false))
      .provide([[matchers.call.fn(setLocalStorageItem), undefined]])
      .call(setLocalStorageItem, "activity", "false")
      .silentRun(20);
  });

  it("persists workspace sidebar panel layout from Redux state", async () => {
    const layout = {
      collapsed: { notes: true, "source-control": false, explorer: false, activity: false },
      heights: { notes: 120, explorer: 240 },
    };

    await expectSaga(runPersistenceSagaAndDispatch, setWorkspaceSidebarPanelLayout(layout))
      .withState(makeState({ ...uiLayoutInitialState, workspaceSidebarPanelLayout: layout }))
      .provide([[matchers.call.fn(setLocalStorageJSON), undefined]])
      .call(setLocalStorageJSON, "vscode-resizable-panels", layout)
      .silentRun(20);
  });
});