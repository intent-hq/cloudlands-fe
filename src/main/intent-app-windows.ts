/**
 * Intent app windows (Labs): top-level windows that show an agent-built app
 * from the `intent-app://` scheme. They are not Intent windows. They have their
 * own preload (`window.intent` only), their own session partition and their own
 * navigation and popup rules, so:
 *
 * - the global web-contents security hook skips them (the app host owns their
 *   navigation, popups and webview rules);
 * - `getRendererWebContents` never returns them, so no Intent IPC push reaches
 *   an app renderer;
 * - Intent's window lists (Window menu, activation) leave them out.
 *
 * This module has no imports so every main module can use it.
 */

const appContentsIds = new Set<number>();
const appWindowIds = new Set<number>();

interface WindowLike {
  id: number;
  webContents: { id: number };
}

/** Mark a new app window. Call right after construction, before loadURL. */
export function markIntentAppWindow(window: WindowLike): void {
  const windowId = window.id;
  const contentsId = window.webContents.id;
  appWindowIds.add(windowId);
  appContentsIds.add(contentsId);
}

/** Forget a closed app window. */
export function unmarkIntentAppWindow(windowId: number, contentsId: number): void {
  appWindowIds.delete(windowId);
  appContentsIds.delete(contentsId);
}

export function isIntentAppWindow(window: { id: number; isDestroyed?(): boolean }): boolean {
  return appWindowIds.has(window.id);
}

export function isIntentAppContents(contents: { id: number }): boolean {
  return appContentsIds.has(contents.id);
}
