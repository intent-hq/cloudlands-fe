/**
 * Regression tests for the DEV gate on the browser mock (audit row 17).
 *
 * The mock electronAPI must only activate in dev builds (import.meta.env.DEV)
 * or under the explicit VITE_ENABLE_BROWSER_MOCK=true opt-in. In a non-DEV run
 * with no bridge, unbridged channels must reject loudly via
 * UnbridgedMockIpcChannelError instead of silently serving MOCK_WORKSPACES.
 * Every served mock response must log a [BrowserMock]-prefixed warning naming
 * the channel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockInvoke, resetMockIpcRouter, UnbridgedMockIpcChannelError } from '$shared/ipc-mock-router';

/** Import a fresh copy of browser-mock so its auto-install side effect re-runs. */
async function importBrowserMock() {
  vi.resetModules();
  return await import('./browser-mock');
}

describe('browser-mock DEV gate', () => {
  const originalElectronAPI = (window as any).electronAPI;

  beforeEach(() => {
    delete (window as any).electronAPI;
    vi.stubEnv('VITE_ENABLE_BROWSER_MOCK', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    (window as any).electronAPI = originalElectronAPI;
  });

  it('does NOT install the mock when import.meta.env.DEV is false', async () => {
    vi.stubEnv('DEV', false);

    const { installBrowserMock, isBrowserMockEnabled } = await importBrowserMock();

    expect(isBrowserMockEnabled()).toBe(false);
    expect((window as any).electronAPI).toBeUndefined();
    expect(installBrowserMock()).toBe(false);
    expect((window as any).electronAPI).toBeUndefined();
  });

  it('non-DEV env with no bridge: channels reject instead of serving MOCK_WORKSPACES', async () => {
    vi.stubEnv('DEV', false);

    await importBrowserMock();

    // No mock electronAPI was installed, so renderer invokes route through the
    // mock IPC router — which, with no seeders registered, must reject loudly.
    expect((window as any).electronAPI).toBeUndefined();
    resetMockIpcRouter();
    await expect(mockInvoke('workspace:list')).rejects.toThrow(UnbridgedMockIpcChannelError);
  });

  it('installs the mock in DEV builds', async () => {
    vi.stubEnv('DEV', true);

    const { isBrowserMockEnabled } = await importBrowserMock();

    expect(isBrowserMockEnabled()).toBe(true);
    expect((window as any).electronAPI).toBeDefined();
  });

  it('installs the mock under the explicit VITE_ENABLE_BROWSER_MOCK=true opt-in', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_ENABLE_BROWSER_MOCK', 'true');

    const { isBrowserMockEnabled } = await importBrowserMock();

    expect(isBrowserMockEnabled()).toBe(true);
    expect((window as any).electronAPI).toBeDefined();
  });

  it('never overwrites a real electronAPI bridge', async () => {
    vi.stubEnv('DEV', true);
    const realBridge = { invoke: vi.fn() };
    (window as any).electronAPI = realBridge;

    const { installBrowserMock } = await importBrowserMock();

    expect(installBrowserMock()).toBe(false);
    expect((window as any).electronAPI).toBe(realBridge);
  });

  it('logs a [BrowserMock]-prefixed warning naming the channel for every served response', async () => {
    vi.stubEnv('DEV', true);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await importBrowserMock();

    const api = (window as any).electronAPI;
    expect(api).toBeDefined();

    const result = await api.invoke('workspace:list');
    expect(result.success).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[BrowserMock\].*'workspace:list'/),
    );

    warnSpy.mockClear();
    await api.invoke('skills:list');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/\[BrowserMock\].*'skills:list'/));
  });
});
