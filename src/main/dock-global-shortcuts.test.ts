import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createDockShortcutPreferences } from './dock-shortcut-preferences';

const fixture = vi.hoisted(() => ({
  service: null as ReturnType<typeof createDockShortcutPreferences> | null,
  window: null as null | { webContents: object; isFocused(): boolean },
  binding: null as null | { backendId: string },
  observe: vi.fn(),
  focus: vi.fn(),
  admit: vi.fn(),
  keys: new Map<string, () => void>(),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  Menu: { getApplicationMenu: () => null },
  app: { on: vi.fn(), emit: vi.fn() },
  globalShortcut: {
    register: (key: string, callback: () => void) => {
      fixture.keys.set(key, callback);
      return true;
    },
    unregister: (key: string) => fixture.keys.delete(key),
  },
}));
vi.mock('./local-prefs', () => ({
  getDockShortcutOverridesLocalPref: async () => ({}),
  setDockShortcutOverridesLocalPref: async () => {},
}));
vi.mock('./dock-shortcut-settings-ipc', () => ({
  registerDockShortcutSettingsHandlers: (service: typeof fixture.service) => {
    fixture.service = service;
  },
}));
vi.mock('./dock-foreground-observation', () => ({
  readDockForegroundObservation: fixture.observe,
}));
vi.mock('./dock-context-ipc', () => ({ admitDockForegroundSample: fixture.admit }));
vi.mock('./dock-window', () => ({
  getDockWindow: () => fixture.window,
  focusDockWindow: fixture.focus,
}));
vi.mock('./window-backend', () => ({
  getStrictBackendBindingForWebContents: () => fixture.binding,
}));

import {
  initializeDockShortcutSettings,
  requestDockShortcut,
  syncDockGlobalShortcuts,
} from './dock-global-shortcuts';

function heldObservation() {
  let resolve!: (value: { appId: string }) => void;
  const promise = new Promise<{ appId: string }>((done) => {
    resolve = done;
  });
  fixture.observe.mockReturnValueOnce(promise);
  return () => resolve({ appId: 'test.foreground' });
}

beforeEach(async () => {
  syncDockGlobalShortcuts(false);
  fixture.observe.mockReset().mockResolvedValue({ appId: 'test.foreground' });
  fixture.focus.mockReset();
  fixture.admit.mockReset().mockReturnValue(null);
  fixture.window = { webContents: {}, isFocused: () => false };
  fixture.binding = { backendId: 'test-backend' };
  await initializeDockShortcutSettings();
  await fixture.service!.capture(false);
  await fixture.service!.refresh({});
  syncDockGlobalShortcuts(true);
  await Promise.resolve();
});

describe('dock shortcut async admission', () => {
  it('dispatches an unchanged request once with its observed context', async () => {
    await requestDockShortcut('capture');
    expect(fixture.focus).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        action: 'capture',
        backendId: 'test-backend',
        appId: 'test.foreground',
      }),
    );
  });

  it('keeps an admitted lookup current through an unchanged settings refresh', async () => {
    const finish = heldObservation();
    const pending = requestDockShortcut('capture');
    await fixture.service!.refresh({});
    finish();
    await pending;
    expect(fixture.focus).toHaveBeenCalledTimes(1);
  });

  it.each(['capture active', 'capture ended', 'bindings changed'] as const)(
    'retires a foreground lookup after %s',
    async (change) => {
      const finish = heldObservation();
      const pending = requestDockShortcut('record');
      expect(fixture.observe).toHaveBeenCalledTimes(1);
      if (change === 'bindings changed') {
        const snapshot = fixture.service!.snapshot();
        await fixture.service!.update({
          id: 'dock.focus',
          key: 'ctrl+alt+f9',
          expectedRevision: snapshot.revision,
        });
      } else {
        await fixture.service!.capture(true);
        if (change === 'capture ended') await fixture.service!.capture(false);
      }
      finish();
      await pending;
      expect(fixture.focus).not.toHaveBeenCalled();
    },
  );

  it('does not start a request while a shortcut field owns capture', async () => {
    await fixture.service!.capture(true);
    await requestDockShortcut('dictate');
    expect(fixture.observe).not.toHaveBeenCalled();
    expect(fixture.focus).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'window replaced', 'binding retired', 'newer request'] as const)(
    'keeps a held result retired after %s',
    async (change) => {
      const finish = heldObservation();
      const pending = requestDockShortcut('capture');
      if (change === 'disabled') syncDockGlobalShortcuts(false);
      if (change === 'window replaced')
        fixture.window = { webContents: {}, isFocused: () => false };
      if (change === 'binding retired') fixture.binding = { backendId: 'other-backend' };
      if (change === 'newer request') await requestDockShortcut('focus');
      const admitted = fixture.focus.mock.calls.length;
      finish();
      await pending;
      expect(fixture.focus).toHaveBeenCalledTimes(admitted);
      expect(admitted).toBe(change === 'newer request' ? 1 : 0);
    },
  );
});

it('cancels invalidated foreground reads without focus, admission or rejected shortcut promise', async () => {
  fixture.observe.mockRejectedValueOnce(new Error('Foreground observation invalidated'));
  await expect(requestDockShortcut('focus')).resolves.toBeUndefined();
  expect(fixture.admit).not.toHaveBeenCalled();
  expect(fixture.focus).not.toHaveBeenCalled();
});
