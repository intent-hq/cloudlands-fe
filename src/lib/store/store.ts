import type { StoreInstanceState } from "svelte-redux-toolkit/types";
import type { Readable } from "svelte/store";

import {
  REDUX_DEBUG_LS_KEY,
  REDUX_DEBUG_LS_KEY_STATE_REFS_KEY,
  REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY,
} from "./constants";
import { store } from "./configured-store";
import {
  initReduxDispatchBridge,
  initReduxStoreBridge,
} from "./redux-dispatch-bridge";
import type {
  PreloadedStoreState,
  ReduxStore,
  ReduxStoreContext,
  StoreState,
} from "./types";
import { safeLocalStorage } from "../utils/safe-storage";

export { store };
export const appStore = store;

export type AppStore = typeof store;
export type AppStoreState = StoreInstanceState<typeof store>;
export type AppStoreRuntime = Pick<AppStore, "init" | "getReadableState" | "dispatch" | "state">;

const cleanUpWindow = (context: ReduxStoreContext) => {
  if (typeof window === "undefined" || !window.intent?.reduxContext) {
    return;
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

const exposeStoreContextDebug = (storeContext: ReduxStoreContext) => {
  if (typeof window === "undefined") {
    return;
  }

  window.intent = window.intent || {};

  if (window.intent.reduxContext === storeContext) {
    console.log("Context is exposed already");
  } else if (!window.intent.reduxContext) {
    window.intent.reduxContext = storeContext;
  } else {
    const list: ReduxStoreContext[] = [];
    window.intent.reduxContext = list.concat(window.intent.reduxContext).concat(storeContext);
    if (window.isStorybook) {
      console.log("Multiple Redux stores initialized:", window.intent.reduxContext);
    } else {
      console.error("Multiple Redux stores initialized:", window.intent.reduxContext);
    }
  }

  if (!window.intent.debug) {
    window.intent.debug = {};
  }

  const parseStoredBoolean = (value: string | null): boolean | undefined => {
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  };

  const toggleBooleanLsKey = (key: string) => {
    const currentValue = parseStoredBoolean(safeLocalStorage.getItem(key)) ?? false;
    safeLocalStorage.setItem(key, String(!currentValue));
  };

  const togglePresenceLsKey = (key: string) => {
    if (safeLocalStorage.getItem(key)) {
      safeLocalStorage.removeItem(key);
    } else {
      safeLocalStorage.setItem(key, "true");
    }
  };

  const logReduxLoggingReloadMessage = () => {
    console.log("Redux logging preference updated. Reload to take effect.");
  };

  window.intent.enableReduxLogging = () => {
    safeLocalStorage.setItem(REDUX_DEBUG_LS_KEY, "true");
    logReduxLoggingReloadMessage();
  };

  window.intent.disableReduxLogging = () => {
    safeLocalStorage.setItem(REDUX_DEBUG_LS_KEY, "false");
    logReduxLoggingReloadMessage();
  };

  window.intent.debug.toggleReduxLogs = () => {
    toggleBooleanLsKey(REDUX_DEBUG_LS_KEY);
    logReduxLoggingReloadMessage();
  };

  window.intent.debug.toggleStateReferenceChecks = () => {
    togglePresenceLsKey(REDUX_DEBUG_LS_KEY_STATE_REFS_KEY);
  };

  window.intent.debug.toggleStructuredCloneChecks = () => {
    togglePresenceLsKey(REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY);
  };
};

export const createReduxStoreBridgeAdapter = (configuredStore: AppStoreRuntime = appStore): ReduxStore => {
  const dispatch: ReduxStore["dispatch"] = ((action) => configuredStore.dispatch(action)) as ReduxStore["dispatch"];
  const getState: ReduxStore["getState"] = () => configuredStore.state as StoreState;
  const subscribe: ReduxStore["subscribe"] = (listener) => {
    let didEmitInitialValue = false;

    return (configuredStore.getReadableState() as Readable<StoreState>).subscribe(() => {
      if (didEmitInitialValue) {
        listener();
      } else {
        didEmitInitialValue = true;
      }
    });
  };

  return {
    dispatch,
    getState,
    subscribe,
    replaceReducer: () => {
      throw new Error("replaceReducer is not supported by the configured app Store bridge.");
    },
  } as unknown as ReduxStore;
};

export const initAppStore = (
  loadedState?: PreloadedStoreState,
  configuredStore: AppStoreRuntime = appStore
): ReduxStoreContext => {
  const disposeConfiguredStore = configuredStore.init(loadedState);
  const store = createReduxStoreBridgeAdapter(configuredStore);

  initReduxDispatchBridge(store.dispatch);
  initReduxStoreBridge(store);

  const storeContext: ReduxStoreContext = {
    store,
    storeState: configuredStore.getReadableState() as Readable<StoreState>,
    dispose: () => {
      cleanUpWindow(storeContext);
      disposeConfiguredStore();
    },
  };

  exposeStoreContextDebug(storeContext);

  return storeContext;
};
