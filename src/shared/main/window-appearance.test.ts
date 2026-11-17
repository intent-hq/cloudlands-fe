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
