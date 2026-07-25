/**
 * Navigate-away helper shared by the workspace removal paths.
 *
 * Extracted from `workspace-operations-service.ts` so the workspace list
 * subscription can reuse the exact tab-closing + goto flow when a workspace is
 * deleted by another client (module-boundary rules forbid exporting utilities
 * from orchestration modules). Dependency-light per src/store/renderer/AGENTS.md:
 * the tab-state slice/selectors are dynamically imported inside the handler so
 * `store.createSelector` is never evaluated while the store is still
 * initializing, and this module never statically pulls in `$app/*` navigation.
 */
import { store as appStore } from '$store/renderer/store';

function isViewingWorkspace(workspaceId: string): boolean {
  if (typeof window === 'undefined') return false;
  const prefix = `/workspace/${workspaceId}`;
  const path = window.location.pathname;
  return path === prefix || path.startsWith(prefix + '/');
}

/**
 * When the removed workspace is the one on screen, close its tab and route to
 * the next tab (or home). Uses the global SvelteKit `goto` that `+layout.svelte`
 * exposes on `window.__app_goto` so this module never imports `$app/*` — which
 * the (pre-existing) main-process typecheck graph cannot resolve.
 */
export async function navigateAwayIfViewing(workspaceId: string): Promise<void> {
  if (!isViewingWorkspace(workspaceId)) return;
  const { closeWorkspaceTab } = await import('$store/renderer/slices/tab-state/tab-state-slice');
  const { selectCurrentWorkspaceTabId } =
    await import('$store/renderer/slices/tab-state/tab-state-selectors');

  appStore.dispatch(closeWorkspaceTab(workspaceId));
  const nextTabId = selectCurrentWorkspaceTabId.select(appStore.state);
  const target =
    typeof nextTabId === 'string' && nextTabId.length > 0 && nextTabId !== workspaceId
      ? `/workspace/${nextTabId}`
      : '/';

  const goto = (window as unknown as { __app_goto?: (route: string) => unknown }).__app_goto;
  if (goto) await goto(target);
}
