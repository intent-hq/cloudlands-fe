/**
 * The main-owned dock setting. Startup load: a saved opt-in turns the dock on, a
 * saved opt-out or a profile that never chose stays off, and a read failure keeps
 * the dock off rather than guessing. And the `window:set-dock-lab`
 * handler's lifecycle: a disable from Settings stops the dock at once (even if the
 * save fails); a disable from the dock itself (its intro's "Turn off") closes the
 * dock only after the save is confirmed, so a failed save leaves it open to retry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<boolean>>(),
  write: vi.fn<(enabled: boolean) => Promise<void>>(),
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  events: [] as string[],
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
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
import { isDockLabEnabled, loadDockLabEnabled, registerDockLabHandlers } from './dock-lab';

beforeEach(() => {
  mocks.read.mockReset();
  mocks.write.mockReset();
  mocks.events.length = 0;
});

describe('loadDockLabEnabled', () => {
  it('is on when the saved preference is on', async () => {
    mocks.read.mockResolvedValue(true);
    await expect(loadDockLabEnabled()).resolves.toBe(true);
    expect(isDockLabEnabled()).toBe(true);
  });

  it('stays off when the preference reads as off (opt-out or never chose)', async () => {
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
