/**
 * Startup load of the dock setting under the default-on policy: a profile that
 * never chose is opted in, an explicit saved opt-out stays off, and a read
 * failure keeps the dock off rather than guessing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn<() => Promise<boolean>>() }));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('./local-prefs', () => ({
  getDockLabEnabledLocalPref: mocks.read,
  setDockLabEnabledLocalPref: vi.fn(),
}));

import { isDockLabEnabled, loadDockLabEnabled } from './dock-lab';

beforeEach(() => {
  mocks.read.mockReset();
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
