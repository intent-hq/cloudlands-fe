/**
 * Pure parsers for `/workspace/{id}` routes. Dependency-light (no store, no
 * `$app/*`) so main-process-graph modules can import it.
 *
 * Two questions, one grammar:
 * - {@link workspaceIdOwningPath}: which workspace owns the screen at this
 *   path? Sub-routes (`/workspace/{id}/files`) count — they still show that
 *   workspace.
 * - {@link parseWorkspaceRoute}: is this route a jump to a workspace *page*,
 *   which should also open that workspace's tab (`show-workspace`)? Only the
 *   page itself counts; sub-routes navigate without touching the tab strip.
 *
 * Both decode the id and reject the non-workspace pages that share the
 * `/workspace/` prefix ({@link RESERVED_WORKSPACE_SEGMENTS}).
 */

/** `/workspace/<segment>` pages that are not a workspace. */
const RESERVED_WORKSPACE_SEGMENTS: ReadonlySet<string> = new Set(['new', 'creating']);

/** The decoded workspace id in a raw route segment, or null when it is not one. */
function decodeWorkspaceSegment(segment: string): string | null {
  let workspaceId: string;
  try {
    workspaceId = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return workspaceId.length === 0 || RESERVED_WORKSPACE_SEGMENTS.has(workspaceId)
    ? null
    : workspaceId;
}

/**
 * The decoded workspace id of an in-app workspace page route
 * (`/workspace/<id>`, optional trailing slash, search and hash), or null for
 * other routes, sub-routes and the reserved `/workspace/new` and
 * `/workspace/creating` pages.
 */
export function parseWorkspaceRoute(route: string): string | null {
  const match = /^\/workspace\/([^/?#]+)\/?(?:[?#].*)?$/.exec(route);
  return match ? decodeWorkspaceSegment(match[1]) : null;
}

/**
 * The decoded id of the workspace that owns `path` — its page route or any of
 * its sub-routes — or null for every other route.
 */
export function workspaceIdOwningPath(path: string): string | null {
  const match = /^\/workspace\/([^/?#]+)(?:[/?#].*)?$/.exec(path);
  return match ? decodeWorkspaceSegment(match[1]) : null;
}

/** True when `path` is the workspace's route or one of its sub-routes. */
export function isWorkspaceRoutePath(path: string, workspaceId: string): boolean {
  return workspaceId.length > 0 && workspaceIdOwningPath(path) === workspaceId;
}

/** The renderer's current route path, or null outside a DOM environment. */
export function currentRoutePath(): string | null {
  return typeof window === 'undefined' ? null : (window.location?.pathname ?? null);
}
