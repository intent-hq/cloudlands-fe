/**
 * Backend stamping for BrowserWindows (main process).
 *
 * Every window is stamped with the backend id its renderer talks to
 * (multi-backend connect); per-window IPC routing and the per-backend HUD
 * registry read the stamp back. Kept in its own dependency-light module so
 * hud-window.ts / webview-security.ts can import it without dragging in
 * main/window.ts's full module graph. main/window.ts re-exports these
 * helpers, so either import path resolves to the same implementation.
 */

import { BrowserWindow } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';

type BackendBoundWindow = BrowserWindowType & { backendId?: string };

/** Stamp a BrowserWindow with the backend used by its renderer. */
export function stampWindowWithBackend(
  window: BrowserWindowType,
  backendId: string = LOCAL_CONNECTION_ID,
): void {
  (window as BackendBoundWindow).backendId = backendId;
}

/** Resolve a BrowserWindow's backend, defaulting legacy/unbound windows to local. */
export function getBackendIdForWindow(window: BrowserWindowType): string {
  return (window as BackendBoundWindow).backendId ?? LOCAL_CONNECTION_ID;
}

/** Resolve an IPC sender's backend, defaulting unbound windows to local. */
export function getBackendIdForWebContents(webContents: Electron.WebContents): string {
  const window = BrowserWindow.fromWebContents(webContents) as BackendBoundWindow | null;
  return window ? getBackendIdForWindow(window) : LOCAL_CONNECTION_ID;
}
