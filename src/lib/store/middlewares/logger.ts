import type { Middleware } from "redux";

/**
 * Logger middleware - logs dispatched actions and state changes.
 * Only active when debug flag is enabled in localStorage.
 */
export function createLoggerMiddleware(webviewName?: string): Middleware {
  return (_store) => (next) => (action) => {
    return next(action);
  };
}

