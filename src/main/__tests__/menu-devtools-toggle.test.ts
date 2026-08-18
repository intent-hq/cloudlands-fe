import { describe, expect, it, vi } from 'vitest';

import { toggleWindowDevTools, type DevToolsToggleWindow } from '../menu-devtools-toggle';

function createWindow(destroyed = false, webContentsDestroyed = false) {
  const toggleDevTools = vi.fn();
  const window: DevToolsToggleWindow = {
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => webContentsDestroyed,
      toggleDevTools,
    },
  };
  return { window, toggleDevTools };
}

describe('toggleWindowDevTools', () => {
  // Regression: intent-hq/monorepo#2844 — the built-in toggleDevTools role
  // targets getFocusedWebContents(), which can be a hidden offscreen
  // keep-alive <webview> guest. The app-level toggle must always act on the
  // window's own webContents.
  it("toggles DevTools on the window's own webContents", () => {
    const { window, toggleDevTools } = createWindow();

    expect(toggleWindowDevTools(window)).toBe(true);

    expect(toggleDevTools).toHaveBeenCalledTimes(1);
  });

  it('no-ops when there is no focused window', () => {
    expect(toggleWindowDevTools(null)).toBe(false);
    expect(toggleWindowDevTools(undefined)).toBe(false);
  });

  it('no-ops when the window is destroyed', () => {
    const { window, toggleDevTools } = createWindow(true);

    expect(toggleWindowDevTools(window)).toBe(false);

    expect(toggleDevTools).not.toHaveBeenCalled();
  });

  it('no-ops when the webContents is destroyed', () => {
    const { window, toggleDevTools } = createWindow(false, true);

    expect(toggleWindowDevTools(window)).toBe(false);

    expect(toggleDevTools).not.toHaveBeenCalled();
  });
});
