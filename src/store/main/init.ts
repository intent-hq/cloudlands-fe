/**
 * Main-process Redux store initialization.
 *
 * Creates the Redux store with saga middleware, store-guard, and logger,
 * initializes the store bridge, and starts the root saga.
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
import { middleware, runSaga } from "./middleware";
import { mainRootSaga } from "./sagas";
import { initMainStoreBridge } from "./redux-store-bridge";

const logger = new Logger("MainStore");

const createRootReducer = () => combineReducers(reducers);

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

  // Track saga tasks for potential cleanup
  const tasksStarted: Task[] = [];
  const runSagaSafely: SagaRunner = <S extends Saga>(
    saga: S,
    ...args: Parameters<S>
  ) => {
    const task = runSaga(saga, ...args);
    tasksStarted.push(task);
    return task;
  };

  // Start the root saga
  runSagaSafely(mainRootSaga);

  logger.info("Main-process Redux store initialized", {
    reducerCount: Object.keys(reducers).length,
    middlewareCount: middleware.length,
  });

  return { store, runSaga: runSagaSafely };
}