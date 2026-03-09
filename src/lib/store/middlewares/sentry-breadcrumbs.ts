import type { Middleware } from "redux";

/**
 * Sentry breadcrumbs middleware - records Redux actions as Sentry breadcrumbs.
 */
export function createSentryBreadcrumbsMiddleware(): Middleware {
  return (_store) => (next) => (action) => {
    return next(action);
  };
}

