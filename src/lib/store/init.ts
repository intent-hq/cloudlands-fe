import { applyMiddleware, combineReducers, legacy_createStore as createStore } from "redux";
import type {
  PreloadedStoreState,
  ReducersMap,
  ReduxStoreContext,
  StateDomain,
  StoreState,
} from "./types";
import { reducers } from "./reducer";
import { middleware, runSaga } from "./middleware";
import { sagaManager } from "./slices/saga-manager/sagas/manager";
import type { Saga, Task } from "redux-saga";
import {
  REDUX_DEBUG_LS_KEY,
  REDUX_DEBUG_LS_KEY_STATE_REFS_KEY,
  REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY,
} from "./constants";
import { createStoreStateReadable } from "./utils/create-readable-store-state";
import { initReduxDispatchBridge, initReduxStoreBridge } from "./redux-dispatch-bridge";

export const createExtendedDefaultState = <S>(initialState?: PreloadedStoreState): S => {
  const domains = Object.keys(reducers) as StateDomain[];

  return domains.reduce<S>((state, domain) => {
    return {
      ...state,
      [domain]: {
        ...reducers[domain].initialState,
        ...(initialState ? initialState[domain] : {}),
      },
    };
  }, {} as S);
};

/*
  Store debugging tools.
  We add a list of contexts for case when there are multiple stored initialized.
  We don't want to intialize multiple stores, and should see that immediately.
*/

/**
 * Check if any Redux debug flags are enabled in localStorage
 */
const isAnyDebugFlagEnabled = (): boolean => {
  try {
    return Boolean(
      localStorage.getItem(REDUX_DEBUG_LS_KEY) ||
        localStorage.getItem(REDUX_DEBUG_LS_KEY_STATE_REFS_KEY) ||
        localStorage.getItem(REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY)
    );
  } catch {
    return false;
  }
};

const exposeStore = (storeContext: ReduxStoreContext) => {
  if (typeof window === "undefined") {
    return;
  }
  window.intent = window.intent || {};
  if (window.intent.reduxContext === storeContext) {
    // eslint-disable-next-line no-console
    console.log("Context is exposed already");
  } else if (!window.intent.reduxContext) {
    window.intent.reduxContext = storeContext;
  } else {
    const list: ReduxStoreContext[] = [];
    window.intent.reduxContext = list.concat(window.intent.reduxContext).concat(storeContext);
    // In storybook we expect multiple stores e.g. in Docs page
    if (window.isStorybook) {
      // eslint-disable-next-line no-console
      console.log("Multiple Redux stores initialized:", window.intent.reduxContext);
    } else {
      console.error("Multiple Redux stores initialized:", window.intent.reduxContext);
    }
  }

  if (!window.intent.debug) {
    window.intent.debug = {};
  }

  /*
    This lives here for now, but should be moved into separate module for debug options.
  */

  const toggleBooleanLsKey = (key: string) => {
    if (localStorage.getItem(key)) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, "true");
    }
  };

  window.intent.debug.toggleReduxLogs = () => {
    toggleBooleanLsKey(REDUX_DEBUG_LS_KEY);
  };

  window.intent.debug.toggleStateReferenceChecks = () => {
    toggleBooleanLsKey(REDUX_DEBUG_LS_KEY_STATE_REFS_KEY);
  };

  window.intent.debug.toggleStructuredCloneChecks = () => {
    toggleBooleanLsKey(REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY);
  };
};

const cleanUpWindow = (context: ReduxStoreContext) => {
  if (typeof window === "undefined" || !window.intent?.reduxContext) {
    return;
  }

  if (window.intent.exposeStore) {
    window.intent.exposeStore = undefined;
  }

  if (window.intent.reduxContext === context) {
    window.intent.reduxContext = undefined;
  }
  if (Array.isArray(window.intent.reduxContext)) {
    window.intent.reduxContext = window.intent.reduxContext.filter((existingContext) => {
      return existingContext !== context;
    });
  }
};

export const rootReducer = combineReducers<ReducersMap>(reducers);
export const init = (loadedState?: PreloadedStoreState) => {
  const store = createStore(
    rootReducer,
    createExtendedDefaultState<StoreState>(loadedState),
    applyMiddleware(...middleware)
  );

  // Initialize the dispatch bridge for non-Svelte code (agent.service.ts, stream-manager.ts)
  initReduxDispatchBridge(store.dispatch.bind(store));
  initReduxStoreBridge(store);

  const readableStoreState = createStoreStateReadable(store);

  const tasksStarted: Task<any>[] = [];
  const runSagaSafely = <S extends Saga>(saga: S, ...args: Parameters<S>) => {
    const task = runSaga(saga, ...args);
    tasksStarted.push(task);
    return task;
  };

  const stopSagas = () => {
    for (const task of tasksStarted) {
      task.cancel();
    }
  };

  // Pass the emitter to sagas (they can only emit)
  runSagaSafely(
    sagaManager,
    readableStoreState,
    (runningTasksContext: ReduxStoreContext["tasks"]) => {
      storeContext.tasks = runningTasksContext;
    }
  );

  // Expose the subscriber to components (they can only subscribe)
  const storeContext: ReduxStoreContext = {
    store,
    storeState: readableStoreState,
    dispose: () => {
      stopSagas();
      cleanUpWindow(storeContext);
    },
    runSaga: runSagaSafely,
  };

  if (process.env.NODE_ENV === "development" || isAnyDebugFlagEnabled()) {
    exposeStore(storeContext);
  } else if (typeof window !== "undefined") {
    window.intent = window.intent || {};
    window.intent.exposeStore = () => {
      exposeStore(storeContext);
    };
  }

  return storeContext;
};
