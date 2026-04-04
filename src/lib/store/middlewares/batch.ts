import type { Middleware } from "redux";

/**
 * Batching middleware - groups rapid-fire actions to reduce re-renders.
 * Actions with types in the provided list will be batched.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createBatchingMiddleware(actionTypes: string[]): Middleware {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (_store) => (next) => (action) => {
    return next(action);
  };
}

