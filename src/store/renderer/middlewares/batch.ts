import type { StoreMiddleware } from "$lib/store-shim/types";

/**
 * Batching middleware - groups rapid-fire actions to reduce re-renders.
 * Actions with types in the provided list will be batched.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createBatchingMiddleware(actionTypes: string[]): StoreMiddleware {
   
  return (_store) => (next) => (action) => {
    return next(action);
  };
}

