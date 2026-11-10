/**
 * The main-owned Unified window Labs setting: startup load keeps the lab off unless
 * the user opted in, and the set handler persists before applying. Turning it off
 * closes the Unified window (so it is not restored) and rebuilds menus; a failed save
 * changes nothing and the same request stays retryable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<boolean>>(),
  write: vi.fn<(enabled: boolean) => Promise<void>>(),
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  sent: [] as Array<{ channel: string; payload: unknown }>,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (channel: string, payload: unknown) => mocks.sent.push({ channel, payload }),
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
  getUnifiedWindowLabEnabledLocalPref: mocks.read,
  setUnifiedWindowLabEnabledLocalPref: mocks.write,
}));
vi.mock('./ipc-validation-middleware', () => ({
  createSafeValidatedHandler: (_schema: unknown, handler: unknown) => handler,
}));

import { WINDOW_CHANNELS } from '../shared/ipc/channels';
import {
  _resetUnifiedWindowLabForTests,
  isUnifiedWindowLabEnabled,
  loadUnifiedWindowLabEnabled,
  registerUnifiedWindowLabHandlers,
} from './unified-window-lab';

const effects = { disabled: vi.fn(), onChange: vi.fn() };

function set(enabled: boolean) {
  const handler = mocks.handlers.get(WINDOW_CHANNELS.SET_UNIFIED_WINDOW_LAB);
  if (!handler) throw new Error('handler not registered');
  return handler({ sender: {} }, { enabled });
}

beforeEach(() => {
  _resetUnifiedWindowLabForTests();
  mocks.read.mockReset();
  mocks.write.mockReset().mockResolvedValue(undefined);
  mocks.sent.length = 0;
  effects.disabled.mockReset();
  effects.onChange.mockReset();
  registerUnifiedWindowLabHandlers(effects);
});

describe('loadUnifiedWindowLabEnabled', () => {
  it('follows a saved opt-in', async () => {
    mocks.read.mockResolvedValue(true);
    await expect(loadUnifiedWindowLabEnabled()).resolves.toBe(true);
    expect(isUnifiedWindowLabEnabled()).toBe(true);
  });

  it('stays off when the preference cannot be read', async () => {
    mocks.read.mockRejectedValue(new Error('unreadable'));
    await expect(loadUnifiedWindowLabEnabled()).resolves.toBe(false);
  });
});

describe('window:set-unified-window-lab', () => {
  it('persists, rebuilds menus and tells every window when turned on', async () => {
    await expect(set(true)).resolves.toEqual({ enabled: true });
    expect(mocks.write).toHaveBeenCalledWith(true);
    expect(effects.onChange).toHaveBeenCalledTimes(1);
    expect(effects.disabled).not.toHaveBeenCalled();
    expect(mocks.sent).toEqual([
      { channel: WINDOW_CHANNELS.UNIFIED_WINDOW_LAB_CHANGED, payload: { enabled: true } },
    ]);
  });

  it('closes the Unified window when turned off', async () => {
    await set(true);
    await expect(set(false)).resolves.toEqual({ enabled: false });
    expect(effects.disabled).toHaveBeenCalledTimes(1);
  });

  it('changes nothing when the save fails, and the request can be retried', async () => {
    mocks.write.mockRejectedValueOnce(new Error('disk full'));
    await expect(set(true)).rejects.toThrow('disk full');
    expect(isUnifiedWindowLabEnabled()).toBe(false);
    expect(effects.onChange).not.toHaveBeenCalled();
    await expect(set(true)).resolves.toEqual({ enabled: true });
  });

  it('does nothing when the requested state is already current', async () => {
    await expect(set(false)).resolves.toEqual({ enabled: false });
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
