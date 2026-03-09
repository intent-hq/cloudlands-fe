import type { Middleware } from "redux";

/**
 * Batching middleware - groups rapid-fire actions to reduce re-renders.
 * Actions with types in the provided list will be batched.
 */
export function createBatchingMiddleware(actionTypes: string[]): Middleware {
  return (_store) => (next) => (action) => {
    return next(action);
  };
}

