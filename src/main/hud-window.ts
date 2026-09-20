/**
 * HUD pop-out window registry (main process).
 *
 * One Fleet HUD window may exist per backend: every open-HUD request
 * (sidebar button IPC, deep links, programmatic opens — all funneled through
 * `createAppWindow` in system.ipc.ts, plus the window.open bridge path in
 * webview-security.ts) must reuse the live HUD window bound to the opener's
 * backend when one exists instead of opening a second one for that backend.
 * HUDs bound to different backends coexist.
 *
 * Detection is two-layered:
 *   1. tracked references registered at creation time, keyed by the window's
 *      stamped backend (covers the mid-navigation race where the window's
 *      URL is still `about:blank` and the URL check below would miss it);
 *   2. a URL + backend-stamp scan over all live windows (covers HUD windows
 *      created outside the tracked path, e.g. session restore on startup).
 */

import { BrowserWindow } from 'electron';
import { getBackendIdForWindow } from './window-backend';

/** Route prefix identifying the HUD pop-out. */
export const HUD_ROUTE_PREFIX = '/hud';

/**
 * Whether a window is the HUD pop-out (any backend). The HUD is opened with
 * the `/hud` route and carries no other tag, so the loaded URL's pathname is
 * the identifier (dev `http:` and production `app:` URLs both put the route
 * in the pathname). Shared by the HUD registry and the notification-click
 * target picker (which must never navigate a HUD window).
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
 * HUD windows created via the tracked paths, keyed by the backend each was
 * stamped with at registration time. Registered BEFORE their URL loads so
 * concurrent open requests reuse them instead of racing the URL check.
 */
const trackedHudWindows = new Map<string, BrowserWindow>();

/**
 * Track a newly created HUD window as THE HUD for its backend. The window
 * must already be stamped (`stampWindowWithBackend`) — the registry keys off
 * the stamp. Cleared automatically when the window closes.
 */
export function registerHudWindow(window: BrowserWindow): void {
  const backendId = getBackendIdForWindow(window);
  trackedHudWindows.set(backendId, window);
  window.on('closed', () => {
    if (trackedHudWindows.get(backendId) === window) trackedHudWindows.delete(backendId);
  });
}

/**
 * Find the live HUD window bound to `backendId`, if any: the tracked
 * reference first (survives mid-navigation), then a URL scan of all live
 * windows filtered to the same backend stamp.
 */
export function findExistingHudWindow(backendId: string): BrowserWindow | null {
  const tracked = trackedHudWindows.get(backendId);
  if (tracked && !tracked.isDestroyed()) return tracked;
  if (tracked) trackedHudWindows.delete(backendId);
  return (
    BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && isHudWindow(w) && getBackendIdForWindow(w) === backendId,
    ) ?? null
  );
}

/**
 * Whether a window is a tracked HUD (any backend). Complements the URL-based
 * `isHudWindow` for consumers that must exclude every HUD window: a newly
 * registered HUD still on `about:blank` is missed by the URL check but
 * present here.
 */
export function isTrackedHudWindow(window: BrowserWindow): boolean {
  for (const tracked of trackedHudWindows.values()) {
    if (tracked === window && !tracked.isDestroyed()) return true;
  }
  return false;
}

/** Bring an existing HUD window to the front: restore if minimized, then show + focus. */
export function focusHudWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * Test-only helper: reset the tracked HUD window registry.
 * Not part of the production API.
 */
export function _resetHudWindowRefForTests(): void {
  trackedHudWindows.clear();
}
