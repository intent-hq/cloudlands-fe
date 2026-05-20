import { readFileSync } from "node:fs";

import type { Readable } from "svelte/store";
import { readable } from "svelte/store";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createReduxStoreBridgeAdapter,
  initAppStore,
} from "./store";
import { store } from "./configured-store";
import { reducers } from "./reducer";
import {
  getReduxDispatch,
  getReduxStore,
} from "./redux-dispatch-bridge";
import {
  sagaNames,
  sagas,
} from "./sagas";
import {
  registeredAppStore,
  startAllAppSagas,
  type RegisteredAppStoreRuntime,
} from "./saga-registration";
import {
  appStore,
} from "./store";
import type { GenericAction, StoreState } from "./types";

function createFakeStoreRuntime(initialState = { storeUtility: { updatesLocked: false } } as StoreState) {
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

  return {
    init: vi.fn(() => dispose),
    getReadableState: vi.fn(() => readableState),
    dispatch,
    get state() {
      return state;
    },
    runSaga: vi.fn(() => vi.fn()),
    dispose,
  } satisfies RegisteredAppStoreRuntime & { dispose: ReturnType<typeof vi.fn> };
}

describe("configured app Store", () => {
  it("constructs the core Store without importing app sagas", () => {
    const source = readFileSync("src/lib/store/configured-store.ts", "utf8");

    expect(source).not.toContain('from "./sagas"');
    expect(source).toContain("new Store(reducers, middleware as unknown as StoreMiddleware[])");
    expect(source).not.toContain("new Store(reducers, sagas");
    expect(appStore).toBe(store);
  });

  it("keeps the selector utility bound directly to the configured Store", () => {
    const source = readFileSync("src/lib/store/utils/create-selector.ts", "utf8");

    expect(source).toContain('import { store } from "../configured-store"');
    expect(source).toContain("store.createSelector(selectorFunc)");
  });

  it("registers existing reducer and saga maps on one package Store instance", () => {
    const registeredReducers = appStore.getReducers();
    const registeredSagas = registeredAppStore.getSagas();

    for (const [name, reducer] of Object.entries(reducers)) {
      expect(registeredReducers[name]).toBe(reducer);
    }
    for (const [name, saga] of Object.entries(sagas)) {
      expect(registeredSagas[name]).toBe(saga);
    }
    expect(registeredAppStore).toBe(appStore);
    expect(registeredAppStore.getSagaNames()).toEqual(sagaNames);
  });

  it("starts every registered app saga through Store.runSaga by name", () => {
    const runtime = createFakeStoreRuntime();

    const stopHandlers = startAllAppSagas(runtime);

    expect(runtime.runSaga).toHaveBeenCalledTimes(sagaNames.length);
    sagaNames.forEach((name, index) => {
      expect(runtime.runSaga).toHaveBeenNthCalledWith(index + 1, name);
    });
    expect(stopHandlers).toHaveLength(sagaNames.length);
  });
});

describe("app Store initialization bridge", () => {
  it("initializes the configured Store and exposes dispatch/state bridge access", () => {
    const runtime = createFakeStoreRuntime();

    const context = initAppStore(undefined, runtime);

    expect(runtime.init).toHaveBeenCalledOnce();
    expect(getReduxStore()).toBe(context.store);
    expect(getReduxDispatch()).toBe(context.store.dispatch);

    const action = { type: "test/action", payload: undefined };
    expect(context.store.dispatch(action)).toBe(action);
    expect(runtime.dispatch).toHaveBeenCalledWith(action);
    expect(context.store.getState()).toBe(runtime.state);

    context.dispose();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("adapts Store readable state subscriptions without firing on initial subscribe", () => {
    const runtime = createFakeStoreRuntime();
    const adapter = createReduxStoreBridgeAdapter(runtime);
    const listener = vi.fn();

    const unsubscribe = adapter.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();

    adapter.dispatch({ type: "test/update", payload: undefined });
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    adapter.dispatch({ type: "test/updateAgain", payload: undefined });
    expect(listener).toHaveBeenCalledOnce();
  });
});