import type { BrowserWindow } from 'electron';

// Native identity also covers windows that have not loaded their route yet.
const windows = new WeakSet<BrowserWindow>();
export function registerDesktopOverlayWindow(window: BrowserWindow): void {
  windows.add(window);
}
export function isDesktopOverlayWindow(window: BrowserWindow): boolean {
  return windows.has(window);
}
