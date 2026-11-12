import type { BrowserWindow } from 'electron';
/** Main-owned app windows; a renderer route or copied session cannot grant this role. */
const windows = new WeakSet<BrowserWindow>();
export function registerChatWindow(window: BrowserWindow): void {
  windows.add(window);
}
export function isChatWindow(window: BrowserWindow): boolean {
  return windows.has(window) && !window.isDestroyed();
}
