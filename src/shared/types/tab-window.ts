/**
 * Tab windows — shared contract (main ⇄ renderer).
 *
 * Any panel tab can move to a window of its own (design §3). The tab window
 * is a frame whose machine view loads `/tab-window/<id>` and shows that one
 * tab. Main keeps the registry of tab windows and saves them with the frames
 * in window-frames.json, so they come back after a restart.
 *
 * While a tab is in a tab window, the window it came from keeps it as a
 * hidden tab marked with `tabWindowId`: the daemon's browser tab registry and
 * the agents' tab lists still see it, and it moves back in place. Closing a
 * tab window moves the tab back; only "Close tab" in its header closes it.
 */

/**
 * The panel tab a tab window shows. Structurally a subset of the renderer's
 * `PanelTab` (this file is shared with the preload build, which cannot load
 * the store types); the other tab fields pass through unchanged.
 */
export interface TabWindowTab {
  id: string;
  type: string;
  title: string;
  closable: boolean;
  hasUnsavedChanges?: boolean;
  /** Set only on the source window's hidden copy. */
  tabWindowId?: string;
  browserUrl?: string;
  browserRequestedUrl?: string;
  faviconUrl?: string;
}

/** Route prefix of a tab window's page; the id follows. */
export const TAB_WINDOW_ROUTE_PREFIX = '/tab-window/';

/** Panel-layout key a tab window's renderer keeps its one tab under. */
const TAB_WINDOW_LAYOUT_PREFIX = 'tab-window:';

/** Most characters in a tab window id. */
const MAX_TAB_WINDOW_ID_LENGTH = 64;

const TAB_WINDOW_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Whether `id` is a well-formed tab window id. */
export function isTabWindowId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= MAX_TAB_WINDOW_ID_LENGTH &&
    TAB_WINDOW_ID_PATTERN.test(id)
  );
}

/** The page a tab window loads. */
export function tabWindowRoute(tabWindowId: string): string {
  return `${TAB_WINDOW_ROUTE_PREFIX}${tabWindowId}`;
}

/** The tab window id in a route path, or null when the path is not a tab window page. */
export function tabWindowIdFromRoute(pathname: string): string | null {
  if (!pathname.startsWith(TAB_WINDOW_ROUTE_PREFIX)) return null;
  const id = pathname.slice(TAB_WINDOW_ROUTE_PREFIX.length).replace(/\/$/, '');
  return isTabWindowId(id) ? id : null;
}

/** Whether a route path is a tab window page. */
export function isTabWindowRoute(pathname: string): boolean {
  return tabWindowIdFromRoute(pathname) !== null;
}

/** The panel-layout key of a tab window's one tab. */
export function tabWindowLayoutId(tabWindowId: string): string {
  return `${TAB_WINDOW_LAYOUT_PREFIX}${tabWindowId}`;
}

/**
 * Whether a panel-layout key belongs to a tab window. Such a layout is never
 * saved, never restored, and never reported to the browser tab registry: the
 * window the tab came from does all three.
 */
export function isTabWindowLayoutId(layoutId: string | null | undefined): boolean {
  return typeof layoutId === 'string' && layoutId.startsWith(TAB_WINDOW_LAYOUT_PREFIX);
}

/** A tab window as main keeps and saves it. */
export interface TabWindowRecord {
  tabWindowId: string;
  workspaceId: string;
  /** The panel-layout key the tab came from (the workspace id outside column view). */
  sourceLayoutId: string;
  /** The tab, kept up to date by the tab window's renderer. */
  tab: TabWindowTab;
}

/** `tab-window:open` params: move a tab of the sender's window to a window of its own. */
export interface TabWindowOpenParams {
  /** Chosen by the source renderer, which marks its hidden copy with it first. */
  tabWindowId: string;
  workspaceId: string;
  sourceLayoutId: string;
  tab: TabWindowTab;
}

/** `tab-window:open` result. */
export interface TabWindowOpenResult {
  tabWindowId: string;
}

/** `tab-window:get` result: the sender's tab window, or null when it is not one. */
export interface TabWindowGetResult {
  record: TabWindowRecord | null;
}

/** `tab-window:update` params: the tab window's tab changed (title, URL, favicon). */
export interface TabWindowUpdateParams {
  tab: TabWindowTab;
}

/** `tab-window:is-open` result. */
export interface TabWindowIsOpenResult {
  /** The tab window is open, or reopening after a restart. */
  open: boolean;
  /** Its tab was closed for real this run (its hidden copy must not come back). */
  closed: boolean;
}

/**
 * `tab-window:return-tab` event (main → the window the tab goes back to):
 * show the tab again, with the same id.
 */
export interface TabWindowReturnEvent {
  tabWindowId: string;
  workspaceId: string;
  sourceLayoutId: string;
  tab: TabWindowTab;
  /** The user moved it back: the window shows its workspace. A plain window close does not. */
  reveal: boolean;
}

/** `tab-window:tab-updated` event (main → the source window): keep its hidden copy current. */
export interface TabWindowTabUpdatedEvent {
  tabWindowId: string;
  workspaceId: string;
  sourceLayoutId: string;
  tab: TabWindowTab;
}

/** `tab-window:closed-tab` event (main → the source window): the tab was closed in its window. */
export interface TabWindowClosedTabEvent {
  tabWindowId: string;
  workspaceId: string;
  sourceLayoutId: string;
  tabId: string;
}

/**
 * Whether a tab can move to its own window now. A file with unsaved changes
 * cannot: the second renderer would not have the draft.
 */
export function canMoveTabToWindow(tab: Pick<TabWindowTab, 'type' | 'hasUnsavedChanges'>): boolean {
  return !tab.hasUnsavedChanges;
}

/** How a new tab window fills the screen. */
export type TabWindowDisplayMode = 'full-screen' | 'maximized';

/**
 * macOS: native full screen (its own Space). Intent OS (sway): full screen
 * on its own workspace. Windows and other Linux desktops: maximized.
 */
export function tabWindowDisplayMode(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
): TabWindowDisplayMode {
  if (platform === 'darwin') return 'full-screen';
  if (platform === 'linux') {
    const desktop = (env.XDG_CURRENT_DESKTOP ?? '').toLowerCase();
    if (env.INTENT_OS === '1' || !!env.SWAYSOCK || desktop.split(':').includes('sway')) {
      return 'full-screen';
    }
  }
  return 'maximized';
}
