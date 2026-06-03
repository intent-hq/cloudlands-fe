/**
 * Main-process Redux store initialization.
 *
 * Initializes the configured StreamingStore with store-guard and logger,
 * initializes the store bridge, and starts registered main sagas.
 */

import { render } from "svelte/server";
import type {
  Component,
  ComponentInternals,
} from "svelte";

import { Logger } from "../../shared/logger";
import type { MainStore } from "./types";
import { store } from "./configured-store";
import { reducers } from "./reducer";
import { middleware } from "./middleware";
import {
  mainSagaEntries,
  mainSagaNames,
  startAllMainSagas,
} from "./sagas";
import { initMainStoreBridge } from "./redux-store-bridge";

const logger = new Logger("MainStore");

type MainStoreInitComponentProps = {
  run: () => void;
};

const MainStoreInitComponent: Component<MainStoreInitComponentProps> = (
  _renderer: ComponentInternals,
  props: MainStoreInitComponentProps,
) => {
  props.run();
  return {};
};

const runInSvelteServerContext = (run: () => void): void => {
  // StreamingStore.init() currently checks for an ambient Svelte context before
  // creating its Redux runtime. The Electron main process has no component tree,
  // so provide the smallest public server-render context and force the lazy render.
  void render(MainStoreInitComponent, { props: { run } }).body;
};

export type SagaRunner = MainStore["runSaga"];

export interface MainStoreContext {
  store: MainStore;
  runSaga: SagaRunner;
  dispose: () => void;
}

/**
 * Initialize the main-process Redux store.
 *
 * Must be called once during Electron main-process startup,
 * before any code dispatches actions or reads state.
 */
export function initMainStore(): MainStoreContext {
  logger.info("Initializing main-process Redux store");

  let disposeConfiguredStore: (() => void) | undefined;
  runInSvelteServerContext(() => {
    disposeConfiguredStore = store.init();
  });

  // Wire up the global bridge so services can access the store
  initMainStoreBridge(store);

  // Start each registered static zero-argument saga independently from the
  // registry. Dynamic/runtime-argument worker forks stay inside the owning
  // saga that creates them, rather than being listed here.
  logger.info("Starting main-process Redux sagas", {
    sagaCount: mainSagaEntries.length,
    sagaNames: mainSagaNames,
  });
  const stopMainSagas = startAllMainSagas(store);

  logger.info("Main-process Redux store initialized", {
    reducerCount: Object.keys(reducers).length,
    middlewareCount: middleware.length,
    sagaCount: mainSagaEntries.length,
  });

  return {
    store,
    runSaga: store.runSaga.bind(store),
    dispose: () => {
      for (const stopMainSaga of stopMainSagas) {
        stopMainSaga();
      }
      disposeConfiguredStore?.();
    },
  };
}
