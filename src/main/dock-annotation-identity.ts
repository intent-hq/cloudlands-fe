import type { BrowserWindow } from 'electron';

// Exact main-owned identities; routes and reused numeric window ids grant no ownership.
const windows = new WeakSet<BrowserWindow>();

export function registerDockAnnotationWindow(window: BrowserWindow): void {
  windows.add(window);
}

export function isDockAnnotationWindow(window: BrowserWindow): boolean {
  return windows.has(window) && !window.isDestroyed();
}
