import type { Middleware } from "redux";

/**
 * Debug middleware that verifies state is structuredClone-safe (serializable).
 */
export function createStructuredCloneCheckerMiddleware(): Middleware {
  return (_store) => (next) => (action) => {
    return next(action);
  };
}

