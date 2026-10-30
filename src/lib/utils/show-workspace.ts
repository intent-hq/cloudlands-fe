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
 * SvelteKit resolves (does not reject) a `goto` that a later navigation
 * abandoned, so a resolved jump also opens no tab when it was overtaken:
 * - by any later navigation through this module or `navigateToRoute`
 *   (spinning the hardware encoder through several workspaces only tabs the
 *   one it lands on; an encoder click to Home cancels a pending jump);
 * - by another workspace tab being selected (a tab-strip click selects its
 *   tab before its raw `goto`); or
 * - by any other navigation that left the window on a different route
 *   (browser back).
 * The HUD pop-out window never navigates (see `navigateToRoute`), so the
 * helper does nothing there.
 */
import { call, put, select, type SagaGenerator } from 'typed-redux-saga';
import { store as appStore } from '$store/renderer/store';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { isHudWindowRenderer } from './hud-window';
import { navigateToRoute } from './navigation.client';
import { bumpNavigationEpoch, navigationEpoch } from './navigation-epoch';

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

/**
 * The decoded workspace id of an in-app workspace page route
 * (`/workspace/<id>`, optional trailing slash, search and hash), or null for
 * other routes, sub-routes and the `/workspace/new` creation page.
 */
export function parseWorkspaceRoute(route: string): string | null {
  const match = /^\/workspace\/([^/?#]+)\/?(?:[?#].*)?$/.exec(route);
  if (!match) return null;
  let workspaceId: string;
  try {
    workspaceId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return workspaceId === 'new' ? null : workspaceId;
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

function currentPathname(): string | null {
  return typeof window === 'undefined' ? null : (window.location?.pathname ?? null);
}

type TabStateLike = { tabState?: { currentTabId?: string | null } } | undefined;

/** The selected workspace tab; sagas read it with `select`, promise callers from the app store. */
function tabIdOf(state: TabStateLike): string | null {
  return state?.tabState?.currentTabId ?? null;
}

interface Jump {
  workspaceId: string;
  /** Navigation epoch just after this jump's navigation started. */
  epoch: number;
  startPathname: string | null;
  startTabId: string | null;
}

/**
 * Start a jump's navigation and resolve with the jump once it resolves (call
 * only after {@link skipJump} said go). The epoch is read right after the
 * navigation started, so only later navigations count as overtaking it; the
 * helper bumps it itself too, so jumps supersede each other even where
 * `navigateToRoute` is mocked.
 */
async function runJump(
  workspaceId: string,
  route: string,
  state: App.PageState | undefined,
  startTabId: string | null,
): Promise<Jump> {
  const startPathname = currentPathname();
  bumpNavigationEpoch();
  const navigation = navigate(route, state);
  const jump = { workspaceId, epoch: navigationEpoch(), startPathname, startTabId };
  await navigation;
  return jump;
}

/** Nothing to do for an empty id or in the HUD window. */
function skipJump(workspaceId: string): boolean {
  return !workspaceId || isHudWindowRenderer();
}

/**
 * Whether a resolved jump's navigation still owns the window:
 * - no later navigation started through this module or `navigateToRoute`;
 * - no other workspace tab was selected meanwhile (a tab-strip click selects
 *   its tab before navigating);
 * - the window is on the target workspace. A window still on a non-workspace
 *   start route also counts (navigation stubs in tests do not move the URL);
 *   one on another route was overtaken by a different navigation.
 */
function jumpLanded(jump: Jump, tabId: string | null): boolean {
  if (navigationEpoch() !== jump.epoch) return false;
  if (tabId !== jump.startTabId && tabId !== jump.workspaceId) return false;
  const pathname = currentPathname();
  if (pathname === null) return true;
  if (parseWorkspaceRoute(pathname) === jump.workspaceId) return true;
  return pathname === jump.startPathname && parseWorkspaceRoute(pathname) === null;
}

async function showAt(
  workspaceId: string,
  route: string,
  state: App.PageState | undefined,
): Promise<boolean> {
  if (skipJump(workspaceId)) return false;
  const jump = await runJump(workspaceId, route, state, tabIdOf(appStore.state as TabStateLike));
  if (!jumpLanded(jump, tabIdOf(appStore.state as TabStateLike))) return false;
  appStore.dispatch(openTabAction(workspaceId, state));
  return true;
}

function* showAtSaga(
  workspaceId: string,
  route: string,
  state: App.PageState | undefined,
): SagaGenerator<boolean> {
  if (skipJump(workspaceId)) return false;
  const startTabId = tabIdOf(yield* select((s: TabStateLike) => s));
  const jump = yield* call(runJump, workspaceId, route, state, startTabId);
  if (!jumpLanded(jump, tabIdOf(yield* select((s: TabStateLike) => s)))) return false;
  yield* put(openTabAction(workspaceId, state));
  return true;
}

/**
 * Navigate to `workspaceId` and open its tab. Resolves `true` once the
 * navigation resolved and the tab is focused; `false` when no tab opened
 * (empty id, the HUD window, or another navigation overtook this one).
 */
export function openAndShowWorkspace(
  workspaceId: string,
  options: ShowWorkspaceOptions = {},
): Promise<boolean> {
  return showAt(workspaceId, workspaceRoute(workspaceId, options.query), options.state);
}

/** Saga form of {@link openAndShowWorkspace}: same contract, tab opened with `put`. */
export function showWorkspaceSaga(
  workspaceId: string,
  options: ShowWorkspaceOptions = {},
): SagaGenerator<boolean> {
  return showAtSaga(workspaceId, workspaceRoute(workspaceId, options.query), options.state);
}

/**
 * Navigate to an in-app route that arrives as a string (Electron menu IPC, a
 * remembered previous path, a chat nav link). A workspace page route also
 * opens its tab, like {@link openAndShowWorkspace}; the route itself
 * (query and hash included) is navigated unchanged.
 */
export async function navigateToAppRoute(route: string): Promise<void> {
  const workspaceId = parseWorkspaceRoute(route);
  if (workspaceId) await showAt(workspaceId, route, undefined);
  else await navigateToRoute(route);
}

/** Saga form of {@link navigateToAppRoute}. */
export function* navigateToAppRouteSaga(route: string): SagaGenerator<void> {
  const workspaceId = parseWorkspaceRoute(route);
  if (workspaceId) yield* call(showAtSaga, workspaceId, route, undefined);
  else yield* call(navigateToRoute, route);
}
