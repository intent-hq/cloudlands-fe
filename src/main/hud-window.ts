/**
 * HUD pop-out window singleton (main process).
 *
 * Only one Fleet HUD window may exist at a time: every open-HUD request
 * (sidebar button IPC, deep links, programmatic opens — all funneled through
 * `createAppWindow` in system.ipc.ts) must reuse the live HUD window when one
 * exists instead of opening a second one.
 *
 * Detection is two-layered:
 *   1. a tracked reference registered at creation time (covers the
 *      mid-navigation race where the window's URL is still `about:blank`
 *      and the URL check below would miss it);
 *   2. a URL scan over all live windows (covers HUD windows created outside
 *      the tracked path, e.g. session restore on startup).
 */

import { BrowserWindow } from 'electron';

/** Route prefix identifying the HUD pop-out. */
export const HUD_ROUTE_PREFIX = '/hud';

/**
 * Whether a window is the HUD pop-out. The HUD is opened with the `/hud`
 * route and carries no other tag, so the loaded URL's pathname is the
 * identifier (dev `http:` and production `app:` URLs both put the route in
 * the pathname). Shared by the HUD singleton and the notification-click
 * target picker (which must never navigate the HUD window).
 */
export function isHudWindow(window: BrowserWindow): boolean {
  try {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
    const url = window.webContents.getURL();
    if (!url) return false;
    return new URL(url).pathname.startsWith(HUD_ROUTE_PREFIX);
  } catch {
    return false;
  }
}

/**
 * The HUD window created via the tracked path, if still live. Registered
 * BEFORE its URL loads so concurrent open requests reuse it instead of
 * racing the URL check.
 */
let hudWindowRef: BrowserWindow | null = null;

/**
 * Track a newly created HUD window as THE HUD singleton. Cleared
 * automatically when the window closes.
 */
export function registerHudWindow(window: BrowserWindow): void {
  hudWindowRef = window;
  window.on('closed', () => {
    if (hudWindowRef === window) hudWindowRef = null;
  });
}

/**
 * Find the live HUD window, if any: the tracked reference first (survives
 * mid-navigation), then a URL scan of all live windows.
 */
export function findExistingHudWindow(): BrowserWindow | null {
  if (hudWindowRef && !hudWindowRef.isDestroyed()) return hudWindowRef;
  hudWindowRef = null;
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && isHudWindow(w)) ?? null;
}

/** Bring an existing HUD window to the front: restore if minimized, then show + focus. */
export function focusHudWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * Test-only helper: reset the tracked HUD window reference.
 * Not part of the production API.
 */
export function _resetHudWindowRefForTests(): void {
  hudWindowRef = null;
}
