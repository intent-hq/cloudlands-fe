/*
  List of middlewares to run, order in this list
  defines order of execution
*/

import { type Middleware } from "redux";
import createSagaMiddleware, { type Saga } from "redux-saga";
import { type StoreState } from "./types";
import {
  REDUX_DEBUG_LS_KEY,
  REDUX_DEBUG_LS_KEY_STATE_REFS_KEY,
  REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY,
} from "./constants";
import { createBatchingMiddleware } from "./middlewares/batch";
import { createLoggerMiddleware } from "./middlewares/logger";
import { createSentryBreadcrumbsMiddleware } from "./middlewares/sentry-breadcrumbs";
import { createReferenceChangeDetectorMiddleware } from "./middlewares/state-reference-checks";
import { createStructuredCloneCheckerMiddleware } from "./middlewares/structured-clone-checker";
import { createStoreGuardMiddleware } from "../../store/utils/store-guard-middleware";
import { safeLocalStorage } from "$lib/utils/safe-storage";

export const sagaMiddleware = createSagaMiddleware();

const isDevBuild = (): boolean => Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

export const runSaga = <S extends Saga>(saga: S, ...args: Parameters<S>) => {
  return sagaMiddleware.run(saga, ...args);
};

/**
 * Get Redux logger configuration from localStorage for manual debugging.
 */
function getReduxLoggerConfig(): { enabled: boolean; webviewName?: string } {
  if (typeof window === "undefined") {
    return { enabled: false };
  }

  const globallyEnabled = (window as any).intentFlags?.enableReduxLogger;

  let localStorageEnabled: boolean | undefined;
  const { value: localStorageValue, hadError } = safeLocalStorage.getItemWithStatus(REDUX_DEBUG_LS_KEY);

  if (hadError) {
    localStorageEnabled = false;
  } else if (localStorageValue != null && localStorageValue !== "undefined") {
    try {
      localStorageEnabled = !!JSON.parse(localStorageValue);
    } catch (error) {
      console.warn(`Failed to parse ${REDUX_DEBUG_LS_KEY} from localStorage:`, error);
      localStorageEnabled = false;
    }
  }

  const enableReduxLogger = globallyEnabled ?? localStorageEnabled ?? isDevBuild();
  const webviewName = globallyEnabled ? (window as any).intentFlags?.webviewName : "";

  return { enabled: enableReduxLogger, webviewName };
}

function buildMiddleware(): Middleware<any, StoreState, any>[] {
  const baseMiddleware: Middleware<any, StoreState, any>[] = [
    // Guard must be first — reject actions tagged for the wrong store immediately
    createStoreGuardMiddleware("renderer"),
    // No action types to batch yet — add action types here as slices are added
    createBatchingMiddleware([]),
    sagaMiddleware,
    // Add Sentry breadcrumbs middleware to track Redux actions
    createSentryBreadcrumbsMiddleware(),
  ];

  // Debug middlewares need to be added AFTER batching middleware
  // so they see the actual state changes, not the batched actions
  const debugMiddlewares: Middleware<any, StoreState, any>[] = [];

  if (typeof window !== "undefined") {
    if (safeLocalStorage.getItem(REDUX_DEBUG_LS_KEY_STATE_REFS_KEY)) {
      debugMiddlewares.push(createReferenceChangeDetectorMiddleware());
    }

    if (isDevBuild() || safeLocalStorage.getItem(REDUX_DEBUG_LS_KEY_STRUCTURED_CLONE_KEY)) {
      debugMiddlewares.push(createStructuredCloneCheckerMiddleware());
    }

    const { enabled: enableReduxLogger, webviewName } = getReduxLoggerConfig();

    if (enableReduxLogger) {
      debugMiddlewares.push(createLoggerMiddleware(webviewName));
    }
  }

  return [...baseMiddleware, ...debugMiddlewares];
}

export const middleware: Middleware<any, StoreState, any>[] = buildMiddleware();
