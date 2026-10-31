/**
 * The workspace actually on screen — the one source for features that act on
 * "the current workspace" (hardware-console keys, encoder, voice).
 *
 * Home and Settings leave the last workspace as the current workspace tab
 * (`tabState.currentTabId`), so the tab id alone does not prove that
 * workspace is visible. In order:
 * 1. A navigation that already selected its tab and is still in flight wins:
 *    the route only commits once `goto` settles, and a quick follow-up press
 *    in that window must act on the workspace being opened, not on the page
 *    being left.
 * 2. Otherwise the route decides: the workspace that owns it (sub-routes
 *    included), even before its tab is selected — `show-workspace` opens the
 *    tab only after the navigation lands.
 * 3. A non-workspace route (Home, Settings) shows no workspace.
 *
 * When the route is unknown (no DOM), the current tab is trusted, matching
 * `show-workspace`'s landing check.
 *
 * Dependency-light: reads `appStore.state` straight, no selector imports, so
 * device services can import it eagerly. Read it at call time only — the
 * store module itself must not import it (that would be a cycle).
 */
import { store as appStore } from '$store/renderer/store';
import { currentRoutePath, workspaceIdOwningPath } from '$lib/utils/workspace-route-path';

/**
 * The latest pending navigation. Each attempt is a fresh object so an older
 * navigation to the same workspace (A → B → A) cannot clear the newest one
 * when it settles.
 */
let pendingNavigation: { workspaceId: string } | null = null;

/** The visible workspace for an explicit tab id and route path (pure). */
export function resolveVisibleWorkspaceId(
  currentTabId: string | null | undefined,
  path: string | null,
  pendingWorkspaceId: string | null = null,
): string | null {
  const tabId = typeof currentTabId === 'string' && currentTabId.length > 0 ? currentTabId : null;
  if (tabId !== null && pendingWorkspaceId === tabId) return tabId;
  if (path === null) return tabId;
  return workspaceIdOwningPath(path);
}

/** The workspace on screen now, or null on Home, Settings and other routes. */
export function getVisibleWorkspaceId(): string | null {
  return resolveVisibleWorkspaceId(
    appStore.state.tabState?.currentTabId,
    currentRoutePath(),
    pendingNavigation?.workspaceId ?? null,
  );
}

/**
 * Mark a navigation to `workspaceId` as in flight. Callers select its tab
 * first, then start the navigation, and call the returned `settle` once it
 * resolves or fails; a newer navigation supersedes this one.
 */
export function beginVisibleWorkspaceNavigation(workspaceId: string): () => void {
  const attempt = { workspaceId };
  pendingNavigation = attempt;
  return () => {
    if (pendingNavigation === attempt) pendingNavigation = null;
  };
}

/** Forget any pending navigation. Tests only. */
export function resetVisibleWorkspaceNavigationForTests(): void {
  pendingNavigation = null;
}
