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
 * The tab opens only once navigation resolves AND the window is on the
 * workspace route, so a failed, cancelled or HUD-suppressed navigation never
 * leaves a stray focused tab. Navigation errors are rethrown to the caller.
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

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Whether this window currently shows `workspaceId`'s route. */
function isShowingWorkspaceRoute(workspaceId: string): boolean {
  if (typeof window === 'undefined') return false;
  const match = (window.location?.pathname ?? '').match(/^\/workspace\/([^/]+)/);
  return match ? decodeSegment(match[1]) === workspaceId : false;
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
 * workspace is showing with its tab focused; `false` when nothing happened
 * (empty id, HUD window, or the navigation was superseded).
 */
export async function openAndShowWorkspace(
  workspaceId: string,
  options: ShowWorkspaceOptions = {},
): Promise<boolean> {
  if (!workspaceId) return false;
  await navigate(workspaceRoute(workspaceId, options.query), options.state);
  if (!isShowingWorkspaceRoute(workspaceId)) return false;
  appStore.dispatch(openTabAction(workspaceId, options.state));
  return true;
}

/** Saga form of {@link openAndShowWorkspace}: same contract, tab opened with `put`. */
export function* showWorkspaceSaga(
  workspaceId: string,
  options: ShowWorkspaceOptions = {},
): SagaGenerator<boolean> {
  if (!workspaceId) return false;
  yield* call(navigate, workspaceRoute(workspaceId, options.query), options.state);
  if (!isShowingWorkspaceRoute(workspaceId)) return false;
  yield* put(openTabAction(workspaceId, options.state));
  return true;
}
