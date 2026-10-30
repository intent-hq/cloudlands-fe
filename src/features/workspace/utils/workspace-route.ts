/**
 * Pure route predicates for the `/workspace/{id}` surface. Dependency-light so
 * main-process-graph modules (navigate-away-if-viewing) can import it.
 */

/** True when `path` is the workspace's route or one of its sub-routes. */
export function isWorkspaceRoutePath(path: string, workspaceId: string): boolean {
  const prefix = `/workspace/${workspaceId}`;
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** The renderer's current route path, or null outside a DOM environment. */
export function currentRoutePath(): string | null {
  return typeof window === 'undefined' ? null : window.location.pathname;
}
