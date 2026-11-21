import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMenuBarAutoHide } from './window-appearance';

function fakeWindow() {
  return { setAutoHideMenuBar: vi.fn(), setMenuBarVisibility: vi.fn() };
}

describe('applyMenuBarAutoHide', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('follows the preference without the environment override', () => {
    const window = fakeWindow();
    applyMenuBarAutoHide(window, false, 'linux');
    expect(window.setAutoHideMenuBar).toHaveBeenCalledWith(false);
    expect(window.setMenuBarVisibility).toHaveBeenCalledWith(true);
  });

  it('keeps the menu bar hidden when INTENT_HIDE_MENU_BAR=1, even with the preference off', () => {
    vi.stubEnv('INTENT_HIDE_MENU_BAR', '1');
    const window = fakeWindow();
    applyMenuBarAutoHide(window, false, 'linux');
    expect(window.setAutoHideMenuBar).toHaveBeenCalledWith(true);
    expect(window.setMenuBarVisibility).toHaveBeenCalledWith(false);
  });

  it('leaves macOS windows alone', () => {
    vi.stubEnv('INTENT_HIDE_MENU_BAR', '1');
    const window = fakeWindow();
    applyMenuBarAutoHide(window, false, 'darwin');
    expect(window.setAutoHideMenuBar).not.toHaveBeenCalled();
  });
});

describe('menu bar auto-hide default on Intent OS', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function freshAppearance() {
    vi.resetModules();
    return import('./window-appearance');
  }

  it('opens the first window without a menu bar, and the user turning it off sticks', async () => {
    vi.stubEnv('INTENT_OS', '1');
    const appearance = await freshAppearance();
    expect(appearance.getWindowTitleBarOptions('linux').autoHideMenuBar).toBe(true);
    appearance.setMenuBarAutoHideEnabled(false);
    expect(appearance.getWindowTitleBarOptions('linux').autoHideMenuBar).toBeUndefined();
  });

  it('opens with the menu bar outside Intent OS', async () => {
    const appearance = await freshAppearance();
    expect(appearance.getWindowTitleBarOptions('linux').autoHideMenuBar).toBeUndefined();
  });
});
