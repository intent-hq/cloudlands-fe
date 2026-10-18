/**
 * Window ↔ Workspace tracking utilities.
 *
 * Pure helper extracted from system.ipc.ts so the open-workspace logic
 * can be unit-tested without mocking the entire Electron IPC surface.
 */

export interface WindowChecker {
  /** Return true when the Electron window with this id is still alive. */
  isAlive(windowId: number): boolean;
}

/**
 * Explicit "any host" scope for window lookups. Workspace ids are only unique
 * per host (the Assistant's virtual workspace id is the same constant on
 * every daemon), so a host-unaware lookup can return windows connected to a
 * different host than the one that owns the workspace. Pass this only when the
 * caller genuinely has no host (or is itself resolving the host from the
 * windows), and say why at the call site.
 */
// A registered symbol, so module reloads (tests, HMR) share one identity.
export const ANY_HOST: unique symbol = Symbol.for('intent.window-host-scope.any');

/**
 * Which host's windows a workspace lookup may return: the backend (daemon
 * connection) id that owns the workspace, or the explicit {@link ANY_HOST}
 * opt-out. Required on every workspace → window lookup so a caller cannot
 * forget the host.
 */
export type WindowHostScope = string | typeof ANY_HOST;

/** The workspace a window is actively viewing, recorded with the window's host. */
export interface ActiveWorkspaceEntry {
  workspaceId: string;
  /** Backend id the window was connected to when it reported the workspace. */
  backendId: string;
}

/** The workspace tabs open in a window, recorded with the window's host. */
export interface OpenWorkspaceTabsEntry {
  workspaceIds: string[];
  /** Backend id the window was connected to when it reported its tabs. */
  backendId: string;
}

export interface WindowHostChecker extends WindowChecker {
  /** The backend id the live window is connected to right now. */
  backendIdOf(windowId: number): string;
}

/**
 * Whether an entry recorded for `windowId` on `recordedBackendId` is in
 * `scope`. An entry only counts while the window is still connected to the
 * host it was recorded on: a window that reconnected to another host no
 * longer holds the old host's workspace, even if it has not re-reported yet.
 */
function entryMatchesScope(
  windowId: number,
  recordedBackendId: string,
  scope: WindowHostScope,
  checker: WindowHostChecker,
): boolean {
  if (checker.backendIdOf(windowId) !== recordedBackendId) return false;
  return scope === ANY_HOST || scope === recordedBackendId;
}

/**
 * Collect every workspace ID that is "open" — either actively viewed in a
 * window or present in that window's tab bar.
 *
 * Any windowId that fails the `isAlive` check is removed from **both** maps
 * as a side-effect (stale-entry cleanup).
 */
export function collectOpenWorkspaceIds(
  windowWorkspaceIds: Map<number, ActiveWorkspaceEntry>,
  windowOpenWorkspaceTabs: Map<number, OpenWorkspaceTabsEntry>,
  checker: WindowChecker,
): string[] {
  const workspaceIds = new Set<string>();
  const staleWindowIds: number[] = [];

  // Collect all window IDs that appear in either map
  const allWindowIds = new Set<number>([
    ...windowWorkspaceIds.keys(),
    ...windowOpenWorkspaceTabs.keys(),
  ]);

  for (const windowId of allWindowIds) {
    if (checker.isAlive(windowId)) {
      // Include the actively viewed workspace (if any)
      const active = windowWorkspaceIds.get(windowId);
      if (active) {
        workspaceIds.add(active.workspaceId);
      }

      // Include all workspace tabs open in this window.
      // A window may have tabs without an active workspace entry
      // (e.g., when the user navigates to the home/settings page).
      const openTabs = windowOpenWorkspaceTabs.get(windowId);
      if (openTabs) {
        for (const tabWsId of openTabs.workspaceIds) {
          workspaceIds.add(tabWsId);
        }
      }
    } else {
      staleWindowIds.push(windowId);
    }
  }

  // Clean up stale entries
  for (const windowId of staleWindowIds) {
    windowWorkspaceIds.delete(windowId);
    windowOpenWorkspaceTabs.delete(windowId);
  }

  return [...workspaceIds];
}

/**
 * Collect all window IDs that have a specific workspace open — either as the
 * actively viewed workspace or in that window's tab bar — on the host(s)
 * allowed by `scope`.
 *
 * Any windowId that fails the `isAlive` check is removed from **both** maps
 * as a side-effect (stale-entry cleanup).
 */
export function collectWindowIdsForWorkspace(
  workspaceId: string,
  scope: WindowHostScope,
  windowWorkspaceIds: Map<number, ActiveWorkspaceEntry>,
  windowOpenWorkspaceTabs: Map<number, OpenWorkspaceTabsEntry>,
  checker: WindowHostChecker,
): number[] {
  const matchingWindowIds: number[] = [];
  const staleWindowIds: number[] = [];

  // Collect all window IDs that appear in either map
  const allWindowIds = new Set<number>([
    ...windowWorkspaceIds.keys(),
    ...windowOpenWorkspaceTabs.keys(),
  ]);

  for (const windowId of allWindowIds) {
    if (checker.isAlive(windowId)) {
      // Check if this window has the workspace as the active workspace
      const active = windowWorkspaceIds.get(windowId);
      if (
        active?.workspaceId === workspaceId &&
        entryMatchesScope(windowId, active.backendId, scope, checker)
      ) {
        matchingWindowIds.push(windowId);
        continue; // Already matched, no need to check tabs
      }

      // Check if this window has the workspace in its tab bar
      const openTabs = windowOpenWorkspaceTabs.get(windowId);
      if (
        openTabs?.workspaceIds.includes(workspaceId) &&
        entryMatchesScope(windowId, openTabs.backendId, scope, checker)
      ) {
        matchingWindowIds.push(windowId);
      }
    } else {
      staleWindowIds.push(windowId);
    }
  }

  // Clean up stale entries
  for (const windowId of staleWindowIds) {
    windowWorkspaceIds.delete(windowId);
    windowOpenWorkspaceTabs.delete(windowId);
  }

  return matchingWindowIds;
}
