/**
 * The main-owned dock setting. Startup load under the default-on policy: a profile
 * that never chose is opted in, an explicit saved opt-out stays off, and a read
 * failure keeps the dock off rather than guessing. And the `window:set-dock-lab`
 * handler's lifecycle: a disable from Settings stops the dock at once (even if the
 * save fails); a disable from the dock itself (its intro's "Turn off") closes the
 * dock only after the save is confirmed, so a failed save leaves it open to retry.
 * Hiding the dock (its Hide, the Window menu) is the same setting: it turns Notch
 * dock off everywhere, and a launch never shows the setting on with no dock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<boolean>>(),
  write: vi.fn<(enabled: boolean) => Promise<void>>(),
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  events: [] as string[],
  sent: [] as unknown[],
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send: (_channel: string, payload: unknown) => mocks.sent.push(payload) },
      },
    ],
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      mocks.handlers.set(channel, handler),
  },
}));
vi.mock('./local-prefs', () => ({
  getDockLabEnabledLocalPref: mocks.read,
  setDockLabEnabledLocalPref: mocks.write,
}));
vi.mock('./ipc-validation-middleware', () => ({
  createSafeValidatedHandler: (_schema: unknown, handler: unknown) => handler,
}));

import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import {
  changeDockLabEnabled,
  isDockLabEnabled,
  loadDockLabEnabled,
  registerDockLabHandlers,
  startDockLab,
} from './dock-lab';

beforeEach(() => {
  mocks.read.mockReset();
  mocks.write.mockReset();
  mocks.events.length = 0;
  mocks.sent.length = 0;
});

describe('loadDockLabEnabled', () => {
  it('is on for a profile that never chose (the preference reads as on)', async () => {
    mocks.read.mockResolvedValue(true);
    await expect(loadDockLabEnabled()).resolves.toBe(true);
    expect(isDockLabEnabled()).toBe(true);
  });

  it('keeps an explicit saved opt-out off', async () => {
    mocks.read.mockResolvedValue(false);
    await expect(loadDockLabEnabled()).resolves.toBe(false);
    expect(isDockLabEnabled()).toBe(false);
  });

  it('stays off when the preference cannot be read', async () => {
    mocks.read.mockRejectedValue(new Error('unreadable'));
    await expect(loadDockLabEnabled()).resolves.toBe(false);
    expect(isDockLabEnabled()).toBe(false);
  });
});

describe('window:set-dock-lab', () => {
  const dock = { id: 'dock' };
  const settings = { id: 'main' };
  function register() {
    mocks.handlers.clear();
    registerDockLabHandlers({
      show: async () => void mocks.events.push('show'),
      hide: () => void mocks.events.push('hide'),
      onChange: () => void mocks.events.push('change'),
      restore: async () => true,
      isDock: (sender) => sender === (dock as unknown),
    });
    return (sender: object, enabled: boolean) =>
      mocks.handlers.get(WINDOW_CHANNELS.SET_DOCK_LAB)!({ sender }, { enabled });
  }
  async function startOn() {
    mocks.read.mockResolvedValue(true);
    await loadDockLabEnabled();
  }
  const saving = (fail = false) =>
    mocks.write.mockImplementation(async () => {
      mocks.events.push('save');
      if (fail) throw new Error('disk unavailable');
    });

  it("closes the dock only after the dock's own turn-off is saved", async () => {
    await startOn();
    saving();
    await expect(register()(dock, false)).resolves.toEqual({ enabled: false });
    expect(mocks.events).toEqual(['save', 'hide', 'change']);
    expect(isDockLabEnabled()).toBe(false);
  });

  it("keeps the dock open when the dock's own turn-off cannot be saved", async () => {
    await startOn();
    saving(true);
    await expect(register()(dock, false)).rejects.toThrow('disk unavailable');
    expect(mocks.events).toEqual(['save']);
    expect(isDockLabEnabled()).toBe(true);
  });

  it('stops the dock at once for a turn-off from Settings, even if the save fails', async () => {
    await startOn();
    saving(true);
    await expect(register()(settings, false)).rejects.toThrow('disk unavailable');
    expect(mocks.events).toEqual(['hide', 'save']);
    expect(isDockLabEnabled()).toBe(true);
    mocks.events.length = 0;
    saving();
    await expect(register()(settings, false)).resolves.toEqual({ enabled: false });
    expect(mocks.events).toEqual(['hide', 'save', 'change']);
  });
});

describe('hiding the dock and the Notch dock setting are one setting', () => {
  let restored: boolean;
  function register() {
    mocks.handlers.clear();
    registerDockLabHandlers({
      show: async () => void mocks.events.push('show'),
      hide: () => void mocks.events.push('hide'),
      onChange: () => void mocks.events.push('change'),
      restore: async () => (mocks.events.push('restore'), restored),
      isDock: () => false,
    });
  }
  async function launch(saved: boolean) {
    mocks.read.mockResolvedValue(saved);
    await loadDockLabEnabled();
    register();
    mocks.write.mockImplementation(async () => void mocks.events.push('save'));
  }
  beforeEach(() => {
    restored = true;
  });

  it('a hide turns Notch dock off and tells every window, so Settings shows it off', async () => {
    await launch(true);
    await expect(changeDockLabEnabled(false)).resolves.toBe(false);
    expect(mocks.events).toEqual(['hide', 'save', 'change']);
    expect(mocks.write).toHaveBeenCalledWith(false);
    expect(isDockLabEnabled()).toBe(false);
    expect(mocks.sent).toEqual([{ enabled: false }]);
  });

  it('a hide whose save fails still closes the dock; the setting stays truthful and retryable', async () => {
    await launch(true);
    mocks.write.mockImplementation(async () => {
      mocks.events.push('save');
      throw new Error('disk unavailable');
    });
    await expect(changeDockLabEnabled(false)).rejects.toThrow('disk unavailable');
    expect(mocks.events).toEqual(['hide', 'save']);
    expect(isDockLabEnabled()).toBe(true);
  });

  it('a launch after a hide saved by an older build turns Notch dock off instead of on with no dock', async () => {
    await launch(true);
    restored = false;
    await startDockLab();
    expect(mocks.events).toEqual(['restore', 'hide', 'save', 'change']);
    expect(mocks.write).toHaveBeenCalledWith(false);
    expect(isDockLabEnabled()).toBe(false);
    expect(mocks.sent).toEqual([{ enabled: false }]);
  });

  it('a launch whose turn-off cannot be saved keeps starting with the setting truthful', async () => {
    await launch(true);
    restored = false;
    mocks.write.mockRejectedValue(new Error('disk unavailable'));
    await expect(startDockLab()).resolves.toBeUndefined();
    expect(isDockLabEnabled()).toBe(true);
  });

  it('a launch with the dock shown restores it and leaves Notch dock on', async () => {
    await launch(true);
    await startDockLab();
    expect(mocks.events).toEqual(['restore']);
    expect(isDockLabEnabled()).toBe(true);
  });

  it('a launch with Notch dock off shows no dock', async () => {
    await launch(false);
    await startDockLab();
    expect(mocks.events).toEqual([]);
    expect(isDockLabEnabled()).toBe(false);
  });
});
