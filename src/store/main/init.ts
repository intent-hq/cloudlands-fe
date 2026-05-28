/**
 * Main-process Redux store initialization.
 *
 * Creates the Redux store with saga middleware, store-guard, and logger,
 * initializes the store bridge, and starts registered main sagas.
 */

import {
  applyMiddleware,
  combineReducers,
  legacy_createStore as createStore,
} from "redux";
import type { Saga, Task } from "redux-saga";

import { Logger } from "../../shared/logger";
import type { MainReduxStore, MainStoreState } from "./types";
import { reducers } from "./reducer";
import {
  middleware,
  runSaga,
  setSagaContext,
} from "./middleware";
import {
  mainSagaEntries,
  mainSagaNames,
} from "./sagas";
import { initMainStoreBridge } from "./redux-store-bridge";

const logger = new Logger("MainStore");

const createRootReducer = () => combineReducers(reducers);

const createReadableMainStoreState = (store: MainReduxStore) => ({
  subscribe(run: (state: MainStoreState) => void): () => void {
    run(store.getState());
    return store.subscribe(() => run(store.getState()));
  },
});

export type SagaRunner = <S extends Saga>(saga: S, ...args: Parameters<S>) => Task;

export interface MainStoreContext {
  store: MainReduxStore;
  runSaga: SagaRunner;
}

/**
 * Initialize the main-process Redux store.
 *
 * Must be called once during Electron main-process startup,
 * before any code dispatches actions or reads state.
 */
export function initMainStore(): MainStoreContext {
  logger.info("Initializing main-process Redux store");

  const rootReducer = createRootReducer();

  const store = createStore(
    rootReducer,
    {} as MainStoreState,
    applyMiddleware(...middleware),
  ) as MainReduxStore;

  // Wire up the global bridge so services can access the store
  initMainStoreBridge(store);
  setSagaContext({ readableStoreState: createReadableMainStoreState(store) });

  // Track task handles for sagas started by initMainStore. This wrapper does
  // not aggregate saga lifetimes; each runSaga call below starts an independent
  // registry entry.
  const tasksStarted: Task[] = [];
  const runSagaSafely: SagaRunner = <S extends Saga>(
    saga: S,
    ...args: Parameters<S>
  ) => {
    const task = runSaga(saga, ...args);
    tasksStarted.push(task);
    return task;
  };

  // Start each registered static zero-argument saga independently from the
  // registry. Dynamic/runtime-argument worker forks stay inside the owning
  // saga that creates them, rather than being listed here.
  logger.info("Starting main-process Redux sagas", {
    sagaCount: mainSagaEntries.length,
    sagaNames: mainSagaNames,
  });
  for (const { saga } of mainSagaEntries) {
    runSagaSafely(saga);
  }

  logger.info("Main-process Redux store initialized", {
    reducerCount: Object.keys(reducers).length,
    middlewareCount: middleware.length,
    sagaCount: mainSagaEntries.length,
  });

  return { store, runSaga: runSagaSafely };
}