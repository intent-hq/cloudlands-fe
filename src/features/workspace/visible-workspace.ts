/**
 * The workspace actually on screen — the one source for features that act on
 * "the current workspace" (hardware-console keys, encoder, voice).
 *
 * Home and Settings leave the last workspace as the current workspace tab
 * (`tabState.currentTabId`), so the tab id alone does not prove that
 * workspace is visible. The visible workspace is the current tab only while
 * the route belongs to it (sub-routes included) — or while a navigation to it
 * that already selected its tab is still in flight: the route only commits
 * once `goto` settles, and a quick follow-up press in that window must act on
 * the workspace being opened, not on the page being left.
 *
 * When the route is unknown (no DOM), the current tab is trusted, matching
 * `show-workspace`'s landing check.
 *
 * Dependency-light: reads `appStore.state` straight, no selector imports, so
 * device services and the store middleware graph can import it eagerly.
 */
import { store as appStore } from '$store/renderer/store';
import { currentRoutePath, isWorkspaceRoutePath } from '$lib/utils/workspace-route-path';

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
  if (typeof currentTabId !== 'string' || currentTabId.length === 0) return null;
  if (path === null) return currentTabId;
  if (isWorkspaceRoutePath(path, currentTabId)) return currentTabId;
  return pendingWorkspaceId === currentTabId ? currentTabId : null;
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
