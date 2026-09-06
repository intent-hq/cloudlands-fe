import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  sendToWorkspaceWindows: vi.fn(),
  fromId: vi.fn(),
  getAllWebContents: vi.fn(() => []),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  webContents: { fromId: mocks.fromId, getAllWebContents: mocks.getAllWebContents },
}));

vi.mock('../../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: mocks.sendToWorkspaceWindows,
}));

import { IPC_CHANNELS } from '../../../../shared/ipc-registry';
import { embeddedBrowserCdp } from '../embedded-browser-cdp-service';

const DELIVERED = { windowCount: 1, browserClientsNotified: false, delivered: true };
const DROPPED = { windowCount: 0, browserClientsNotified: false, delivered: false };

describe('embedded browser CDP workspace routing', () => {
  const responseHandlers = new Map<string, (event: unknown, data: unknown) => unknown>();

  beforeEach(() => {
    responseHandlers.clear();
    for (const [channel, handler] of mocks.handle.mock.calls) {
      responseHandlers.set(channel, handler);
    }
    mocks.sendToWorkspaceWindows.mockReset();
    mocks.sendToWorkspaceWindows.mockReturnValue(DELIVERED);
  });

  it.each([undefined, null, '', 42, { workspaceId: 'ws-2' }])(
    'rejects browser close without valid workspace context: %j',
    async (workspaceId) => {
      await expect(
        embeddedBrowserCdp.closeTab('tab-1', workspaceId as unknown as string),
      ).rejects.toThrow('workspaceId is required');
      expect(mocks.sendToWorkspaceWindows).not.toHaveBeenCalled();
    },
  );

  // Regression (intent-hq/monorepo#2602): these used to fall back to a
  // broadcast to ALL windows, letting a call that omitted workspaceId
  // focus/enumerate tabs in unrelated workspaces' windows.
  it.each([undefined, null, ''])(
    'rejects tab focus without workspace context instead of broadcasting: %j',
    async (workspaceId) => {
      await expect(
        embeddedBrowserCdp.focusTab('tab-1', workspaceId as unknown as string),
      ).rejects.toThrow('workspaceId is required');
      expect(mocks.sendToWorkspaceWindows).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, ''])(
    'rejects tab listing without workspace context instead of broadcasting: %j',
    async (workspaceId) => {
      await expect(
        embeddedBrowserCdp.listAllTabs(workspaceId as unknown as string),
      ).rejects.toThrow('workspaceId is required');
      expect(mocks.sendToWorkspaceWindows).not.toHaveBeenCalled();
    },
  );

  // Regression (intent-hq/monorepo#2602): focusTab used to return true after
  // sending, even when zero windows received the message.
  it('reports focus failure when the workspace is not open in any window', async () => {
    mocks.sendToWorkspaceWindows.mockReturnValue(DROPPED);
    await expect(embeddedBrowserCdp.focusTab('tab-1', 'ws-closed')).resolves.toBe(false);
  });

  // The renderer saga routes browser:focus-tab by the payload's workspaceId
  // (monorepo#2756), so the focus payload must carry it. Focus success also
  // requires the tab to actually mount and register (RC3): the renderer's
  // registerTab resolves the pending focus.
  it('sends focus requests scoped to the workspace and resolves once the tab registers', async () => {
    mocks.fromId.mockReturnValue({ isDestroyed: () => false, once: vi.fn() });
    mocks.sendToWorkspaceWindows.mockImplementation((_ws: string, channel: string) => {
      if (channel === IPC_CHANNELS.BROWSER.FOCUS_TAB) {
        // Simulate the renderer remounting the webview and registering it.
        queueMicrotask(() => embeddedBrowserCdp.registerTab('tab-1', 42));
      }
      return DELIVERED;
    });

    await expect(embeddedBrowserCdp.focusTab('tab-1', 'ws-2')).resolves.toBe(true);
    expect(mocks.sendToWorkspaceWindows).toHaveBeenCalledExactlyOnceWith(
      'ws-2',
      IPC_CHANNELS.BROWSER.FOCUS_TAB,
      { tabId: 'tab-1', workspaceId: 'ws-2' },
    );
  });

  // RC3 (monorepo#2756): a delivered focus for a tab that never mounts (e.g.
  // a nonexistent tabId) must resolve false after the bounded wait, not
  // report success on mere delivery.
  it('reports focus failure when the tab never registers within the bounded wait', async () => {
    vi.useFakeTimers();
    try {
      const pending = embeddedBrowserCdp.focusTab('tab-nonexistent', 'ws-2');
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('waitForTabRegistration', () => {
    it('resolves immediately for an already-registered tab with live webContents', async () => {
      mocks.fromId.mockReturnValue({ isDestroyed: () => false, once: vi.fn() });
      embeddedBrowserCdp.registerTab('tab-live', 7);
      await expect(embeddedBrowserCdp.waitForTabRegistration('tab-live')).resolves.toBe(true);
    });

    it('resolves true when the tab registers before the timeout', async () => {
      mocks.fromId.mockReturnValue({ isDestroyed: () => false, once: vi.fn() });
      const pending = embeddedBrowserCdp.waitForTabRegistration('tab-late');
      embeddedBrowserCdp.registerTab('tab-late', 8);
      await expect(pending).resolves.toBe(true);
    });

    it('resolves false when the tab never registers within the timeout', async () => {
      vi.useFakeTimers();
      try {
        const pending = embeddedBrowserCdp.waitForTabRegistration('tab-never', 1_000);
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(pending).resolves.toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // Offscreen keep-alive handoff (monorepo#2789 slice 2): a tab moving
  // between hosts (offscreen container ↔ visible panel) re-registers with a
  // new webContentsId before the superseded guest's destroyed event fires.
  // The destroyed hook must not clobber the newer registration.
  describe('registerTab destroyed-hook handoff guard', () => {
    function registerWithDestroyCapture(tabId: string, webContentsId: number): () => void {
      let destroyedCallback: (() => void) | undefined;
      mocks.fromId.mockReturnValueOnce({
        isDestroyed: () => false,
        once: (event: string, cb: () => void) => {
          if (event === 'destroyed') destroyedCallback = cb;
        },
      });
      embeddedBrowserCdp.registerTab(tabId, webContentsId);
      return () => destroyedCallback?.();
    }

    it('keeps the newer registration when a superseded webContents is destroyed', async () => {
      const fireOldDestroyed = registerWithDestroyCapture('tab-handoff', 210);
      registerWithDestroyCapture('tab-handoff', 211);
      fireOldDestroyed();
      mocks.fromId.mockReturnValue({ isDestroyed: () => false, once: vi.fn() });
      await expect(embeddedBrowserCdp.waitForTabRegistration('tab-handoff')).resolves.toBe(true);
    });

    it('still cleans the registry when the current webContents is destroyed', async () => {
      const fireDestroyed = registerWithDestroyCapture('tab-gone', 220);
      fireDestroyed();
      vi.useFakeTimers();
      try {
        const pending = embeddedBrowserCdp.waitForTabRegistration('tab-gone', 1_000);
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(pending).resolves.toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // Viewport emulation for agent-owned tabs (docs/protocol §5.9): owned tabs
  // are always emulated at their recorded size; scale-to-fit shrinks the
  // displayed image to the reported webview bounds without changing layout.
  describe('viewport emulation (§5.9)', () => {
    function mountedWebContents() {
      const sendCommand = vi.fn().mockResolvedValue(undefined);
      const wc = {
        isDestroyed: () => false,
        once: vi.fn(),
        debugger: {
          isAttached: () => true,
          sendCommand,
          on: vi.fn(),
        },
      };
      mocks.fromId.mockReturnValue(wc);
      return sendCommand;
    }

    async function flushAsync() {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('applies device-metrics emulation when a mounted tab is claimed', async () => {
      const sendCommand = mountedWebContents();
      embeddedBrowserCdp.registerTab('tab-emu-1', 301);
      sendCommand.mockClear();

      embeddedBrowserCdp.claimTab('tab-emu-1', 'agent-1', { width: 1024, height: 768 });
      await flushAsync();

      expect(sendCommand).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', {
        width: 1024,
        height: 768,
        deviceScaleFactor: 0,
        mobile: false,
        scale: 1,
      });
    });

    it('re-applies the recorded viewport when an owned tab registers (remount)', async () => {
      const sendCommand = mountedWebContents();
      embeddedBrowserCdp.setTabOwner('tab-emu-2', 'agent-1', undefined, {
        width: 390,
        height: 844,
      });
      sendCommand.mockClear();

      embeddedBrowserCdp.registerTab('tab-emu-2', 302);
      await flushAsync();

      expect(sendCommand).toHaveBeenCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ width: 390, height: 844 }),
      );
    });

    it('resizeTab records the new size, keeps height when omitted, and re-emulates', async () => {
      const sendCommand = mountedWebContents();
      embeddedBrowserCdp.registerTab('tab-emu-3', 303);
      embeddedBrowserCdp.setTabOwner('tab-emu-3', 'agent-1', undefined, {
        width: 1280,
        height: 800,
      });
      sendCommand.mockClear();

      const size = embeddedBrowserCdp.resizeTab('tab-emu-3', 390);
      await flushAsync();

      expect(size).toEqual({ width: 390, height: 800 });
      expect(embeddedBrowserCdp.getTabEmulatedSize('tab-emu-3')).toEqual({
        width: 390,
        height: 800,
      });
      expect(sendCommand).toHaveBeenCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ width: 390, height: 800 }),
      );
    });

    it('resizeTab returns undefined for unowned tabs and applies nothing', async () => {
      const sendCommand = mountedWebContents();
      embeddedBrowserCdp.registerTab('tab-emu-4', 304);
      sendCommand.mockClear();

      expect(embeddedBrowserCdp.resizeTab('tab-emu-4', 800)).toBeUndefined();
      await flushAsync();
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('scale-to-fit shrinks the display to reported bounds but never upscales', async () => {
      const sendCommand = mountedWebContents();
      embeddedBrowserCdp.registerTab('tab-emu-5', 305);
      embeddedBrowserCdp.setTabOwner('tab-emu-5', 'agent-1', undefined, {
        width: 1280,
        height: 800,
      });
      sendCommand.mockClear();

      // Element half the emulated size → scale 0.5.
      embeddedBrowserCdp.reportTabViewBounds('tab-emu-5', 640, 400);
      await flushAsync();
      expect(sendCommand).toHaveBeenCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ width: 1280, height: 800, scale: 0.5 }),
      );

      // Element larger than the emulated size → capped at 1 (no upscale).
      sendCommand.mockClear();
      embeddedBrowserCdp.reportTabViewBounds('tab-emu-5', 2000, 1500);
      await flushAsync();
      expect(sendCommand).toHaveBeenCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ scale: 1 }),
      );
    });

    it('ignores duplicate and non-positive bounds reports', async () => {
      const sendCommand = mountedWebContents();
      embeddedBrowserCdp.registerTab('tab-emu-6', 306);
      embeddedBrowserCdp.setTabOwner('tab-emu-6', 'agent-1');
      embeddedBrowserCdp.reportTabViewBounds('tab-emu-6', 640, 400);
      await flushAsync();
      sendCommand.mockClear();

      embeddedBrowserCdp.reportTabViewBounds('tab-emu-6', 640, 400);
      embeddedBrowserCdp.reportTabViewBounds('tab-emu-6', 0, 400);
      embeddedBrowserCdp.reportTabViewBounds('tab-emu-6', 640, -1);
      await flushAsync();

      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('applies nothing for unmounted owned tabs (registration re-applies later)', async () => {
      const sendCommand = vi.fn().mockResolvedValue(undefined);
      mocks.fromId.mockReturnValue(undefined);

      embeddedBrowserCdp.setTabOwner('tab-emu-unmounted', 'agent-1', undefined, {
        width: 1024,
        height: 768,
      });
      await flushAsync();

      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('an explicit bounds clear drops the recorded bounds and re-applies at scale 1', async () => {
      const sendCommand = mountedWebContents();
      embeddedBrowserCdp.registerTab('tab-emu-clear', 307);
      embeddedBrowserCdp.setTabOwner('tab-emu-clear', 'agent-1', undefined, {
        width: 1280,
        height: 800,
      });
      embeddedBrowserCdp.reportTabViewBounds('tab-emu-clear', 640, 400);
      await flushAsync();
      sendCommand.mockClear();

      embeddedBrowserCdp.clearTabViewBounds('tab-emu-clear');
      await flushAsync();

      expect(sendCommand).toHaveBeenCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ width: 1280, height: 800, scale: 1 }),
      );

      // Clearing again is a no-op (nothing recorded).
      sendCommand.mockClear();
      embeddedBrowserCdp.clearTabViewBounds('tab-emu-clear');
      await flushAsync();
      expect(sendCommand).not.toHaveBeenCalled();
    });

    // Regression: a visible→offscreen handoff re-registers the tab with a new
    // webContentsId BEFORE the old guest's destroyed fires, so the destroyed
    // hook's handoff guard is false and cannot drop the visible element's
    // bounds. The renderer's explicit clear (destroy() of the bounds action)
    // must restore scale 1 on the offscreen host.
    it('handoff regression: explicit clear removes stale visible bounds after register-before-destroy', async () => {
      const sendCommand = vi.fn().mockResolvedValue(undefined);
      let destroyedCallback: (() => void) | undefined;
      mocks.fromId.mockImplementation((id: number) => ({
        isDestroyed: () => false,
        once: (event: string, cb: () => void) => {
          if (event === 'destroyed' && id === 401) destroyedCallback = cb;
        },
        debugger: { isAttached: () => true, sendCommand, on: vi.fn() },
      }));

      // Visible host mounts and reports its (smaller) panel bounds.
      embeddedBrowserCdp.registerTab('tab-handoff-scale', 401);
      embeddedBrowserCdp.setTabOwner('tab-handoff-scale', 'agent-1', undefined, {
        width: 1280,
        height: 800,
      });
      embeddedBrowserCdp.reportTabViewBounds('tab-handoff-scale', 640, 400);
      await flushAsync();

      // Handoff: offscreen host registers FIRST — stale bounds still apply.
      sendCommand.mockClear();
      embeddedBrowserCdp.registerTab('tab-handoff-scale', 402);
      await flushAsync();
      expect(sendCommand).toHaveBeenCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ scale: 0.5 }),
      );

      // The visible element's explicit clear restores scale 1...
      sendCommand.mockClear();
      embeddedBrowserCdp.clearTabViewBounds('tab-handoff-scale');
      await flushAsync();
      expect(sendCommand).toHaveBeenCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ width: 1280, height: 800, scale: 1 }),
      );

      // ...and the old guest's late destroyed must not clobber the newer
      // registration (handoff guard) — emulation still targets the new host.
      destroyedCallback?.();
      sendCommand.mockClear();
      embeddedBrowserCdp.resizeTab('tab-handoff-scale', 390);
      await flushAsync();
      expect(sendCommand).toHaveBeenCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ width: 390, height: 800, scale: 1 }),
      );
    });
  });

  // showTab (monorepo#3045): reveal delivery + confirm-by-list discipline.
  describe('showTab', () => {
    it.each([undefined, null, ''])(
      'rejects show without workspace context instead of broadcasting: %j',
      async (workspaceId) => {
        await expect(
          embeddedBrowserCdp.showTab('tab-1', workspaceId as unknown as string),
        ).rejects.toThrow('workspaceId is required');
        expect(mocks.sendToWorkspaceWindows).not.toHaveBeenCalled();
      },
    );

    it('fails with a clear error when the workspace is not open in any window', async () => {
      mocks.sendToWorkspaceWindows.mockReturnValue(DROPPED);
      await expect(embeddedBrowserCdp.showTab('tab-1', 'ws-closed', true)).rejects.toThrow(
        'workspace ws-closed is not open in any window',
      );
    });

    it('sends the reveal scoped to the workspace and confirms via a fresh non-hidden active listing', async () => {
      mocks.sendToWorkspaceWindows.mockImplementation(
        (_ws: string, channel: string, payload: { requestId?: string }) => {
          if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DELIVERED;
          responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
            {},
            {
              tabs: [{ tabId: 'tab-1', url: 'https://a.test', title: 'A', active: true }],
              requestId: payload.requestId,
            },
          );
          return DELIVERED;
        },
      );

      await expect(embeddedBrowserCdp.showTab('tab-1', 'ws-2', false)).resolves.toBeUndefined();
      expect(mocks.sendToWorkspaceWindows.mock.calls[0]).toEqual([
        'ws-2',
        IPC_CHANNELS.BROWSER.SHOW_TAB,
        { tabId: 'tab-1', workspaceId: 'ws-2', focus: false },
      ]);
    });

    // A visible-but-inactive listing means the activation has not applied
    // yet: the confirmation must keep polling until the tab is its panel's
    // active tab, so a success never precedes a paintable tab.
    it('keeps polling a visible-but-inactive listing until the tab is active', async () => {
      let listings = 0;
      mocks.sendToWorkspaceWindows.mockImplementation(
        (_ws: string, channel: string, payload: { requestId?: string }) => {
          if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DELIVERED;
          listings += 1;
          responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
            {},
            {
              tabs: [
                {
                  tabId: 'tab-1',
                  url: 'https://a.test',
                  title: 'A',
                  ...(listings >= 2 ? { active: true } : {}),
                },
              ],
              requestId: payload.requestId,
            },
          );
          return DELIVERED;
        },
      );

      await expect(embeddedBrowserCdp.showTab('tab-1', 'ws-2')).resolves.toBeUndefined();
      expect(listings).toBe(2);
    });

    it('fails when the tab is listed visible but never becomes active', async () => {
      mocks.sendToWorkspaceWindows.mockImplementation(
        (_ws: string, channel: string, payload: { requestId?: string }) => {
          if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DELIVERED;
          responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
            {},
            {
              tabs: [{ tabId: 'tab-1', url: 'https://a.test', title: 'A' }],
              requestId: payload.requestId,
            },
          );
          return DELIVERED;
        },
      );

      await expect(embeddedBrowserCdp.showTab('tab-1', 'ws-2')).rejects.toThrow(
        'could not be shown',
      );
    });

    it('fails when the tab stays hidden in every confirmation listing', async () => {
      mocks.sendToWorkspaceWindows.mockImplementation(
        (_ws: string, channel: string, payload: { requestId?: string }) => {
          if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DELIVERED;
          responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
            {},
            {
              tabs: [{ tabId: 'tab-1', url: 'https://a.test', title: 'A', hidden: true }],
              requestId: payload.requestId,
            },
          );
          return DELIVERED;
        },
      );

      await expect(embeddedBrowserCdp.showTab('tab-1', 'ws-2')).rejects.toThrow(
        'could not be shown',
      );
    });
  });

  // Hidden marker projection (monorepo#3045): listAllTabs carries the
  // renderer's hidden flag through for the executor's visibility field.
  it('listAllTabs carries the hidden marker for hidden tabs only', async () => {
    mocks.fromId.mockReturnValue(undefined);
    mocks.sendToWorkspaceWindows.mockImplementation(
      (_ws: string, channel: string, payload: { requestId?: string }) => {
        if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DELIVERED;
        responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
          {},
          {
            tabs: [
              { tabId: 'tab-hidden', url: 'https://h.test', title: 'H', hidden: true },
              { tabId: 'tab-visible', url: 'https://v.test', title: 'V' },
            ],
            requestId: payload.requestId,
          },
        );
        return DELIVERED;
      },
    );

    const { tabs } = await embeddedBrowserCdp.listAllTabs('ws-2');
    expect(tabs.find((t) => t.tabId === 'tab-hidden')?.hidden).toBe(true);
    expect(tabs.find((t) => t.tabId === 'tab-visible')).not.toHaveProperty('hidden');
  });

  it('fails a close with a clear error when the workspace is not open in any window', async () => {
    mocks.sendToWorkspaceWindows.mockImplementation(
      (workspaceId: string, channel: string, payload: { requestId?: string }) => {
        if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DROPPED;
        responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
          {},
          {
            tabs: [{ tabId: 'tab-1', url: 'https://example.test', title: 'Example' }],
            requestId: payload.requestId,
          },
        );
        return DELIVERED;
      },
    );

    await expect(embeddedBrowserCdp.closeTab('tab-1', 'ws-closed')).rejects.toThrow(
      'workspace ws-closed is not open in any window',
    );
  });

  // Regression (intent-hq/monorepo#2602): a request nothing received used to
  // wait out the full 500 ms timeout before falling back to the cache.
  it('short-circuits to the same-workspace cache without waiting when nothing received the list request', async () => {
    // Seed the cache for ws-cache via a delivered round-trip.
    mocks.sendToWorkspaceWindows.mockImplementation(
      (workspaceId: string, channel: string, payload: { requestId?: string }) => {
        if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DELIVERED;
        responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
          {},
          {
            tabs: [{ tabId: 'tab-cached', url: 'https://cached.test', title: 'Cached' }],
            requestId: payload.requestId,
          },
        );
        return DELIVERED;
      },
    );
    await expect(embeddedBrowserCdp.requestPanelBrowserTabs('ws-cache')).resolves.toEqual({
      tabs: [{ tabId: 'tab-cached', url: 'https://cached.test', title: 'Cached' }],
      stale: false,
    });

    vi.useFakeTimers();
    try {
      mocks.sendToWorkspaceWindows.mockReturnValue(DROPPED);
      // Resolves from the cache immediately — no timer advancement — instead
      // of burning the 500 ms reply timeout. Cached fallbacks are flagged
      // stale so callers can tell them from a fresh renderer reply.
      const result = await embeddedBrowserCdp.requestPanelBrowserTabs('ws-cache');
      expect(result).toEqual({
        tabs: [{ tabId: 'tab-cached', url: 'https://cached.test', title: 'Cached' }],
        stale: true,
      });

      // The fallback only consults the SAME workspace's cache entry — and
      // with no entry it rejects instead of fabricating an empty list
      // (monorepo#2756 RC4).
      await expect(embeddedBrowserCdp.requestPanelBrowserTabs('ws-other')).rejects.toThrow(
        'Cannot list browser tabs: workspace ws-other is not open in any window.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // RC4 (monorepo#2756): a delivered request the renderer never answers used
  // to resolve `[]` after the timeout — indistinguishable from "zero tabs".
  describe('list request timeout semantics (monorepo#2756 RC4)', () => {
    it('rejects on timeout when no cached tab list exists for the workspace', async () => {
      mocks.sendToWorkspaceWindows.mockReturnValue(DELIVERED); // delivered, never answered
      vi.useFakeTimers();
      try {
        const pending = embeddedBrowserCdp.requestPanelBrowserTabs('ws-silent');
        pending.catch(() => {}); // avoid unhandled rejection before assertion
        await vi.advanceTimersByTimeAsync(500);
        await expect(pending).rejects.toThrow(
          'Tab list for workspace ws-silent is unavailable: the renderer did not respond and no cached tab list exists.',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('resolves stale cached data on timeout when a same-workspace cache entry exists', async () => {
      // Seed the cache for ws-slow via a delivered round-trip.
      mocks.sendToWorkspaceWindows.mockImplementation(
        (workspaceId: string, channel: string, payload: { requestId?: string }) => {
          if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DELIVERED;
          responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
            {},
            {
              tabs: [{ tabId: 'tab-slow', url: 'https://slow.test', title: 'Slow' }],
              requestId: payload.requestId,
            },
          );
          return DELIVERED;
        },
      );
      await embeddedBrowserCdp.requestPanelBrowserTabs('ws-slow');

      // Renderer stops answering: delivered but silent.
      mocks.sendToWorkspaceWindows.mockReturnValue(DELIVERED);
      vi.useFakeTimers();
      try {
        const pending = embeddedBrowserCdp.requestPanelBrowserTabs('ws-slow');
        await vi.advanceTimersByTimeAsync(500);
        await expect(pending).resolves.toEqual({
          tabs: [{ tabId: 'tab-slow', url: 'https://slow.test', title: 'Slow' }],
          stale: true,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    // monorepo#2789: a renderer whose background layout hydration failed
    // reports a truthful error; the request rejects with it instead of
    // timing out as "renderer did not respond".
    it('rejects with the renderer-reported error instead of waiting out the timeout', async () => {
      mocks.sendToWorkspaceWindows.mockImplementation(
        (workspaceId: string, channel: string, payload: { requestId?: string }) => {
          if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DELIVERED;
          responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
            {},
            { error: 'layout hydration failed: storage exploded', requestId: payload.requestId },
          );
          return DELIVERED;
        },
      );

      await expect(embeddedBrowserCdp.requestPanelBrowserTabs('ws-hydfail')).rejects.toThrow(
        'layout hydration failed: storage exploded',
      );
    });

    it('ignores a nullish list-tabs response payload without throwing', () => {
      const handler = responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE);
      expect(handler).toBeDefined();
      expect(() => handler?.({}, null)).not.toThrow();
      expect(() => handler?.({}, undefined)).not.toThrow();
    });

    it('closeTab refuses to report "already closed" from a stale tab list missing the tab', async () => {
      // Seed a ws-stale cache WITHOUT tab-x, then go silent.
      mocks.sendToWorkspaceWindows.mockImplementation(
        (workspaceId: string, channel: string, payload: { requestId?: string }) => {
          if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DELIVERED;
          responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
            {},
            { tabs: [], requestId: payload.requestId },
          );
          return DELIVERED;
        },
      );
      await embeddedBrowserCdp.requestPanelBrowserTabs('ws-stale');

      mocks.sendToWorkspaceWindows.mockReturnValue(DELIVERED); // delivered, never answered
      vi.useFakeTimers();
      try {
        const pending = embeddedBrowserCdp.closeTab('tab-x', 'ws-stale');
        pending.catch(() => {}); // avoid unhandled rejection before assertion
        await vi.advanceTimersByTimeAsync(500);
        await expect(pending).rejects.toThrow(
          'Cannot close tab tab-x: the tab list for workspace ws-stale is unavailable (the renderer did not respond), so whether the tab exists cannot be determined.',
        );
        // The close request itself must never have been sent.
        const closeCalls = mocks.sendToWorkspaceWindows.mock.calls.filter(
          ([, channel]) => channel === IPC_CHANNELS.BROWSER.CLOSE_TAB,
        );
        expect(closeCalls).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('routes tab discovery and close through exact workspace-scoped channels and params', async () => {
    const responses = [
      [{ tabId: 'tab-1', url: 'https://example.test', title: 'Example' }],
      [],
      [],
      [],
    ];
    mocks.sendToWorkspaceWindows.mockImplementation(
      (workspaceId: string, channel: string, payload: { requestId?: string }) => {
        if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DELIVERED;
        const tabs = responses.shift() ?? [];
        responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
          {},
          {
            tabs,
            requestId: payload.requestId,
          },
        );
        return DELIVERED;
      },
    );

    await expect(embeddedBrowserCdp.closeTab('tab-1', 'ws-2')).resolves.toEqual({ tabId: 'tab-1' });

    const calls = mocks.sendToWorkspaceWindows.mock.calls;
    expect(calls[0]).toEqual([
      'ws-2',
      IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST,
      { requestId: expect.any(String), workspaceId: 'ws-2' },
    ]);
    expect(calls[1]).toEqual([
      'ws-2',
      IPC_CHANNELS.BROWSER.CLOSE_TAB,
      { tabId: 'tab-1', workspaceId: 'ws-2' },
    ]);
    expect(calls.slice(2)).toHaveLength(1);
    for (const [workspaceId, channel, payload] of calls.slice(2)) {
      expect(workspaceId).toBe('ws-2');
      expect(channel).toBe(IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST);
      expect(payload).toEqual({ requestId: expect.any(String), workspaceId: 'ws-2' });
    }
  });

  // Regression (monorepo#2857): a LIST_TABS_RESPONSE produced before the
  // renderer purged a deleted agent's tabs must not re-hydrate ownership or
  // re-enter the cache after clearAgentTabs tombstoned the agent.
  it('ignores stale list-tabs replies for agents whose tabs were cleared', async () => {
    const ownedTab = {
      tabId: 'tab-tomb',
      url: 'https://owned.test',
      title: 'Owned',
      ownerAgentId: 'agent-tomb',
    };
    // Seed ownership via a normal reply round-trip.
    mocks.sendToWorkspaceWindows.mockImplementation(
      (_ws: string, channel: string, payload: { requestId?: string }) => {
        if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DELIVERED;
        responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
          {},
          { tabs: [ownedTab], requestId: payload.requestId },
        );
        return DELIVERED;
      },
    );
    await embeddedBrowserCdp.requestPanelBrowserTabs('ws-tomb');
    expect(embeddedBrowserCdp.getTabOwner('tab-tomb')).toBe('agent-tomb');

    expect(embeddedBrowserCdp.clearAgentTabs('agent-tomb')).toEqual(['tab-tomb']);
    expect(embeddedBrowserCdp.getTabOwner('tab-tomb')).toBeUndefined();

    // A stale reply (same pre-purge tab list) arrives afterwards.
    await embeddedBrowserCdp.requestPanelBrowserTabs('ws-tomb');
    expect(embeddedBrowserCdp.getTabOwner('tab-tomb')).toBeUndefined();

    // The stale tab is filtered out of the resolved list and cache too.
    mocks.sendToWorkspaceWindows.mockReturnValue(DROPPED);
    await expect(embeddedBrowserCdp.requestPanelBrowserTabs('ws-tomb')).resolves.toEqual({
      tabs: [],
      stale: true,
    });
  });

  // listAgentOwnedTabs answers purely from main-process state (quit
  // confirmation must never block on a renderer round-trip).
  it('lists agent-owned tabs from the ownership registry without any renderer round-trip', async () => {
    const ownedTab = {
      tabId: 'tab-owned-quit',
      url: 'https://owned-quit.test',
      title: 'Owned quit tab',
      ownerAgentId: 'agent-quit',
    };
    // Seed ownership + cache via a normal reply round-trip.
    mocks.sendToWorkspaceWindows.mockImplementation(
      (_ws: string, channel: string, payload: { requestId?: string }) => {
        if (channel !== IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) return DELIVERED;
        responseHandlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
          {},
          { tabs: [ownedTab], requestId: payload.requestId },
        );
        return DELIVERED;
      },
    );
    await embeddedBrowserCdp.requestPanelBrowserTabs('ws-quit');
    // An owned tab the cache has never seen still appears, without enrichment.
    embeddedBrowserCdp.setTabOwner('tab-bare-quit', 'agent-quit-2');

    mocks.sendToWorkspaceWindows.mockClear();
    const tabs = embeddedBrowserCdp.listAgentOwnedTabs();

    expect(mocks.sendToWorkspaceWindows).not.toHaveBeenCalled();
    expect(tabs).toEqual(
      expect.arrayContaining([
        {
          tabId: 'tab-owned-quit',
          ownerAgentId: 'agent-quit',
          title: 'Owned quit tab',
          url: 'https://owned-quit.test',
          workspaceId: 'ws-quit',
        },
        { tabId: 'tab-bare-quit', ownerAgentId: 'agent-quit-2' },
      ]),
    );
    // Cleanup so this suite's shared singleton does not leak into others.
    embeddedBrowserCdp.clearAgentTabs('agent-quit');
    embeddedBrowserCdp.clearAgentTabs('agent-quit-2');
  });

  // Regression (monorepo#3366): on a guest whose compositor produces no
  // frames, both the CDP Page-domain commands AND the capturePage()
  // fallback hang forever. The fallback must be bounded so screenshot
  // fails fast with a clear error instead of eating the caller's whole
  // 30s reverse-request budget.
  describe('screenshot capturePage fallback (monorepo#3366)', () => {
    function capturedImage(width = 1280, height = 800, bytes = 'jpeg-bytes') {
      return {
        isEmpty: () => false,
        getSize: () => ({ width, height }),
        toJPEG: () => Buffer.from(bytes),
      };
    }

    function screenshotWebContents(overrides: Record<string, unknown> = {}) {
      const wc = {
        isDestroyed: () => false,
        once: vi.fn(),
        debugger: {
          isAttached: () => true,
          // Page domain hangs (never settles) — forces the CDP timeouts.
          sendCommand: vi.fn(() => new Promise(() => {})),
          on: vi.fn(),
        },
        capturePage: vi.fn(() => new Promise(() => {})),
        ...overrides,
      };
      mocks.fromId.mockReturnValue(wc);
      return wc;
    }

    it('bounds the capturePage fallback instead of hanging when the guest is not painting', async () => {
      vi.useFakeTimers();
      try {
        const wc = screenshotWebContents();
        embeddedBrowserCdp.registerTab('tab-shot-hang', 401);

        const pending = embeddedBrowserCdp.screenshot('tab-shot-hang');
        const guarded = pending.catch((error: Error) => error);
        // CDP Page.getLayoutMetrics timeout (5s) → fallback capturePage
        // timeout (5s): total stays far below the 30s caller budget.
        await vi.advanceTimersByTimeAsync(5_000);
        await vi.advanceTimersByTimeAsync(5_000);
        const error = await guarded;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('capturePage timed out');
        expect(wc.capturePage).toHaveBeenCalledWith(undefined, {
          stayHidden: true,
          stayAwake: true,
        });
      } finally {
        vi.useRealTimers();
        embeddedBrowserCdp.unregisterTab('tab-shot-hang');
      }
    });

    it('returns the capturePage image when the fallback settles in time', async () => {
      const image = capturedImage();
      const wc = screenshotWebContents({ capturePage: vi.fn().mockResolvedValue(image) });
      embeddedBrowserCdp.registerTab('tab-shot-ok', 402);
      vi.useFakeTimers();
      try {
        const pending = embeddedBrowserCdp.screenshot('tab-shot-ok');
        // Only the CDP path times out; the fallback resolves immediately.
        await vi.advanceTimersByTimeAsync(5_000);
        await expect(pending).resolves.toEqual({
          base64: Buffer.from('jpeg-bytes').toString('base64'),
          width: 1280,
          height: 800,
        });
        expect(wc.capturePage).toHaveBeenCalledWith(undefined, {
          stayHidden: true,
          stayAwake: true,
        });
      } finally {
        vi.useRealTimers();
        embeddedBrowserCdp.unregisterTab('tab-shot-ok');
      }
    });

    it('falls back when CDP reports a zero-sized layout viewport', async () => {
      const image = capturedImage(640, 480);
      const wc = screenshotWebContents({ capturePage: vi.fn().mockResolvedValue(image) });
      wc.debugger.sendCommand.mockResolvedValue({
        layoutViewport: { clientWidth: 0, clientHeight: 0 },
      });
      embeddedBrowserCdp.registerTab('tab-shot-zero-viewport', 403);

      try {
        await expect(embeddedBrowserCdp.screenshot('tab-shot-zero-viewport')).resolves.toEqual({
          base64: Buffer.from('jpeg-bytes').toString('base64'),
          width: 640,
          height: 480,
        });
        expect(wc.debugger.sendCommand).not.toHaveBeenCalledWith(
          'Page.captureScreenshot',
          expect.anything(),
        );
        expect(wc.capturePage).toHaveBeenCalledOnce();
      } finally {
        embeddedBrowserCdp.unregisterTab('tab-shot-zero-viewport');
      }
    });

    it('falls back when Page.captureScreenshot returns empty data', async () => {
      const image = capturedImage(800, 600);
      const wc = screenshotWebContents({ capturePage: vi.fn().mockResolvedValue(image) });
      wc.debugger.sendCommand.mockImplementation((method: string) => {
        if (method === 'Page.getLayoutMetrics') {
          return Promise.resolve({ layoutViewport: { clientWidth: 800, clientHeight: 600 } });
        }
        return Promise.resolve({ data: '' });
      });
      embeddedBrowserCdp.registerTab('tab-shot-empty-cdp', 404);

      try {
        await expect(embeddedBrowserCdp.screenshot('tab-shot-empty-cdp')).resolves.toEqual({
          base64: Buffer.from('jpeg-bytes').toString('base64'),
          width: 800,
          height: 600,
        });
        expect(wc.capturePage).toHaveBeenCalledOnce();
      } finally {
        embeddedBrowserCdp.unregisterTab('tab-shot-empty-cdp');
      }
    });

    it('rejects when the capturePage fallback returns an empty NativeImage', async () => {
      const image = {
        isEmpty: () => true,
        getSize: () => ({ width: 0, height: 0 }),
        toJPEG: vi.fn(() => Buffer.alloc(0)),
      };
      const wc = screenshotWebContents({ capturePage: vi.fn().mockResolvedValue(image) });
      wc.debugger.sendCommand.mockResolvedValue({
        layoutViewport: { clientWidth: 0, clientHeight: 0 },
      });
      embeddedBrowserCdp.registerTab('tab-shot-empty-fallback', 405);

      try {
        await expect(embeddedBrowserCdp.screenshot('tab-shot-empty-fallback')).rejects.toThrow(
          'Electron fallback stage: webContents.capturePage returned an empty image (0x0)',
        );
        expect(image.toJPEG).not.toHaveBeenCalled();
      } finally {
        embeddedBrowserCdp.unregisterTab('tab-shot-empty-fallback');
      }
    });
  });
});
