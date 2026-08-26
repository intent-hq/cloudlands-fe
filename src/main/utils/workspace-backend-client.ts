/**
 * Resolve the backend connection that owns a workspace, keyed off the windows
 * currently hosting it (monorepo#3501).
 *
 * Electron `protocol.handle` requests do not expose the initiating
 * webContents, so the workspace-file:// and workspace-asset:// handlers cannot
 * ask "which window issued this fetch?". Instead they resolve the owning
 * backend from the main-side window-tracking maps: any window hosting the
 * workspace (actively routed or in its tab bar) is bound to the backend the
 * workspace lives on. When no hosting window is found — or the resolved
 * backend has no live pooled client — the app-primary compatibility client is
 * used, preserving the pre-per-window-connections (#1572) behavior.
 *
 * Dependency-light by design: callers inject the lookups so this stays
 * unit-testable without Electron or the backend client pool.
 */

export interface WorkspaceBackendLookup<C> {
  /** Window ids currently hosting the workspace (active view or tab bar). */
  getWindowIdsForWorkspace(workspaceId: string): number[];
  /** Backend id a window is stamped with, or null for a dead window. */
  getBackendIdForWindowId(windowId: number): string | null;
  /** Live pooled client for a backend id, if one is connected. */
  getClientForBackend(backendId: string): C | undefined;
  /** The app-primary compatibility client (legacy fallback). */
  getPrimaryClient(): C;
}

export interface WorkspaceBackendResolution<C> {
  client: C;
  /** The backend id the client was resolved to, or null for the primary fallback. */
  backendId: string | null;
}

/**
 * Pick the backend client that owns `workspaceId`: the first hosting window
 * whose backend has a live pooled client wins; otherwise the primary client.
 */
export function resolveWorkspaceBackendClient<C>(
  workspaceId: string,
  lookup: WorkspaceBackendLookup<C>,
): WorkspaceBackendResolution<C> {
  const seen = new Set<string>();
  for (const windowId of lookup.getWindowIdsForWorkspace(workspaceId)) {
    const backendId = lookup.getBackendIdForWindowId(windowId);
    if (!backendId || seen.has(backendId)) continue;
    seen.add(backendId);
    const client = lookup.getClientForBackend(backendId);
    if (client) return { client, backendId };
  }
  return { client: lookup.getPrimaryClient(), backendId: null };
}
