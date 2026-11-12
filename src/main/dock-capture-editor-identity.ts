import type { BrowserWindow } from 'electron';

// Exact main-owned identity of the capture editor window; a route grants none.
const windows = new WeakSet<BrowserWindow>();

export function registerDockCaptureEditorWindow(window: BrowserWindow): void {
  windows.add(window);
}

export function isDockCaptureEditorWindow(window: BrowserWindow): boolean {
  return windows.has(window) && !window.isDestroyed();
}

/** When main last showed and focused the editor at the dock's request. */
let focusedByIntentAt = 0;
const FOCUS_RECEIPT_MS = 1500;

export function noteDockCaptureEditorFocused(): void {
  focusedByIntentAt = Date.now();
}

/**
 * The editor coming forward because Intent just opened it, which can activate the
 * app; a launcher or Dock-icon reopen later still shows Intent as before.
 */
export function isDockCaptureEditorFocusOwnDoing(): boolean {
  return Date.now() - focusedByIntentAt < FOCUS_RECEIPT_MS;
}
