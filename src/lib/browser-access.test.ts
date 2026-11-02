/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { canManageBrowserAccess } from './browser-access';
import { getBrowserAccessState, setBrowserAccessEnabled } from './browser-access-ipc';

const originalApi = window.electronAPI;
afterEach(() => {
  window.electronAPI = originalApi;
});

describe('browser access IPC', () => {
  it('sends the channel and payload and returns the parsed state', async () => {
    const invoke = vi.fn(async () => ({
      available: true,
      enabled: true,
      port: 47120,
      running: false,
      accessKey: 'k',
    }));
    window.electronAPI = { ...originalApi, invoke } as never;
    await expect(setBrowserAccessEnabled(true)).resolves.toEqual({
      available: true,
      enabled: true,
      port: 47120,
      running: false,
      error: null,
      accessKey: 'k',
    });
    expect(invoke).toHaveBeenCalledWith('browser-access:set-enabled', { enabled: true });
  });

  it('rejects a malformed reply', async () => {
    window.electronAPI = {
      ...originalApi,
      invoke: vi.fn(async () => ({ enabled: true })),
    } as never;
    await expect(getBrowserAccessState()).rejects.toThrow(/Malformed/);
  });

  it('rejects and reports unmanageable without a preload bridge', async () => {
    delete (window as Partial<Window>).electronAPI;
    expect(canManageBrowserAccess()).toBe(false);
    await expect(getBrowserAccessState()).rejects.toThrow(/electronAPI/);
  });
});
