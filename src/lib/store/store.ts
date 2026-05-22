import type { Store } from "svelte-redux-toolkit/store";

import {
  REDUX_DEBUG_LS_KEY,
  REDUX_DEBUG_LS_KEY_STATE_REFS_KEY,
  REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY,
} from "./constants";
import type {
  PreloadedStoreState,
  ReduxStoreContext,
} from "./types";
import { safeLocalStorage } from "../utils/safe-storage";

export { store } from "./configured-store";

type StoreDebugIntent = {
  reduxContext?: ReduxStoreContext | ReduxStoreContext[];
  debug?: {
    toggleReduxLogs?: () => void;
    toggleStateReferenceChecks?: () => void;
    toggleStructuredCloneChecks?: () => void;
  };
  enableReduxLogging?: () => void;
  disableReduxLogging?: () => void;
};

type StoreDebugWindow = Window & typeof globalThis & {
  intent?: StoreDebugIntent;
  isStorybook?: boolean;
};

const cleanUpWindow = (context: ReduxStoreContext) => {
  if (typeof window === "undefined") {
    return;
  }

  const debugWindow = window as StoreDebugWindow;

  if (!debugWindow.intent?.reduxContext) {
    return;
  }

  if (debugWindow.intent.reduxContext === context) {
    debugWindow.intent.reduxContext = undefined;
  }
  if (Array.isArray(debugWindow.intent.reduxContext)) {
    debugWindow.intent.reduxContext = debugWindow.intent.reduxContext.filter((existingContext) => {
      return existingContext !== context;
    });
  }
};

const exposeStoreContextDebug = (storeContext: ReduxStoreContext) => {
  if (typeof window === "undefined") {
    return;
  }

  const debugWindow = window as StoreDebugWindow;

  debugWindow.intent = debugWindow.intent || {};

  if (debugWindow.intent.reduxContext === storeContext) {
    console.log("Context is exposed already");
  } else if (!debugWindow.intent.reduxContext) {
    debugWindow.intent.reduxContext = storeContext;
  } else {
    const list: ReduxStoreContext[] = [];
    debugWindow.intent.reduxContext = list.concat(debugWindow.intent.reduxContext).concat(storeContext);
    if (debugWindow.isStorybook) {
      console.log("Multiple Redux stores initialized:", debugWindow.intent.reduxContext);
    } else {
      console.error("Multiple Redux stores initialized:", debugWindow.intent.reduxContext);
    }
  }

  if (!debugWindow.intent.debug) {
    debugWindow.intent.debug = {};
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

  debugWindow.intent.enableReduxLogging = () => {
    safeLocalStorage.setItem(REDUX_DEBUG_LS_KEY, "true");
    logReduxLoggingReloadMessage();
  };

  debugWindow.intent.disableReduxLogging = () => {
    safeLocalStorage.setItem(REDUX_DEBUG_LS_KEY, "false");
    logReduxLoggingReloadMessage();
  };

  debugWindow.intent.debug.toggleReduxLogs = () => {
    toggleBooleanLsKey(REDUX_DEBUG_LS_KEY);
    logReduxLoggingReloadMessage();
  };

  debugWindow.intent.debug.toggleStateReferenceChecks = () => {
    togglePresenceLsKey(REDUX_DEBUG_LS_KEY_STATE_REFS_KEY);
  };

  debugWindow.intent.debug.toggleStructuredCloneChecks = () => {
    togglePresenceLsKey(REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY);
  };
};

export const initAppStore = (
  store: Store<any, any>,
  loadedState?: PreloadedStoreState,
): ReduxStoreContext => {
  const disposeConfiguredStore = store.init(loadedState);

  const storeContext: ReduxStoreContext = {
    store,
    dispose: () => {
      cleanUpWindow(storeContext);
      disposeConfiguredStore();
    },
  };

  exposeStoreContextDebug(storeContext);

  return storeContext;
};
