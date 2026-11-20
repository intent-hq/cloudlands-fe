/**
 * Whether this renderer is a tab window's (shared/types/tab-window.ts).
 *
 * A tab window's renderer shows one tab of a workspace that the window it
 * came from still owns. It never saves a panel layout, never reports to the
 * browser tab registry and never syncs it: the source window does all of
 * that, and a second writer would overwrite its layout.
 */
import { tabWindowIdFromRoute } from '$shared/types/tab-window';

/** The tab window id of this renderer, or null in any other renderer. */
export function currentTabWindowId(): string | null {
  if (typeof window === 'undefined') return null;
  return tabWindowIdFromRoute(window.location.pathname);
}

/** Whether this renderer is a tab window's. */
export function isTabWindowRenderer(): boolean {
  return currentTabWindowId() !== null;
}
