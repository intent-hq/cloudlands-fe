import { createWindow, getFocusedWindowBackendId } from './window.js';

/**
 * File → New Window: create a window on the focused window's backend
 * (falls back to the main window's backend, then local) instead of the
 * hard-coded local default.
 */
export function openNewWindowFromMenu(): void {
  createWindow(getFocusedWindowBackendId());
}
