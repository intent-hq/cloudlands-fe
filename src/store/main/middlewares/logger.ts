/**
 * Main-process Redux logger middleware.
 *
 * Uses the shared Logger (structured logging) instead of console.log,
 * since there is no DOM or localStorage in the main process.
 */

import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";

import { Logger } from "../../../shared/logger";

const logger = new Logger("MainRedux");

/**
 * Creates a structured logger middleware for the main-process Redux store.
 * Only logs action type and payload size to avoid flooding logs.
 */
export const createMainLoggerMiddleware = (): StoreMiddleware => {
  return (store) => (next) => (action) => {
    const typedAction = action as { type: string; payload?: unknown };
    const prevState = store.getState();

    const result = next(action);

    const nextState = store.getState();
    const stateChanged = prevState !== nextState;

    logger.debug(`action: ${typedAction.type}`, {
      stateChanged,
    });

    return result;
  };
};
