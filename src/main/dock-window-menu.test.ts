/**
 * The Window menu's "Show Intent Dock" is the Notch dock setting itself: present whether
 * the dock is on or off, checked from main's setting, and its click goes through the same
 * serialized setter as Settings and the dock's own Hide, so every window agrees. The dock
 * commands (focus, record, capture, dictate) exist only while the dock is on.
 * Real dock-lab module; electron, the preference file and the dock window are fakes.
 * (A transient close never changes the setting: see dock-backend-switch.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saved: true as boolean,
  failSave: false,
  sent: [] as unknown[],
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (_channel: string, payload: unknown) => mocks.sent.push(payload),
        },
      },
    ],
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      mocks.handlers.set(channel, handler),
  },
}));
vi.mock('./local-prefs', () => ({
  getDockLabEnabledLocalPref: async () => mocks.saved,
  setDockLabEnabledLocalPref: async (enabled: boolean) => {
    if (mocks.failSave) throw new Error('disk unavailable');
    mocks.saved = enabled;
  },
}));
vi.mock('./ipc-validation-middleware', () => ({
  createSafeValidatedHandler: (_schema: unknown, handler: unknown) => handler,
}));

import type { MenuItemConstructorOptions } from 'electron';
import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import {
  changeDockLabEnabled,
  isDockLabEnabled,
  loadDockLabEnabled,
  registerDockLabHandlers,
} from './dock-lab';
import { dockWindowMenuItems } from './dock-window-menu';

const labels = {
  show: 'Show Intent Dock',
  focus: 'Focus Intent Dock',
  record: 'Record',
  capture: 'Screenshot',
  dictate: 'Dictate',
  unavailable: 'Shortcut unavailable',
};
let dockShown = false;
const requested: string[] = [];
let refreshes = 0;
function menu(): MenuItemConstructorOptions[] {
  return dockWindowMenuItems({
    labEnabled: isDockLabEnabled(),
    dockShown,
    labels,
    hint: () => ({ available: true, key: 'Ctrl+Shift+D' }),
    setNotchDock: changeDockLabEnabled,
    requestShortcut: (action) => void requested.push(action),
    warn: () => {},
    refresh: () => void (refreshes += 1),
  });
}
const show = (items: MenuItemConstructorOptions[]) =>
  items.find((item) => item.label === labels.show);
const commands = (items: MenuItemConstructorOptions[]) =>
  items.filter((item) => item.label && item.label !== labels.show).map((item) => item.label);
/** Electron flips a checkbox before calling its click handler. */
async function clickShow() {
  const item = show(menu())!;
  const flipped = { ...item, checked: !item.checked };
  (item.click as (item: { checked: boolean }) => void)(flipped);
  await vi.waitFor(() => expect(isDockLabEnabled()).toBe(flipped.checked));
}

async function launch(saved: boolean) {
  mocks.saved = saved;
  mocks.failSave = false;
  refreshes = 0;
  mocks.sent.length = 0;
  requested.length = 0;
  await loadDockLabEnabled();
  dockShown = saved;
  registerDockLabHandlers({
    show: async () => void (dockShown = true),
    hide: () => void (dockShown = false),
    onChange: () => {},
    restore: async () => dockShown,
    isDock: () => false,
  });
}

describe('Window menu Show Intent Dock is the Notch dock setting', () => {
  beforeEach(() => {
    dockShown = false;
  });

  it('with the dock off, the item is still there, unchecked, and checking it turns Notch dock on everywhere', async () => {
    await launch(false);
    expect(show(menu())).toMatchObject({ type: 'checkbox', checked: false });
    expect(commands(menu())).toEqual([]);
    await clickShow();
    expect(mocks.saved).toBe(true);
    expect(dockShown).toBe(true);
    // Settings follows the same push.
    expect(mocks.sent).toEqual([{ enabled: true }]);
    expect(show(menu())).toMatchObject({ checked: true });
    expect(commands(menu())).toEqual([labels.focus, labels.record, labels.capture, labels.dictate]);
    // Show + the four dock commands (no Annotate), then a separator.
    expect(menu().filter((item) => item.type !== 'separator')).toHaveLength(5);
  });

  it('turned off in Settings, the item stays, unchecked, and the dock commands go away', async () => {
    await launch(true);
    const settings = { id: 'settings' };
    await mocks.handlers.get(WINDOW_CHANNELS.SET_DOCK_LAB)!(
      { sender: settings },
      { enabled: false },
    );
    expect(isDockLabEnabled()).toBe(false);
    expect(dockShown).toBe(false);
    expect(show(menu())).toMatchObject({ type: 'checkbox', checked: false });
    expect(commands(menu())).toEqual([]);
  });

  it('unchecking it turns Notch dock off the same way, and Settings follows', async () => {
    await launch(true);
    await clickShow();
    expect(mocks.saved).toBe(false);
    expect(dockShown).toBe(false);
    expect(mocks.sent).toEqual([{ enabled: false }]);
    expect(show(menu())).toMatchObject({ checked: false });
  });

  it('a check whose save fails is redrawn from the real setting (still off)', async () => {
    await launch(false);
    mocks.failSave = true;
    const item = show(menu())!;
    // Electron shows the item checked before the click handler runs.
    (item.click as (item: { checked: boolean }) => void)({ ...item, checked: true } as never);
    await vi.waitFor(() => expect(refreshes).toBe(1));
    expect(isDockLabEnabled()).toBe(false);
    expect(mocks.saved).toBe(false);
    expect(mocks.sent).toEqual([]);
    expect(show(menu())).toMatchObject({ checked: false });
  });

  it('the dock commands only act while a dock window exists', async () => {
    await launch(true);
    dockShown = false;
    expect(
      menu()
        .filter((item) => commands([item]).length)
        .every((item) => item.enabled === false),
    ).toBe(true);
    dockShown = true;
    const focus = menu().find((item) => item.label === labels.focus)!;
    expect(focus.enabled).toBe(true);
    (focus.click as () => void)();
    expect(requested).toEqual(['focus']);
  });
});
