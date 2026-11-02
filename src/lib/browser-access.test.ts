/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { canManageBrowserAccess, tailscaleServeCommand } from './browser-access';
import { invokeBrowserAccess } from './browser-access-ipc';

const originalApi = window.electronAPI;
afterEach(() => {
  window.electronAPI = originalApi;
});

describe('invokeBrowserAccess', () => {
  it('sends the channel and payload and returns the parsed state', async () => {
    const invoke = vi.fn(async () => ({
      available: true,
      enabled: true,
      port: 47120,
      running: false,
      accessKey: 'k',
    }));
    window.electronAPI = { ...originalApi, invoke } as never;
    await expect(
      invokeBrowserAccess('browser-access:set-enabled', { enabled: true }),
    ).resolves.toEqual({
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
    await expect(invokeBrowserAccess('browser-access:get-state', {})).rejects.toThrow(/Malformed/);
  });

  it('rejects and reports unmanageable without a preload bridge', async () => {
    delete (window as Partial<Window>).electronAPI;
    expect(canManageBrowserAccess()).toBe(false);
    await expect(invokeBrowserAccess('browser-access:get-state', {})).rejects.toThrow(
      /electronAPI/,
    );
  });
});

it('builds the tailscale serve command for the port', () => {
  expect(tailscaleServeCommand(50000)).toBe('tailscale serve --bg 50000');
});
