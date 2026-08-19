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
    invoke: vi.fn().mockResolvedValue({ success: true }),
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
vi.mock('$lib/electron-bridge', () => ({
  invoke: mocks.invoke,
  isElectron: () => true,
}));
vi.mock('$lib/utils/theme-presets', () => ({
  themePresets: [{ id: 'night', dark: { name: 'Night' }, light: { name: 'Day' } }],
}));

import {
  clearThemeCustomization,
  importCustomTheme,
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.manager.getTheme.mockReturnValue('dark');
    mocks.manager.isDark.mockReturnValue(true);
    mocks.manager.hasCustomTheme.mockReturnValue(false);
    mocks.manager.getCustomThemeName.mockReturnValue(null);
    mocks.manager.getActivePresetId.mockReturnValue(null);
    mocks.manager.setTheme.mockImplementation(() => undefined);
    mocks.manager.setPresetTheme.mockImplementation(() => undefined);
    mocks.manager.setCustomTheme.mockImplementation(() => undefined);
    mocks.manager.clearCustomTheme.mockImplementation(() => undefined);
    mocks.manager.dispose.mockImplementation(() =>
      mocks.mediaRemove('change', mocks.systemThemeListener),
    );
    mocks.resetInstance.mockImplementation(() => mocks.manager.dispose());
  });
  afterEach(() => document.documentElement.classList.remove('dark', 'light'));

  it('hydrates an exact manager snapshot, applies preference, and suppresses its synchronous echo', async () => {
    mocks.manager.setTheme.mockImplementation((theme: string) => {
      mocks.manager.getTheme.mockReturnValue(theme);
      mocks.manager.isDark.mockReturnValue(theme === 'dark');
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
    expect(mocks.invoke).toHaveBeenLastCalledWith('window:set-theme', { theme: 'dark' });

    dispatch.mockClear();
    channel.put(requestThemePreferenceChange('light'));
    await settle();
    expect(mocks.setItem).toHaveBeenCalledWith('theme', 'light');
    expect(mocks.manager.setTheme).toHaveBeenCalledWith('light', { persist: false });
    expect(mocks.invoke).toHaveBeenLastCalledWith('window:set-theme', { theme: 'light' });
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setThemePreference('light'),
      setThemeName('light'),
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

  it('keeps system preference on the native theme channel', async () => {
    mocks.manager.getTheme.mockReturnValue('system');
    mocks.manager.isDark.mockReturnValue(false);
    const task = runSaga({ channel: stdChannel(), dispatch: vi.fn() }, themeSaga);

    await settle();

    expect(mocks.invoke).toHaveBeenLastCalledWith('window:set-theme', { theme: 'system' });
    task.cancel();
    await task.toPromise();
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

  it('applies a known preset and syncs customization from the manager', async () => {
    mocks.manager.setPresetTheme.mockImplementation(() => {
      mocks.manager.hasCustomTheme.mockReturnValue(true);
      mocks.manager.getCustomThemeName.mockReturnValue('Night');
      mocks.manager.getActivePresetId.mockReturnValue('night');
    });
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch }, themeSaga);
    await settle();
    dispatch.mockClear();

    channel.put(selectThemePreset('night'));
    await settle();

    expect(mocks.manager.setPresetTheme).toHaveBeenCalledWith(
      'night',
      { name: 'Night' },
      { name: 'Day' },
    );
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setThemePreference('dark'),
      setThemeName('dark'),
      setThemeCustomization({
        hasCustomTheme: true,
        customThemeName: 'Night',
        activePresetId: 'night',
      }),
      setThemeError(null),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('imports and clears custom themes through the manager', async () => {
    const customTheme = { name: 'Imported', type: 'dark', colors: {} };
    mocks.manager.setCustomTheme.mockImplementation(() => {
      mocks.manager.hasCustomTheme.mockReturnValue(true);
      mocks.manager.getCustomThemeName.mockReturnValue('Imported');
      mocks.manager.getActivePresetId.mockReturnValue(null);
    });
    mocks.manager.clearCustomTheme.mockImplementation(() => {
      mocks.manager.hasCustomTheme.mockReturnValue(false);
      mocks.manager.getCustomThemeName.mockReturnValue(null);
      mocks.manager.getActivePresetId.mockReturnValue(null);
    });
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch }, themeSaga);
    await settle();
    dispatch.mockClear();

    channel.put(importCustomTheme(customTheme));
    await settle();
    expect(mocks.manager.setCustomTheme).toHaveBeenCalledWith(customTheme);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setThemePreference('dark'),
      setThemeName('dark'),
      setThemeCustomization({
        hasCustomTheme: true,
        customThemeName: 'Imported',
        activePresetId: null,
      }),
      setThemeError(null),
    ]);

    dispatch.mockClear();
    channel.put(clearThemeCustomization());
    await settle();
    expect(mocks.manager.clearCustomTheme).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setThemePreference('dark'),
      setThemeName('dark'),
      setThemeCustomization({ hasCustomTheme: false, customThemeName: null, activePresetId: null }),
      setThemeError(null),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it.each([
    { base: 'light' as const, custom: 'dark' as const },
    { base: 'dark' as const, custom: 'light' as const },
  ])(
    'syncs a $custom single custom theme over a $base base and reverts on clear',
    async ({ base, custom }) => {
      mocks.manager.getTheme.mockReturnValue(base);
      mocks.manager.isDark.mockReturnValue(base === 'dark');
      mocks.manager.setCustomTheme.mockImplementation(() => {
        mocks.manager.hasCustomTheme.mockReturnValue(true);
        mocks.manager.getCustomThemeName.mockReturnValue('Imported');
        mocks.manager.getActivePresetId.mockReturnValue(null);
        mocks.manager.isDark.mockReturnValue(custom === 'dark');
      });
      mocks.manager.clearCustomTheme.mockImplementation(() => {
        mocks.manager.hasCustomTheme.mockReturnValue(false);
        mocks.manager.getCustomThemeName.mockReturnValue(null);
        mocks.manager.getActivePresetId.mockReturnValue(null);
        mocks.manager.isDark.mockReturnValue(base === 'dark');
      });
      const importChannel = stdChannel();
      const importTask = runSaga({ channel: importChannel, dispatch: vi.fn() }, themeSaga);
      await settle();
      mocks.invoke.mockClear();

      importChannel.put(importCustomTheme({ name: 'Imported', type: custom, colors: {} }));
      await settle();
      expect(mocks.invoke).toHaveBeenLastCalledWith('window:set-theme', { theme: custom });
      importTask.cancel();
      await importTask.toPromise();

      mocks.invoke.mockClear();
      const restoreChannel = stdChannel();
      const restoreTask = runSaga({ channel: restoreChannel, dispatch: vi.fn() }, themeSaga);
      await settle();
      expect(mocks.invoke).toHaveBeenLastCalledWith('window:set-theme', { theme: custom });

      restoreChannel.put(clearThemeCustomization());
      await settle();
      expect(mocks.invoke).toHaveBeenLastCalledWith('window:set-theme', { theme: base });
      restoreTask.cancel();
      await restoreTask.toPromise();
    },
  );

  it('surfaces custom import and clear failures as theme error actions', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch }, themeSaga);
    await settle();
    dispatch.mockClear();

    mocks.manager.setCustomTheme.mockImplementation(() => {
      throw new Error('Invalid theme JSON');
    });
    channel.put(importCustomTheme({}));
    await settle();
    expect(dispatch).toHaveBeenCalledWith(setThemeError('Invalid theme JSON'));

    dispatch.mockClear();
    mocks.manager.clearCustomTheme.mockImplementation(() => {
      throw new Error('Clear failed');
    });
    channel.put(clearThemeCustomization());
    await settle();
    expect(dispatch).toHaveBeenCalledWith(setThemeError('Clear failed'));
    task.cancel();
    await task.toPromise();
  });
});
