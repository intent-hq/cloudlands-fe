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
  /** The backend id the window is connected to right now, or null if it is gone. */
  backendIdOf(windowId: number): string | null;
}

/**
 * Whether an entry recorded for `windowId` on `recordedBackendId` is in
 * `scope`. An entry only counts while the window is still connected to the
 * host it was recorded on: a window that reconnected to another host no
 * longer holds the old host's workspace, even if it has not re-reported yet.
 */
export function entryMatchesScope(
  windowId: number,
  recordedBackendId: string,
  scope: WindowHostScope,
  checker: WindowHostChecker,
): boolean {
  const currentBackendId = checker.backendIdOf(windowId);
  if (currentBackendId === null || currentBackendId !== recordedBackendId) return false;
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
  windowBackgroundWorkspaces: Map<number, OpenWorkspaceTabsEntry> = new Map(),
): string[] {
  const workspaceIds = new Set<string>();
  const staleWindowIds: number[] = [];

  // Collect all window IDs that appear in any map
  const allWindowIds = new Set<number>([
    ...windowWorkspaceIds.keys(),
    ...windowOpenWorkspaceTabs.keys(),
    ...windowBackgroundWorkspaces.keys(),
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

      // Include workspaces the window hosts in the background for agent
      // browser ops (no tab, never displayed) so they are not treated as
      // orphaned while their offscreen tabs are alive.
      const background = windowBackgroundWorkspaces.get(windowId);
      if (background) {
        for (const backgroundWsId of background.workspaceIds) {
          workspaceIds.add(backgroundWsId);
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
    windowBackgroundWorkspaces.delete(windowId);
  }

  return [...workspaceIds];
}

/**
 * Collect all window IDs that have a specific workspace open — as the
 * actively viewed workspace or in that window's tab bar — on the host(s)
 * allowed by `scope`; when none does, the windows hosting it in the
 * background for agent browser ops.
 *
 * Any windowId that fails the `isAlive` check is removed from **every** map
 * as a side-effect (stale-entry cleanup).
 */
export function collectWindowIdsForWorkspace(
  workspaceId: string,
  scope: WindowHostScope,
  windowWorkspaceIds: Map<number, ActiveWorkspaceEntry>,
  windowOpenWorkspaceTabs: Map<number, OpenWorkspaceTabsEntry>,
  checker: WindowHostChecker,
  windowBackgroundWorkspaces: Map<number, OpenWorkspaceTabsEntry> = new Map(),
): number[] {
  const matchingWindowIds: number[] = [];
  const backgroundWindowIds: number[] = [];
  const staleWindowIds: number[] = [];

  // Collect all window IDs that appear in any map
  const allWindowIds = new Set<number>([
    ...windowWorkspaceIds.keys(),
    ...windowOpenWorkspaceTabs.keys(),
    ...windowBackgroundWorkspaces.keys(),
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
        continue;
      }

      // Check if this window hosts the workspace in the background
      const background = windowBackgroundWorkspaces.get(windowId);
      if (
        background?.workspaceIds.includes(workspaceId) &&
        entryMatchesScope(windowId, background.backendId, scope, checker)
      ) {
        backgroundWindowIds.push(windowId);
      }
    } else {
      staleWindowIds.push(windowId);
    }
  }

  // Clean up stale entries
  for (const windowId of staleWindowIds) {
    windowWorkspaceIds.delete(windowId);
    windowOpenWorkspaceTabs.delete(windowId);
    windowBackgroundWorkspaces.delete(windowId);
  }

  // Background hosting only stands in while no window on the same host
  // genuinely has the workspace open: once one does, it alone receives the
  // workspace's messages, so a stale background host never doubles them. A
  // window open on another host does not count — workspace ids are only
  // unique per host, so it cannot stand in for this host's workspace.
  const openHosts = new Set(matchingWindowIds.map((windowId) => checker.backendIdOf(windowId)));
  return [
    ...matchingWindowIds,
    ...backgroundWindowIds.filter((windowId) => !openHosts.has(checker.backendIdOf(windowId))),
  ];
}

/**
 * Pick the window that should host `workspaceId` in the background when no
 * window has it open: the first live candidate (callers pass the focused
 * window first) still connected to `backendId`, the host that owns the
 * workspace. Candidates must be app windows that run the workspace shell
 * (they report their tab strip), so the browser IPC saga and the offscreen
 * webview host exist there. Returns undefined when none qualifies.
 */
export function pickBackgroundHostWindow(
  backendId: string,
  candidateWindowIds: Iterable<number>,
  checker: WindowHostChecker,
): number | undefined {
  for (const windowId of candidateWindowIds) {
    if (checker.isAlive(windowId) && checker.backendIdOf(windowId) === backendId) {
      return windowId;
    }
  }
  return undefined;
}
