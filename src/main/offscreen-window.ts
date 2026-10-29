import { BrowserWindow, type BrowserWindow as BrowserWindowType } from 'electron';

/** Automated render windows never participate in app focus, input ownership, or hang dialogs. */
export function isOffscreenWindow(window: BrowserWindowType): boolean {
  return window.webContents.isOffscreen?.() === true;
}

export function getAppWindows(): BrowserWindowType[] {
  return BrowserWindow.getAllWindows().filter((window) => !isOffscreenWindow(window));
}
