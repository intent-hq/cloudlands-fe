import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { CatalogApp } from '@/catalog/catalog-app';

const rootRoute = createRootRoute({
  validateSearch: (search: Record<string, unknown>) => search,
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/sandbox', search });
  },
});
const sandboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sandbox',
  validateSearch: (search: Record<string, unknown>) => search,
  component: CatalogApp,
});
const sceneRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sandbox/$',
  validateSearch: (search: Record<string, unknown>) => search,
  component: CatalogApp,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, sandboxRoute, sceneRoute]),
  // The existing sandbox contract uses ordinary URLSearchParams. Preserve
  // numeric state names and widths without TanStack's JSON-string quoting.
  parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
  stringifySearch: (search) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const query = params.toString();
    return query ? `?${query}` : '';
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
