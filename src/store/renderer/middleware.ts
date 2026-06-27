/*
  List of middlewares to run, order in this list
  defines order of execution
*/

import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
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
import { createGitReadMiddleware } from "$features/git/git-read-service";
import { createAgentReadMiddleware } from "$features/agent/agent-read-service";
import { safeLocalStorage } from "$lib/utils/safe-storage";

const isDevBuild = (): boolean => Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

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

function buildMiddleware(): StoreMiddleware[] {
  const baseMiddleware: StoreMiddleware[] = [
    // Guard must be first — reject actions tagged for the wrong store immediately
    createStoreGuardMiddleware("renderer"),
    // No action types to batch yet — add action types here as slices are added
    createBatchingMiddleware([]),
    // Add Sentry breadcrumbs middleware to track Redux actions
    createSentryBreadcrumbsMiddleware(),
    // Give the (post-saga) `loadGitStatus` action a real read handler so the
    // ~13 dispatch sites refresh git status on demand again.
    createGitReadMiddleware(),
    // Give the (post-saga) `ensureAgentSessionLoaded` action a real read handler
    // so a selected agent's session/conversation hydrates on demand again.
    createAgentReadMiddleware(),
  ];

  // Debug middlewares need to be added AFTER batching middleware
  // so they see the actual state changes, not the batched actions
  const debugMiddlewares: StoreMiddleware[] = [];

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

export const middleware: StoreMiddleware[] = buildMiddleware();
