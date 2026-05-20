import { readFileSync } from "node:fs";

import type { Readable } from "svelte/store";
import { readable } from "svelte/store";
import type { Store } from "svelte-redux-toolkit/store";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  initAppStore,
  store as appStore,
} from "./store";
import { store as configuredStore } from "./configured-store";
import { reducers } from "./reducer";
import {
  sagaNames,
  sagas,
} from "./sagas";
import {
  startAllAppSagas,
} from "./saga-registration";
import type { GenericAction } from "svelte-redux-toolkit/types";
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
    registerSagas: vi.fn(() => runtime as unknown as Store<any, any, any>),
    dispose,
  };

  return runtime;
}

describe("configured app Store", () => {
  it("constructs the core Store without importing app sagas", () => {
    const source = readFileSync("src/lib/store/configured-store.ts", "utf8");

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

  it("registers existing reducer and saga maps on one package Store instance", () => {
    const registeredReducers = appStore.getReducers();
    const storeWithSagas = appStore.registerSagas(sagas);
    const registeredSagas = storeWithSagas.getSagas();

    expect(reducers).not.toHaveProperty("storeUtility");
    expect(registeredReducers).not.toHaveProperty("storeUtility");
    expect(registeredReducers).toHaveProperty("@internal_storeUtility");
    expect(registeredReducers).toHaveProperty("@internal_sagaManager");

    for (const [name, reducer] of Object.entries(reducers)) {
      expect(registeredReducers[name]).toBe(reducer);
    }
    for (const [name, saga] of Object.entries(sagas)) {
      expect(registeredSagas[name]).toBe(saga);
    }
    expect(storeWithSagas).toBe(appStore);
    expect(storeWithSagas.getSagaNames()).toEqual(sagaNames);
  });

  it("starts every registered app saga through Store.runSaga by name", () => {
    const runtime = createFakeStoreRuntime();

    const stopHandlers = startAllAppSagas(runtime as unknown as Store<any, any, any>);

    expect(runtime.registerSagas).toHaveBeenCalledWith(sagas);
    expect(runtime.runSaga).toHaveBeenCalledTimes(sagaNames.length);
    sagaNames.forEach((name, index) => {
      expect(runtime.runSaga).toHaveBeenNthCalledWith(index + 1, name);
    });
    expect(stopHandlers).toHaveLength(sagaNames.length);
  });
});

describe("app Store initialization", () => {
  it("initializes the configured Store and exposes dispatch/state through context", () => {
    const runtime = createFakeStoreRuntime();

    const context = initAppStore(undefined, runtime as unknown as Store<any, any, any>);

    expect(runtime.init).toHaveBeenCalledOnce();
    expect(context.store).toBe(runtime);
    expect("storeState" in context).toBe(false);

    const action = { type: "test/action", payload: undefined };
    expect(context.store.dispatch(action)).toBe(action);
    expect(runtime.dispatch).toHaveBeenCalledWith(action);
    expect(context.store.state).toBe(runtime.state);
    expect(context.store.getReadableState()).toBe(runtime.getReadableState());

    context.dispose();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});
