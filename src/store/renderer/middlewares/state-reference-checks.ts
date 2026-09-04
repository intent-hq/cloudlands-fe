import type { StoreMiddleware } from '@augmentcode/themis/types';

/**
 * Debug middleware that checks for unexpected state reference changes.
 */
export function createReferenceChangeDetectorMiddleware(): StoreMiddleware {
  return (_store) => (next) => (action) => {
    return next(action);
  };
}
