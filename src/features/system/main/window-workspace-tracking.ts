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
 * Collect every workspace ID that is "open" — either actively viewed in a
 * window or present in that window's tab bar.
 *
 * Any windowId that fails the `isAlive` check is removed from **both** maps
 * as a side-effect (stale-entry cleanup).
 */
export function collectOpenWorkspaceIds(
  windowWorkspaceIds: Map<number, string>,
  windowOpenWorkspaceTabs: Map<number, string[]>,
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
      const activeWsId = windowWorkspaceIds.get(windowId);
      if (activeWsId) {
        workspaceIds.add(activeWsId);
      }

      // Include all workspace tabs open in this window.
      // A window may have tabs without an active workspace entry
      // (e.g., when the user navigates to the home/settings page).
      const openTabs = windowOpenWorkspaceTabs.get(windowId);
      if (openTabs) {
        for (const tabWsId of openTabs) {
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
