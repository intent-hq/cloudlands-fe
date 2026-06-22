import { readFileSync } from "node:fs";

import type { Readable } from "svelte/store";
import { readable } from "svelte/store";
import type { Store } from "@augmentcode/ag-redux-toolkit/svelte-store";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  initAppStore,
  store as appStore,
} from "./store";
import {
  _resetRendererStoreBridge,
  clearRendererStoreBridge,
  getRendererStore,
  initRendererStoreBridge,
} from "./renderer-store-bridge";
import { store as configuredStore } from "./configured-store";
import { reducers } from "./reducer";
import {
  sagas,
  startAllAppSagas,
} from "./sagas";
import type { GenericAction } from "@augmentcode/ag-redux-toolkit/types";
import type { StoreState } from "./types";

function createFakeStoreRuntime(initialState = {} as StoreState) {
  let state = initialState;
  const subscribers = new Set<(value: StoreState) => void>();
  const readableState: Readable<StoreState> = readable(state, (set) => {
    subscribers.add(set);
    set(state);
    return () => subscribers.delete(set);
  });
  const dispose = vi.fn();
  const dispatch = vi.fn((action: GenericAction) => {
    state = { ...state };
    subscribers.forEach((set) => set(state));
    return action;
  });

  const runtime = {
    init: vi.fn(() => dispose),
    getReadableState: vi.fn(() => readableState),
    dispatch,
    get state() {
      return state;
    },
    runSaga: vi.fn(() => vi.fn()),
    dispose,
  };

  return runtime;
}

beforeEach(() => {
  _resetRendererStoreBridge();
});

describe("configured app Store", () => {
  it("constructs the core Store without importing app sagas", () => {
    const source = readFileSync("src/store/renderer/configured-store.ts", "utf8");

    expect(source).not.toContain('from "./sagas"');
    expect(source).toContain("new Store(reducers, middleware as unknown as StoreMiddleware[])");
    expect(source).not.toContain("new Store(reducers, sagas");
    expect(appStore).toBe(configuredStore);
  });

  it("creates selectors directly from the configured Store", () => {
    const state = {} as StoreState;
    const selectStoreState = appStore.createSelector((state) => state);

    expect(selectStoreState.select(state)).toBe(state);
  });

  it("keeps app reducers on the configured package Store and exposes app sagas as functions", () => {
    const registeredReducers = appStore.getReducers();

    expect(reducers).not.toHaveProperty("storeUtility");
    expect(registeredReducers).not.toHaveProperty("storeUtility");
    expect(registeredReducers).toHaveProperty("@internal_storeUtility");
    expect(registeredReducers).toHaveProperty("@internal_sagaManager");

    for (const [name, reducer] of Object.entries(reducers)) {
      expect(registeredReducers[name]).toBe(reducer);
    }
    expect(sagas.every((saga) => typeof saga === "function")).toBe(true);
  });

  it("starts every registered app saga through Store.runSaga in registry order", () => {
    const runtime = createFakeStoreRuntime();

    const stopHandlers = startAllAppSagas(runtime as unknown as Store<any, any>);

    expect(runtime.runSaga).toHaveBeenCalledTimes(sagas.length);
    sagas.forEach((saga, index) => {
      expect(runtime.runSaga).toHaveBeenNthCalledWith(index + 1, saga);
    });
    expect(stopHandlers).toHaveLength(sagas.length);
  });
});

describe("app Store initialization", () => {
  it("initializes the configured Store and exposes dispatch/state through context", () => {
    const runtime = createFakeStoreRuntime();

    const context = initAppStore(runtime as unknown as Store<any, any>);

    expect(runtime.init).toHaveBeenCalledOnce();
    expect(context.store).toBe(runtime);
    expect("storeState" in context).toBe(false);

    const action = { type: "test/action", payload: undefined };
    expect(context.store.dispatch(action)).toBe(action);
    expect(runtime.dispatch).toHaveBeenCalledWith(action);
    expect(context.store.state).toBe(runtime.state);
    expect(context.store.getReadableState()).toBe(runtime.getReadableState());
    expect(getRendererStore()).toBe(runtime);

    context.dispose();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(() => getRendererStore()).toThrow("Renderer store bridge not initialized");
  });

  it("can initialize again after root teardown clears the renderer store bridge", () => {
    const firstRuntime = createFakeStoreRuntime();
    const firstContext = initAppStore(firstRuntime as unknown as Store<any, any>);

    firstContext.dispose();

    const secondRuntime = createFakeStoreRuntime();
    const secondContext = initAppStore(secondRuntime as unknown as Store<any, any>);

    expect(getRendererStore()).toBe(secondRuntime);
    secondContext.dispose();
  });

  it("does not let an older disposer clear a newer renderer store bridge", () => {
    const oldRuntime = createFakeStoreRuntime();
    const newRuntime = createFakeStoreRuntime();

    initRendererStoreBridge(oldRuntime as unknown as Store<any, any>);
    initRendererStoreBridge(oldRuntime as unknown as Store<any, any>);
    expect(clearRendererStoreBridge(newRuntime as unknown as Store<any, any>)).toBe(false);
    expect(getRendererStore()).toBe(oldRuntime);
    expect(clearRendererStoreBridge(oldRuntime as unknown as Store<any, any>)).toBe(true);
    initRendererStoreBridge(newRuntime as unknown as Store<any, any>);

    expect(getRendererStore()).toBe(newRuntime);
  });
});
