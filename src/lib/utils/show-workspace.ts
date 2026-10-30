/**
 * The one way to jump to a workspace: navigate to its route, then open (and
 * focus) its workspace tab.
 *
 * In-app navigation never opens a tab by itself — only boot-time routing in
 * `+layout.svelte` does — so a bare `goto('/workspace/<id>')` to a workspace
 * that is not in the tab strip shows its page with no tab. Every caller goes
 * through this module instead; the `intent/no-raw-workspace-navigation` lint
 * rule flags hand-written workspace navigation elsewhere.
 *
 * The tab opens only once navigation resolves, so a failed navigation never
 * leaves a stray focused tab; navigation errors are rethrown to the caller.
 * The HUD pop-out window never navigates (see `navigateToRoute`), so the
 * helper does nothing there.
 */
import { call, put, type SagaGenerator } from 'typed-redux-saga';
import { store as appStore } from '$store/renderer/store';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { navigateToRoute } from './navigation.client';

export interface ShowWorkspaceOptions {
  /** Search params for the workspace route (e.g. `{ note: id }`, `{ panel: 'terminal' }`). */
  query?: Readonly<Record<string, string>>;
  /**
   * Page state forwarded to `goto`. A `presenceFollowRequestId` is also passed
   * to `openWorkspaceTab` so presence follow recognises its own tab projection.
   */
  state?: App.PageState;
}

/** The encoded `/workspace/<id>` route, with optional search params. */
export function workspaceRoute(workspaceId: string, query?: ShowWorkspaceOptions['query']): string {
  const path = `/workspace/${encodeURIComponent(workspaceId)}`;
  const search = query ? new URLSearchParams(query).toString() : '';
  return search ? `${path}?${search}` : path;
}

/** Same guard as `navigateToRoute`: the HUD pop-out window never leaves /hud. */
function isHudWindow(): boolean {
  return typeof window !== 'undefined' && (window.location?.pathname ?? '').startsWith('/hud');
}

/** The tab action, tagged with a presence-follow request id only when one is present. */
function openTabAction(workspaceId: string, state: App.PageState | undefined) {
  const requestId = state?.presenceFollowRequestId;
  return requestId ? openWorkspaceTab(workspaceId, requestId) : openWorkspaceTab(workspaceId);
}

/** Navigate with `goto` page state only when there is some (keeps plain calls plain). */
function navigate(route: string, state: App.PageState | undefined): Promise<void> {
  return state ? navigateToRoute(route, { state }) : navigateToRoute(route);
}

/**
 * Navigate to `workspaceId` and open its tab. Resolves `true` once the
 * navigation resolved and the tab is focused; `false` when nothing happened
 * (empty id or the HUD window).
 */
export async function openAndShowWorkspace(
  workspaceId: string,
  options: ShowWorkspaceOptions = {},
): Promise<boolean> {
  if (!workspaceId || isHudWindow()) return false;
  await navigate(workspaceRoute(workspaceId, options.query), options.state);
  appStore.dispatch(openTabAction(workspaceId, options.state));
  return true;
}

/** Saga form of {@link openAndShowWorkspace}: same contract, tab opened with `put`. */
export function* showWorkspaceSaga(
  workspaceId: string,
  options: ShowWorkspaceOptions = {},
): SagaGenerator<boolean> {
  if (!workspaceId || isHudWindow()) return false;
  yield* call(navigate, workspaceRoute(workspaceId, options.query), options.state);
  yield* put(openTabAction(workspaceId, options.state));
  return true;
}
