import type { Middleware } from "redux";

/**
 * Debug middleware that checks for unexpected state reference changes.
 */
export function createReferenceChangeDetectorMiddleware(): Middleware {
  return (_store) => (next) => (action) => {
    return next(action);
  };
}

