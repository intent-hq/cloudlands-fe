import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => {
  const mediaRemove = vi.fn();
  const systemThemeListener = vi.fn();
  const manager = {
    getTheme: vi.fn(() => 'dark'),
    isDark: vi.fn(() => true),
    hasCustomTheme: vi.fn(() => false),
    getCustomThemeName: vi.fn(() => null),
    getActivePresetId: vi.fn(() => null),
    setTheme: vi.fn(),
    setPresetTheme: vi.fn(),
    setCustomTheme: vi.fn(),
    clearCustomTheme: vi.fn(),
    dispose: vi.fn(() => mediaRemove('change', systemThemeListener)),
  };
  return {
    setItem: vi.fn(),
    manager,
    mediaRemove,
    systemThemeListener,
    resetInstance: vi.fn(() => manager.dispose()),
  };
});
vi.mock('$lib/utils/theme', () => ({
  ThemeManager: {
    getInstance: () => mocks.manager,
    resetInstance: mocks.resetInstance,
  },
}));
vi.mock('$lib/utils/safe-storage', () => ({ safeLocalStorage: { setItem: mocks.setItem } }));
vi.mock('$lib/utils/theme-presets', () => ({
  themePresets: [{ id: 'night', dark: { name: 'Night' }, light: { name: 'Day' } }],
}));

import {
  requestThemePreferenceChange,
  selectThemePreset,
  setThemeCustomization,
  setThemeError,
  setThemeName,
  setThemePreference,
} from '../theme-slice';
import { themeSaga } from './theme-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('themeSaga', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => document.documentElement.classList.remove('dark', 'light'));

  it('hydrates an exact manager snapshot, applies preference, and suppresses its synchronous echo', async () => {
    mocks.manager.setTheme.mockImplementation(() => {
      window.dispatchEvent(
        new CustomEvent('theme-changed', { detail: { theme: 'light', isDark: false } }),
      );
    });
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch }, themeSaga);
    await settle();
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setThemePreference('dark'),
      setThemeName('dark'),
      setThemeCustomization({ hasCustomTheme: false, customThemeName: null, activePresetId: null }),
    ]);

    dispatch.mockClear();
    channel.put(requestThemePreferenceChange('light'));
    await settle();
    expect(mocks.setItem).toHaveBeenCalledWith('theme', 'light');
    expect(mocks.manager.setTheme).toHaveBeenCalledWith('light', { persist: false });
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setThemePreference('dark'),
      setThemeName('dark'),
      setThemeCustomization({ hasCustomTheme: false, customThemeName: null, activePresetId: null }),
      setThemeError(null),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('maps external theme events field-by-field and removes the listener on cancellation', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const dispatch = vi.fn();
    const task = runSaga({ channel: stdChannel(), dispatch }, themeSaga);
    await settle();
    dispatch.mockClear();
    window.dispatchEvent(
      new CustomEvent('theme-changed', {
        detail: {
          theme: 'system',
          isDark: false,
          customThemeName: 'Custom',
          activePresetId: null,
          wireOnly: 'drop',
        },
      }),
    );
    await settle();
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setThemePreference('system'),
      setThemeName('light'),
      setThemeCustomization({
        hasCustomTheme: true,
        customThemeName: 'Custom',
        activePresetId: null,
      }),
    ]);
    task.cancel();
    await task.toPromise();
    expect(add).toHaveBeenCalledWith('theme-changed', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('theme-changed', expect.any(Function));
    expect(mocks.resetInstance).toHaveBeenCalledTimes(1);
    expect(mocks.mediaRemove.mock.calls).toEqual([['change', mocks.systemThemeListener]]);
    add.mockRestore();
    remove.mockRestore();
  });

  it('surfaces an unknown preset as an exact terminal error action', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch }, themeSaga);
    await settle();
    dispatch.mockClear();
    channel.put(selectThemePreset('missing'));
    await settle();
    expect(dispatch).toHaveBeenCalledWith(setThemeError('Unknown theme preset: missing'));
    task.cancel();
    await task.toPromise();
  });
});
