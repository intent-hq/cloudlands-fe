/**
 * App-level DevTools toggle for the View menu (intent-hq/monorepo#2844).
 *
 * Electron's built-in `toggleDevTools` role targets
 * `webContents.getFocusedWebContents()`, which can be a <webview> guest —
 * including the hidden offscreen keep-alive guests (OffscreenWebviewHost),
 * whose pages can grab focus on load/navigation with no visible way to take
 * it back. The app-level toggle must always target the focused window's own
 * renderer; per-tab webview DevTools stay on their explicit paths (browser
 * toolbar button, in-webview keyboard interceptor).
 */

export type DevToolsToggleWindow = {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    toggleDevTools(): void;
  };
};

export function toggleWindowDevTools(window: DevToolsToggleWindow | null | undefined): boolean {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
  window.webContents.toggleDevTools();
  return true;
}
