/**
 * Regression tests for the browser CDP invoke bridge seeder
 * (intent-hq/monorepo#2926).
 *
 * The generated `invoke()` routes ALL legacy renderer invokes through the
 * mock router in every build, and `browser:list-tabs-response` was an
 * UNBRIDGED_INVOKE_ALLOWLIST absence ("unreachable in this build" — written
 * for the bridge-less web build). In the packaged app the main process DOES
 * fire `browser:list-tabs-request` and the browser IPC saga DOES reply, but
 * the reply resolved `undefined` in the renderer without ever reaching
 * `ipcMain`, so every `requestPanelBrowserTabs` timed out, the per-workspace
 * tab cache was never seeded, and agent listTabs / closeTab / open-tab dedupe
 * all failed persistently. The saga's own unit tests mock `invoke`, which is
 * why the swallowed hop was invisible — these tests pin the payload reaching
 * the (mock) PRELOAD BRIDGE, not a mocked invoke.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { registerBrowserIpcBridge } from './browser-ipc-bridge-seeder';

const INVOKE_CHANNELS = [
  IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE,
  IPC_CHANNELS.BROWSER.REGISTER_TAB,
  IPC_CHANNELS.BROWSER.REPORT_TAB_BOUNDS,
  IPC_CHANNELS.BROWSER.SET_TAB_VIEWPORT,
  IPC_CHANNELS.BROWSER.CLEAR_AGENT_TABS,
];

const originalElectronAPI = (window as any).electronAPI;

describe('browser-ipc-bridge-seeder', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('forwards all browser invoke channels to window.electronAPI.invoke when bridged', async () => {
    const invokeSpy = vi.fn(async (channel: string) => ({ success: true, forwarded: channel }));
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerBrowserIpcBridge();

    for (const channel of INVOKE_CHANNELS) {
      const result = await mockInvoke<{ success: boolean; forwarded: string }>(channel, {
        probe: channel,
      });
      expect(result.success).toBe(true);
      expect(result.forwarded).toBe(channel);
      expect(invokeSpy).toHaveBeenCalledWith(channel, { probe: channel });
    }
    expect(invokeSpy).toHaveBeenCalledTimes(INVOKE_CHANNELS.length);
  });

  it('forwards the saga reply payload (tabs + requestId) verbatim to the preload bridge', async () => {
    // The exact shape browser-ipc-saga's listBrowserTabs sends: main's
    // ipcMain.handle(LIST_TABS_RESPONSE) needs tabs AND the echoed requestId
    // to resolve the matching pending request and seed the tab cache.
    const invokeSpy = vi.fn(async () => undefined);
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerBrowserIpcBridge();

    const payload = {
      tabs: [
        {
          tabId: 'tab-1',
          url: 'https://example.com/',
          title: 'Example Domain',
          closable: true,
          ownerAgentId: 'agent-1',
        },
      ],
      requestId: 'list-tabs-7',
    };
    await mockInvoke(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE, payload);

    expect(invokeSpy).toHaveBeenCalledExactlyOnceWith(
      IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE,
      payload,
    );
  });

  it('forwards the hydration-failed error reply (monorepo#2789 truthful error) to the preload bridge', async () => {
    const invokeSpy = vi.fn(async () => undefined);
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerBrowserIpcBridge();

    const payload = { requestId: 'list-tabs-8', error: 'layout hydration failed: boom' };
    await mockInvoke(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE, payload);

    expect(invokeSpy).toHaveBeenCalledExactlyOnceWith(
      IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE,
      payload,
    );
  });

  it('resolves undefined when no preload bridge exists (browser dev build)', async () => {
    (window as any).electronAPI = undefined;
    registerBrowserIpcBridge();

    for (const channel of INVOKE_CHANNELS) {
      await expect(mockInvoke(channel, { probe: channel })).resolves.toBeUndefined();
    }
  });
});
