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
    await embeddedBrowserCdp.requestPanelBrowserTabs('ws-cache');

    vi.useFakeTimers();
    try {
      mocks.sendToWorkspaceWindows.mockReturnValue(DROPPED);
      // Resolves from the cache immediately — no timer advancement — instead
      // of burning the 500 ms reply timeout.
      const tabs = await embeddedBrowserCdp.requestPanelBrowserTabs('ws-cache');
      expect(tabs).toEqual([{ tabId: 'tab-cached', url: 'https://cached.test', title: 'Cached' }]);

      // The fallback only consults the SAME workspace's cache entry.
      const otherTabs = await embeddedBrowserCdp.requestPanelBrowserTabs('ws-other');
      expect(otherTabs).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
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
