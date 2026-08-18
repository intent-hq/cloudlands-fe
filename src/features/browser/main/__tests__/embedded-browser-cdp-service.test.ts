import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  sendToWorkspaceWindows: vi.fn(),
  fromId: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  webContents: { fromId: mocks.fromId },
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
});
