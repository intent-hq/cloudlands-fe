/**
 * Regression tests for the listTabs/closeTab registry disagreement
 * (intent-hq/monorepo#2536).
 *
 * listAllTabs() used to append any live webview missing from the panel
 * layout as a `mounted: true` entry ("shouldn't happen, but be safe").
 * A tab closed in the UI keeps its webview alive briefly (panel cache /
 * teardown timing), so it kept being listed while closeTab() — which
 * validates against the panel layout — rejected it as not found.
 * The panel layout is now the single source of truth for listing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ANY_HOST } from '../../system/main/window-workspace-tracking';

const mocks = vi.hoisted(() => ({
  sendToWorkspaceWindows: vi.fn(),
  getAllWebContents: vi.fn(() => [] as unknown[]),
  fromId: vi.fn<(id: number) => unknown>(() => undefined),
  handlers: new Map<string, (event: unknown, data: unknown) => unknown>(),
}));

vi.mock('electron', () => ({
  __esModule: true,
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, data: unknown) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  webContents: {
    getAllWebContents: mocks.getAllWebContents,
    fromId: mocks.fromId,
  },
  default: {},
}));

vi.mock('../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: mocks.sendToWorkspaceWindows,
}));

import { IPC_CHANNELS } from '../../../shared/ipc-registry';

const JPEG_1PX =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=';

type PanelTab = {
  tabId: string;
  url: string;
  requestedUrl?: string;
  title: string;
  closable?: boolean;
  ownerAgentId?: string;
  hidden?: boolean;
  emulatedSize?: { width: number; height: number };
  viewport?:
    | { mode: 'fit' }
    | { mode: 'preset'; presetId: string; width: number; height: number }
    | { mode: 'custom'; width: number; height: number };
};

/** Fake live webview backing a mounted tab. */
function fakeWebview(id: number, url: string) {
  return {
    id,
    getType: () => 'webview',
    isDestroyed: () => false,
    getURL: () => url,
    getTitle: () => `title-${id}`,
    once: vi.fn(),
  };
}

/**
 * Fake webview with a working debugger session and capturePage(), for the
 * screenshot CDP-hang fallback tests (intent-hq/monorepo#3154).
 * `sendCommand` routes each CDP method through `cdpResponses`; a method
 * mapped to 'hang' returns a promise that never settles.
 */
function fakeCdpWebview(
  id: number,
  cdpResponses: Record<string, unknown | 'hang' | Error>,
  capturePageImage: { width: number; height: number } | 'hang' = { width: 320, height: 240 },
) {
  const sendCommand = vi.fn((method: string) => {
    const response = cdpResponses[method];
    if (response === 'hang') return new Promise(() => {});
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve(response);
  });
  const capturePage = vi.fn(async () => {
    if (capturePageImage === 'hang') return new Promise<never>(() => {});
    return {
      getSize: () => capturePageImage,
      toJPEG: () => Buffer.from(JPEG_1PX, 'base64'),
    };
  });
  return {
    ...fakeWebview(id, 'http://cdp/'),
    debugger: {
      isAttached: () => true,
      attach: vi.fn(),
      on: vi.fn(),
      sendCommand,
    },
    capturePage,
  };
}

/**
 * Wire the renderer side: whenever the service broadcasts LIST_TABS_REQUEST,
 * reply through the captured LIST_TABS_RESPONSE handler with the current
 * panel layout; CLOSE_TAB removes the tab from the layout (UI close path).
 */
const DELIVERED = { windowCount: 1, browserClientsNotified: false, delivered: true };

function wireRenderer(panelTabs: PanelTab[], respondForWorkspaceId?: string) {
  mocks.sendToWorkspaceWindows.mockImplementation(
    (
      workspaceId: string | undefined,
      channel: string,
      payload: { requestId?: string; tabId?: string },
    ) => {
      // A non-matching workspace still "delivers" (some window has it open);
      // its renderer just never answers this fake's panel layout.
      if (respondForWorkspaceId !== undefined && workspaceId !== respondForWorkspaceId) {
        return DELIVERED;
      }
      if (channel === IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) {
        const respond = mocks.handlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE);
        respond?.({}, { tabs: [...panelTabs], requestId: payload.requestId });
      } else if (channel === IPC_CHANNELS.BROWSER.CLOSE_TAB && payload.tabId) {
        const idx = panelTabs.findIndex((t) => t.tabId === payload.tabId);
        if (idx >= 0 && panelTabs[idx].closable !== false) panelTabs.splice(idx, 1);
      }
      return DELIVERED;
    },
  );
}

async function loadService() {
  const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
  return embeddedBrowserCdp;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.getAllWebContents.mockReturnValue([]);
  mocks.fromId.mockImplementation((id) =>
    mocks.getAllWebContents().find((wc) => (wc as { id: number }).id === id),
  );
  mocks.sendToWorkspaceWindows.mockReturnValue(DELIVERED);
});

describe('focusTab', () => {
  it('forwards explicit pin intent with the exact tab focus request', async () => {
    const service = await loadService();
    mocks.fromId.mockReturnValue(fakeWebview(42, 'http://a/'));
    service.registerTab('tab-1', 42);

    await expect(service.focusTab('tab-1', 'ws-1', true)).resolves.toBe(true);
    expect(mocks.sendToWorkspaceWindows).toHaveBeenCalledWith(
      'ws-1',
      IPC_CHANNELS.BROWSER.FOCUS_TAB,
      { tabId: 'tab-1', workspaceId: 'ws-1', pin: true },
      ANY_HOST,
    );
    service.unregisterTab('tab-1');
  });
});

describe('openDevToolsPanel', () => {
  it('opens DevTools and selects the requested built-in panel', async () => {
    const service = await loadService();
    const executeJavaScript = vi.fn().mockResolvedValue(undefined);
    const wc = {
      ...fakeWebview(43, 'http://a/'),
      openDevTools: vi.fn(),
      devToolsWebContents: {
        isDestroyed: () => false,
        executeJavaScript,
      },
    };
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-devtools', 43);

    await service.openDevToolsPanel('tab-devtools', 'console');

    expect(wc.openDevTools).toHaveBeenCalledTimes(1);
    expect(executeJavaScript).toHaveBeenCalledWith('DevToolsAPI.showPanel("console")');
    service.unregisterTab('tab-devtools');
  });
});

describe('listAllTabs vs closeTab registry agreement (#2536)', () => {
  it('carries explicit recovery intent on the correlated local IPC request only', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-a', url: 'http://a/', title: 'A' }]);
    await service.listAllTabs('ws-1', 'tab-a');
    expect(mocks.sendToWorkspaceWindows).toHaveBeenCalledExactlyOnceWith(
      'ws-1',
      IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST,
      {
        workspaceId: 'ws-1',
        requestId: expect.any(String),
        recoverTabId: 'tab-a',
      },
      ANY_HOST,
    );
    mocks.sendToWorkspaceWindows.mockClear();
    await service.listAllTabs('ws-1');
    expect(mocks.sendToWorkspaceWindows).toHaveBeenCalledExactlyOnceWith(
      'ws-1',
      IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST,
      {
        workspaceId: 'ws-1',
        requestId: expect.any(String),
      },
      ANY_HOST,
    );
  });

  it('rejects a late dead registration without replacing the current live guest', async () => {
    const service = await loadService();
    const live = fakeWebview(11, 'http://a/');
    mocks.getAllWebContents.mockReturnValue([live]);
    service.registerTab('tab-a', 11);
    service.registerTab('tab-a', 10);
    expect(service.isTabMounted('tab-a')).toBe(true);
    expect(service.listTabs()).toEqual([
      expect.objectContaining({ tabId: 'tab-a', webContentsId: 11 }),
    ]);
  });

  it('does not resolve a registration waiter with an already-dead guest', async () => {
    vi.useFakeTimers();
    try {
      const service = await loadService();
      const waiter = service.waitForTabRegistration('tab-dead', 1000);
      mocks.fromId.mockReturnValue({ isDestroyed: () => true });
      service.registerTab('tab-dead', 10);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(waiter).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('excludes a UI-closed tab whose webview is still alive', async () => {
    const service = await loadService();
    // tab-closed was closed in the UI: gone from the panel layout, but its
    // webview has not been torn down yet.
    wireRenderer([{ tabId: 'tab-open', url: 'http://a/', title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([
      fakeWebview(11, 'http://a/'),
      fakeWebview(12, 'http://stale/'),
    ]);
    service.registerTab('tab-open', 11);
    service.registerTab('tab-closed', 12);

    const { tabs, stale } = await service.listAllTabs('ws-1');

    expect(stale).toBe(false);
    expect(tabs.map((t) => t.tabId)).toEqual(['tab-open']);
    expect(tabs[0]).toMatchObject({ tabId: 'tab-open', webContentsId: 11, mounted: true });
  });

  it('flags panel tabs without a live webview as unmounted', async () => {
    const service = await loadService();
    wireRenderer([
      { tabId: 'tab-mounted', url: 'http://a/', title: 'A' },
      { tabId: 'tab-unmounted', url: 'http://b/', title: 'B' },
    ]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(21, 'http://a/')]);
    service.registerTab('tab-mounted', 21);

    const { tabs } = await service.listAllTabs('ws-1');

    expect(tabs).toHaveLength(2);
    expect(tabs.find((t) => t.tabId === 'tab-mounted')).toMatchObject({ mounted: true });
    expect(tabs.find((t) => t.tabId === 'tab-unmounted')).toMatchObject({
      mounted: false,
      webContentsId: -1,
    });
  });

  it('never reports "not found" when closing every listed tab', async () => {
    const service = await loadService();
    const panel: PanelTab[] = [
      { tabId: 'tab-1', url: 'http://a/', title: 'A' },
      { tabId: 'tab-2', url: 'http://b/', title: 'B' },
    ];
    wireRenderer(panel);
    // tab-ghost: UI-closed tab with a lingering webview — must not be listed.
    mocks.getAllWebContents.mockReturnValue([
      fakeWebview(31, 'http://a/'),
      fakeWebview(33, 'http://ghost/'),
    ]);
    service.registerTab('tab-1', 31);
    service.registerTab('tab-ghost', 33);

    const { tabs: listed } = await service.listAllTabs('ws-1');
    expect(listed.map((t) => t.tabId).sort()).toEqual(['tab-1', 'tab-2']);

    for (const tab of listed) {
      await expect(service.closeTab(tab.tabId, 'ws-1')).resolves.toEqual({ tabId: tab.tabId });
    }
    expect(await service.listAllTabs('ws-1')).toEqual({ tabs: [], stale: false });
  });

  it("does not fall back to another workspace's tabs when a list request times out", async () => {
    const service = await loadService();
    // Only ws-a's layout answers list requests; ws-b never responds.
    wireRenderer([{ tabId: 'tab-a', url: 'http://a/', title: 'A' }], 'ws-a');

    // Populate the cache with ws-a's tab list.
    expect((await service.listAllTabs('ws-a')).tabs.map((t) => t.tabId)).toEqual(['tab-a']);

    // ws-b's request gets no reply and times out; the fallback must not
    // serve ws-a's cached tabs (which closeTab(..., 'ws-b') would reject) —
    // and with no ws-b cache it must reject, not fabricate an empty list
    // (monorepo#2756 RC4).
    vi.useFakeTimers();
    try {
      const pending = service.listAllTabs('ws-b');
      pending.catch(() => {}); // avoid unhandled rejection before assertion
      await vi.advanceTimersByTimeAsync(600);
      await expect(pending).rejects.toThrow(
        'Tab list for workspace ws-b is unavailable: the renderer did not respond and no cached tab list exists.',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('tab list right after a background-hosting adoption', () => {
  // A window that was just asked to host a workspace no window had open
  // replies only after a cold layout hydration; the usual short reply
  // window would answer "unavailable" before the adopted window could.
  function deferredRenderer(): { reply: (tabs: PanelTab[]) => void } {
    let lastRequestId: string | undefined;
    mocks.sendToWorkspaceWindows.mockImplementation(
      (_ws: string | undefined, channel: string, payload: { requestId?: string }) => {
        if (channel === IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) lastRequestId = payload.requestId;
        return DELIVERED;
      },
    );
    return {
      reply: (tabs) =>
        mocks.handlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
          {},
          { tabs, requestId: lastRequestId },
        ),
    };
  }

  it('waits for the adopted window to finish hydrating instead of timing out', async () => {
    const service = await loadService();
    const renderer = deferredRenderer();
    vi.useFakeTimers();
    try {
      service.noteWorkspaceAdopted('ws-closed');
      const pending = service.listAllTabs('ws-closed');
      await vi.advanceTimersByTimeAsync(2_000);
      renderer.reply([{ tabId: 'tab-agent', url: 'http://sandbox/', title: 'S', hidden: true }]);
      await expect(pending).resolves.toMatchObject({
        stale: false,
        tabs: [{ tabId: 'tab-agent', mounted: false, hidden: true }],
      });

      // Once the adopted window has answered, later requests use the usual window.
      const later = service.listAllTabs('ws-closed');
      await vi.advanceTimersByTimeAsync(600);
      await expect(later).resolves.toMatchObject({ stale: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the longer window within half of the caller deadline', async () => {
    const service = await loadService();
    deferredRenderer();
    vi.useFakeTimers();
    try {
      service.noteWorkspaceAdopted('ws-closed');
      const pending = service.listAllTabs('ws-closed', undefined, {
        deadline: Date.now() + 4_000,
      });
      pending.catch(() => {});
      await vi.advanceTimersByTimeAsync(2_100);
      await expect(pending).rejects.toThrow('Tab list for workspace ws-closed is unavailable');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still gives up within the longer window when the adopted window never answers', async () => {
    const service = await loadService();
    deferredRenderer();
    vi.useFakeTimers();
    try {
      service.noteWorkspaceAdopted('ws-closed');
      const pending = service.listAllTabs('ws-closed');
      pending.catch(() => {});
      await vi.advanceTimersByTimeAsync(5_100);
      await expect(pending).rejects.toThrow('Tab list for workspace ws-closed is unavailable');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('findModelTabByExactUrl (#2541, per-agent #2857)', () => {
  const URL_A = 'http://localhost:3000/board';

  it('returns a tab this agent owns on the exact URL', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-a', url: URL_A, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(41, URL_A)]);
    service.registerTab('tab-a', 41);
    service.setTabOwner('tab-a', 'agent-1');

    await expect(service.findModelTabByExactUrl(URL_A, 'agent-1', 'ws-1')).resolves.toBe('tab-a');
  });

  it('never returns a user-opened tab (no ownership entry)', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-user', url: URL_A, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(42, URL_A)]);
    service.registerTab('tab-user', 42);

    await expect(service.findModelTabByExactUrl(URL_A, 'agent-1', 'ws-1')).resolves.toBeUndefined();
  });

  it("never returns another agent's tab — dedupe is strictly per-agent (#2857)", async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-other', url: URL_A, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(43, URL_A)]);
    service.registerTab('tab-other', 43);
    service.setTabOwner('tab-other', 'agent-2');

    await expect(service.findModelTabByExactUrl(URL_A, 'agent-1', 'ws-1')).resolves.toBeUndefined();
    // Ownership never expires: the same lookup much later still refuses.
    await expect(service.findModelTabByExactUrl(URL_A, 'agent-1', 'ws-1')).resolves.toBeUndefined();
    expect(service.getTabOwner('tab-other')).toBe('agent-2');
  });

  it('matches by exact string equality only — no URL normalization', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-slash', url: `${URL_A}/`, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(45, `${URL_A}/`)]);
    service.registerTab('tab-slash', 45);
    service.setTabOwner('tab-slash', 'agent-1');

    await expect(service.findModelTabByExactUrl(URL_A, 'agent-1', 'ws-1')).resolves.toBeUndefined();
    await expect(service.findModelTabByExactUrl(`${URL_A}/`, 'agent-1', 'ws-1')).resolves.toBe(
      'tab-slash',
    );
  });

  it("never returns a matching tab from another workspace's panel layout", async () => {
    const service = await loadService();
    // The requesting workspace's layout has no tab on URL_A; the live
    // webview belongs to a different workspace's layout.
    wireRenderer([]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(46, URL_A)]);
    service.registerTab('tab-elsewhere', 46);
    service.setTabOwner('tab-elsewhere', 'agent-1');

    await expect(service.findModelTabByExactUrl(URL_A, 'agent-1', 'ws-1')).resolves.toBeUndefined();
  });
});

describe('findModelTabByRequestedUrl (#2787, per-agent #2857)', () => {
  const REQUESTED = 'http://127.0.0.1:5190/';
  const TUNNELED_OLD = 'http://127.0.0.1:55001/';

  it('returns a tab whose ownership recorded the requested URL even when its live URL differs', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-a', url: TUNNELED_OLD, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(51, TUNNELED_OLD)]);
    service.registerTab('tab-a', 51);
    service.setTabOwner('tab-a', 'agent-1', REQUESTED);

    await expect(service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1')).resolves.toBe(
      'tab-a',
    );
  });

  it('never returns a user-opened tab (no ownership entry)', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-user', url: TUNNELED_OLD, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(52, TUNNELED_OLD)]);
    service.registerTab('tab-user', 52);

    await expect(
      service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1'),
    ).resolves.toBeUndefined();
  });

  it('returns undefined for ownership records without a requested URL', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-plain', url: TUNNELED_OLD, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(53, TUNNELED_OLD)]);
    service.registerTab('tab-plain', 53);
    service.setTabOwner('tab-plain', 'agent-1');

    await expect(
      service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1'),
    ).resolves.toBeUndefined();
  });

  it("never returns another agent's tab — dedupe is strictly per-agent (#2857)", async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-other', url: TUNNELED_OLD, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(54, TUNNELED_OLD)]);
    service.registerTab('tab-other', 54);
    service.setTabOwner('tab-other', 'agent-2', REQUESTED);

    await expect(
      service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1'),
    ).resolves.toBeUndefined();
  });

  it('a setTabOwner refresh without requestedUrl preserves the recorded requested URL', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-a', url: TUNNELED_OLD, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(56, TUNNELED_OLD)]);
    service.registerTab('tab-a', 56);
    service.setTabOwner('tab-a', 'agent-1', REQUESTED);
    service.setTabOwner('tab-a', 'agent-1'); // e.g. a later plain refresh

    await expect(service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1')).resolves.toBe(
      'tab-a',
    );
  });

  it('setTabOwner with null clears the recorded requested URL (tab repurposed)', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-a', url: TUNNELED_OLD, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(58, TUNNELED_OLD)]);
    service.registerTab('tab-a', 58);
    service.setTabOwner('tab-a', 'agent-1', REQUESTED);
    service.setTabOwner('tab-a', 'agent-1', null); // repurposed for a non-tunneled open

    await expect(
      service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1'),
    ).resolves.toBeUndefined();
  });

  it("never returns a matching tab from another workspace's panel layout", async () => {
    const service = await loadService();
    wireRenderer([]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(57, TUNNELED_OLD)]);
    service.registerTab('tab-elsewhere', 57);
    service.setTabOwner('tab-elsewhere', 'agent-1', REQUESTED);

    await expect(
      service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1'),
    ).resolves.toBeUndefined();
  });
});

describe('viewport emulation modes', () => {
  it('emulates an owned visible fit tab at its reported bounds with scale 1', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(60, {});
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-fit-visible', 60);
    service.setTabOwner('tab-fit-visible', 'agent-1');
    service.reportTabViewBounds('tab-fit-visible', 640, 420);

    await vi.waitFor(() => {
      expect(wc.debugger.sendCommand).toHaveBeenLastCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ width: 640, height: 420, scale: 1 }),
      );
    });
    expect(service.getTabEffectiveViewportSize('tab-fit-visible')).toEqual({
      width: 640,
      height: 420,
    });
  });

  it('uses the default fallback for an owned hidden fit tab', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(61, {});
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-fit-hidden', 61);
    service.setTabOwner('tab-fit-hidden', 'agent-1');

    await vi.waitFor(() => {
      expect(wc.debugger.sendCommand).toHaveBeenLastCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ width: 1280, height: 800, scale: 1 }),
      );
    });
  });

  it('scales a preset down when it is larger than the panel', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(62, {});
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-preset-large', 62);
    service.setTabViewport('tab-preset-large', {
      mode: 'preset',
      presetId: 'large',
      width: 800,
      height: 600,
    });
    service.reportTabViewBounds('tab-preset-large', 400, 300);

    await vi.waitFor(() => {
      expect(wc.debugger.sendCommand).toHaveBeenLastCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ width: 800, height: 600, scale: 0.5 }),
      );
    });
  });

  it('does not upscale a preset smaller than the panel', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(63, {});
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-preset-small', 63);
    service.reportTabViewBounds('tab-preset-small', 800, 600);
    service.setTabViewport('tab-preset-small', {
      mode: 'preset',
      presetId: 'small',
      width: 400,
      height: 300,
    });

    await vi.waitFor(() => {
      expect(wc.debugger.sendCommand).toHaveBeenLastCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ width: 400, height: 300, scale: 1 }),
      );
    });
  });

  it('updates an owned tab retained size from a renderer-selected fixed viewport', async () => {
    const service = await loadService();
    service.setTabOwner('tab-owned-preset', 'agent-1', undefined, {
      width: 1280,
      height: 800,
    });

    service.setTabViewport('tab-owned-preset', {
      mode: 'preset',
      presetId: 'iphone-se',
      width: 375,
      height: 667,
    });

    expect(service.getTabEmulatedSize('tab-owned-preset')).toEqual({ width: 375, height: 667 });
    expect(service.resizeTab('tab-owned-preset', 390)).toEqual({ width: 390, height: 667 });
  });

  it('keeps an owned tab retained size when switching to fit mode', async () => {
    const service = await loadService();
    service.setTabOwner('tab-owned-fit', 'agent-1', undefined, { width: 1024, height: 768 });

    service.setTabViewport('tab-owned-fit', { mode: 'fit' });

    expect(service.getTabEmulatedSize('tab-owned-fit')).toEqual({ width: 1024, height: 768 });
  });

  it('does not attach the debugger for a plain unowned fit tab', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(64, {});
    wc.debugger.isAttached = () => false;
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-user-fit', 64);
    service.setTabViewport('tab-user-fit', { mode: 'fit' });

    expect(wc.debugger.attach).not.toHaveBeenCalled();
    expect(wc.debugger.sendCommand).not.toHaveBeenCalled();
    expect(service.getTabEffectiveViewportSize('tab-user-fit')).toBeUndefined();
  });

  it('clears device metrics after an unowned tab returns from preset to fit', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(66, {});
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-user-preset', 66);
    service.setTabViewport('tab-user-preset', {
      mode: 'preset',
      presetId: 'small',
      width: 400,
      height: 300,
    });
    await vi.waitFor(() =>
      expect(wc.debugger.sendCommand).toHaveBeenCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.any(Object),
      ),
    );

    service.setTabViewport('tab-user-preset', { mode: 'fit' });

    await vi.waitFor(() =>
      expect(wc.debugger.sendCommand).toHaveBeenLastCalledWith(
        'Emulation.clearDeviceMetricsOverride',
        undefined,
      ),
    );
  });

  it('waits for an in-flight device metrics override before clearing it', async () => {
    let resolveOverride!: () => void;
    const override = new Promise<void>((resolve) => {
      resolveOverride = resolve;
    });
    const service = await loadService();
    const wc = fakeCdpWebview(67, {
      'Emulation.setDeviceMetricsOverride': override,
    });
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-user-in-flight', 67);
    service.setTabViewport('tab-user-in-flight', {
      mode: 'preset',
      presetId: 'small',
      width: 400,
      height: 300,
    });
    await vi.waitFor(() =>
      expect(wc.debugger.sendCommand).toHaveBeenCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.any(Object),
      ),
    );

    service.setTabViewport('tab-user-in-flight', { mode: 'fit' });
    expect(wc.debugger.sendCommand).not.toHaveBeenCalledWith(
      'Emulation.clearDeviceMetricsOverride',
      undefined,
    );

    resolveOverride();
    await vi.waitFor(() =>
      expect(wc.debugger.sendCommand).toHaveBeenLastCalledWith(
        'Emulation.clearDeviceMetricsOverride',
        undefined,
      ),
    );
  });

  it('rehydrates a legacy owned tab into fit mode', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(65, {});
    mocks.fromId.mockReturnValue(wc);
    mocks.getAllWebContents.mockReturnValue([wc]);
    service.registerTab('tab-rehydrated-fit', 65);
    wireRenderer([
      {
        tabId: 'tab-rehydrated-fit',
        url: 'http://a/',
        title: 'A',
        ownerAgentId: 'agent-1',
      },
    ]);
    await service.listAllTabs('ws-1');
    service.reportTabViewBounds('tab-rehydrated-fit', 700, 500);

    await vi.waitFor(() => {
      expect(wc.debugger.sendCommand).toHaveBeenLastCalledWith(
        'Emulation.setDeviceMetricsOverride',
        expect.objectContaining({ width: 700, height: 500, scale: 1 }),
      );
    });
  });
});

describe('tab ownership registry (#2857)', () => {
  it('claimTab: first claim wins, second claimant gets already-claimed with the owner id', async () => {
    const service = await loadService();
    const size = { width: 1280, height: 800 };

    expect(service.claimTab('tab-1', 'agent-1', size)).toEqual({
      status: 'claimed',
      alreadyOwned: false,
    });
    expect(service.claimTab('tab-1', 'agent-2', size)).toEqual({
      status: 'already-claimed',
      ownerAgentId: 'agent-1',
    });
    expect(service.getTabOwner('tab-1')).toBe('agent-1');
  });

  it('claimTab: two synchronous claimants can never both succeed (atomic check-and-set)', async () => {
    const service = await loadService();
    const size = { width: 1024, height: 768 };
    const results = [
      service.claimTab('tab-race', 'agent-a', size),
      service.claimTab('tab-race', 'agent-b', size),
    ];
    const claimed = results.filter((r) => r.status === 'claimed');
    const rejected = results.filter((r) => r.status === 'already-claimed');
    expect(claimed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(service.getTabOwner('tab-race')).toBe('agent-a');
  });

  it('claimTab: the current owner re-claiming its own tab is an idempotent success', async () => {
    const service = await loadService();
    service.claimTab('tab-own', 'agent-1', { width: 1280, height: 800 });

    expect(service.claimTab('tab-own', 'agent-1', { width: 800, height: 600 })).toEqual({
      status: 'claimed',
      alreadyOwned: true,
    });
    // The re-claim updates the emulated size.
    expect(service.getTabEmulatedSize('tab-own')).toEqual({ width: 800, height: 600 });
  });

  it('ownership survives unregisterTab (unmount) and ends on clearTabOwnership (close)', async () => {
    const service = await loadService();
    mocks.fromId.mockReturnValue(fakeWebview(61, 'http://a/'));
    service.registerTab('tab-1', 61);
    service.setTabOwner('tab-1', 'agent-1');

    service.unregisterTab('tab-1'); // unmount, not a close
    expect(service.getTabOwner('tab-1')).toBe('agent-1');

    service.clearTabOwnership('tab-1'); // confirmed close
    expect(service.getTabOwner('tab-1')).toBeUndefined();
  });

  it('closeTab clears the ownership record', async () => {
    const service = await loadService();
    const panel: PanelTab[] = [{ tabId: 'tab-1', url: 'http://a/', title: 'A' }];
    wireRenderer(panel);
    service.setTabOwner('tab-1', 'agent-1');

    await service.closeTab('tab-1', 'ws-1');
    expect(service.getTabOwner('tab-1')).toBeUndefined();
  });

  it('rehydrates persisted ownership from the panel-layout tab list (restart)', async () => {
    const service = await loadService();
    const requestedVisible = 'http://daemon.localhost:3000/';
    const requestedHidden = 'http://daemon.localhost:4000/';
    wireRenderer([
      {
        tabId: 'tab-owned',
        url: 'http://a/',
        requestedUrl: requestedVisible,
        title: 'A',
        ownerAgentId: 'agent-1',
      },
      {
        tabId: 'tab-hidden',
        url: 'http://h/',
        requestedUrl: requestedHidden,
        title: 'Hidden',
        ownerAgentId: 'agent-1',
        hidden: true,
      },
      { tabId: 'tab-legacy', url: 'http://legacy/', title: 'Legacy', ownerAgentId: 'agent-1' },
      { tabId: 'tab-user', url: 'http://b/', title: 'B' },
    ]);
    mocks.getAllWebContents.mockReturnValue([
      fakeWebview(62, 'http://a/'),
      fakeWebview(63, 'http://h/'),
    ]);
    service.registerTab('tab-owned', 62);
    service.registerTab('tab-hidden', 63);

    // Fresh service: the in-memory registry knows nothing until a tab list
    // reply crosses the IPC boundary.
    expect(service.getTabOwner('tab-owned')).toBeUndefined();
    const { tabs } = await service.listAllTabs('ws-1');
    expect(tabs.find((tab) => tab.tabId === 'tab-owned')).toMatchObject({
      requestedUrl: requestedVisible,
    });
    expect(tabs.find((tab) => tab.tabId === 'tab-hidden')).toMatchObject({
      requestedUrl: requestedHidden,
      hidden: true,
    });
    expect(tabs.find((tab) => tab.tabId === 'tab-legacy')).not.toHaveProperty('requestedUrl');
    await expect(
      service.findModelTabByRequestedUrl(requestedVisible, 'agent-1', 'ws-1'),
    ).resolves.toBe('tab-owned');
    await expect(
      service.findModelTabByRequestedUrl(requestedHidden, 'agent-1', 'ws-1'),
    ).resolves.toBe('tab-hidden');
    await expect(service.resolveTabOwner('tab-user', 'ws-1')).resolves.toBeUndefined();
    // No persisted size (pre-size layout): the default viewport applies.
    expect(service.getTabEmulatedSize('tab-owned')).toEqual({ width: 1280, height: 800 });
  });

  it('rehydrates the persisted emulated size instead of the default viewport (restart)', async () => {
    const service = await loadService();
    wireRenderer([
      {
        tabId: 'tab-sized',
        url: 'http://a/',
        title: 'A',
        ownerAgentId: 'agent-1',
        emulatedSize: { width: 390, height: 844 },
      },
    ]);

    await expect(service.resolveTabOwner('tab-sized', 'ws-1')).resolves.toBe('agent-1');
    expect(service.getTabEmulatedSize('tab-sized')).toEqual({ width: 390, height: 844 });
  });

  it('rehydration clamps an out-of-bounds persisted size into the schema bounds', async () => {
    const service = await loadService();
    wireRenderer([
      {
        tabId: 'tab-huge-size',
        url: 'http://a/',
        title: 'A',
        ownerAgentId: 'agent-1',
        // Passes the shape guard but exceeds the live action-schema bounds
        // (e.g. a hand-edited layout file) — clamped to [320, 3840] and
        // rounded, never replayed verbatim into CDP emulation.
        emulatedSize: { width: 1e9, height: 0.5 },
      },
    ]);

    await expect(service.resolveTabOwner('tab-huge-size', 'ws-1')).resolves.toBe('agent-1');
    expect(service.getTabEmulatedSize('tab-huge-size')).toEqual({ width: 3840, height: 320 });
  });

  it('rehydration falls back to the default viewport on a malformed persisted size', async () => {
    const service = await loadService();
    wireRenderer([
      {
        tabId: 'tab-bad-size',
        url: 'http://a/',
        title: 'A',
        ownerAgentId: 'agent-1',
        emulatedSize: { width: -1, height: Number.NaN },
      },
    ]);

    await expect(service.resolveTabOwner('tab-bad-size', 'ws-1')).resolves.toBe('agent-1');
    expect(service.getTabEmulatedSize('tab-bad-size')).toEqual({ width: 1280, height: 800 });
  });

  it('notifyTabOwnerChanged carries the current emulated size so the renderer persists it', async () => {
    const service = await loadService();
    service.setTabOwner('tab-1', 'agent-1', undefined, { width: 1024, height: 768 });
    service.resizeTab('tab-1', 390, 844);

    service.notifyTabOwnerChanged('tab-1', 'ws-1', 'agent-1');
    expect(mocks.sendToWorkspaceWindows).toHaveBeenCalledWith(
      'ws-1',
      IPC_CHANNELS.BROWSER.TAB_OWNER_CHANGED,
      {
        tabId: 'tab-1',
        workspaceId: 'ws-1',
        ownerAgentId: 'agent-1',
        emulatedSize: { width: 390, height: 844 },
        viewport: { mode: 'custom', width: 390, height: 844 },
      },
      ANY_HOST,
    );
  });

  it('listAllTabs annotates tabs with their owner and emulated size', async () => {
    const service = await loadService();
    wireRenderer([
      { tabId: 'tab-owned', url: 'http://a/', title: 'A' },
      { tabId: 'tab-user', url: 'http://b/', title: 'B' },
    ]);
    service.setTabOwner('tab-owned', 'agent-1', undefined, { width: 1024, height: 768 });

    const { tabs } = await service.listAllTabs('ws-1');
    expect(tabs.find((t) => t.tabId === 'tab-owned')).toMatchObject({
      ownerAgentId: 'agent-1',
      emulatedSize: { width: 1024, height: 768 },
    });
    expect(tabs.find((t) => t.tabId === 'tab-user')?.ownerAgentId).toBeUndefined();
  });
});

// A minimized or covered Intent window stops drawing frames, so a capture
// of any of its browser tabs hung until "not-painting". During a capture
// the guest and its hosting window keep drawing (background throttling off),
// and the fallback capture makes the page visible instead of keeping it
// hidden; both are restored afterwards so an idle window costs nothing.
describe('screenshot keeps painting while the app window is minimized', () => {
  const LAYOUT_METRICS = {
    layoutViewport: { clientWidth: 800, clientHeight: 600 },
    cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 },
  };

  function withHost<T extends object>(guest: T, host: { backgroundThrottling: boolean }) {
    return Object.assign(guest, {
      backgroundThrottling: true,
      hostWebContents: { ...host, isDestroyed: () => false, send: vi.fn() },
    });
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lets the guest and its app window draw during the CDP capture, then restores both', async () => {
    const service = await loadService();
    const seen: boolean[][] = [];
    const wc = withHost(
      fakeCdpWebview(71, {
        'Page.getLayoutMetrics': LAYOUT_METRICS,
        'Page.captureScreenshot': { data: JPEG_1PX },
      }),
      { backgroundThrottling: true },
    );
    wc.debugger.sendCommand.mockImplementation(async (method: string) => {
      seen.push([wc.backgroundThrottling, wc.hostWebContents.backgroundThrottling]);
      return method === 'Page.getLayoutMetrics' ? LAYOUT_METRICS : { data: JPEG_1PX };
    });
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-min', 71);

    await expect(service.screenshot('tab-min')).resolves.toMatchObject({ base64: JPEG_1PX });

    expect(seen.length).toBeGreaterThan(0);
    // Both draw during the capture: lifting the guest alone did not paint a
    // minimized macOS window (live test on manual build 39607559335).
    expect(seen.every(([guest, host]) => guest === false && host === false)).toBe(true);
    expect(wc.backgroundThrottling).toBe(true);
    expect(wc.hostWebContents.backgroundThrottling).toBe(true);
    service.unregisterTab('tab-min');
  });

  it('asks the fallback capture to make the page visible and restores throttling on failure', async () => {
    const service = await loadService();
    const wc = withHost(fakeCdpWebview(72, { 'Page.getLayoutMetrics': 'hang' }, 'hang'), {
      backgroundThrottling: true,
    });
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-min-hang', 72);

    const pending = service.screenshot('tab-min-hang');
    pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(12_000);

    await expect(pending).rejects.toThrow('not painting');
    expect(wc.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: false, stayAwake: true });
    expect(wc.backgroundThrottling).toBe(true);
    expect(wc.hostWebContents.backgroundThrottling).toBe(true);
    service.unregisterTab('tab-min-hang');
  });

  it('keeps a guest drawing until its last overlapping capture finishes', async () => {
    const service = await loadService();
    let releaseFirst: () => void = () => {};
    let calls = 0;
    const wc = Object.assign(fakeCdpWebview(73, {}), { backgroundThrottling: true });
    wc.debugger.sendCommand.mockImplementation((method: string) => {
      if (method !== 'Page.getLayoutMetrics') return Promise.resolve({ data: JPEG_1PX });
      calls++;
      return calls === 1
        ? new Promise((resolve) => (releaseFirst = () => resolve(LAYOUT_METRICS)))
        : Promise.resolve(LAYOUT_METRICS);
    });
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-a', 73);

    const first = service.screenshot('tab-a');
    await service.screenshot('tab-a');
    expect(wc.backgroundThrottling).toBe(false);

    releaseFirst();
    await first;
    expect(wc.backgroundThrottling).toBe(true);
    service.unregisterTab('tab-a');
  });

  it('tells the app window a capture starts before it draws and ends after it is restored', async () => {
    const service = await loadService();
    const order: string[] = [];
    const host = {
      throttled: true,
      isDestroyed: () => false,
      send: vi.fn((_channel: string, data: { active: boolean }) =>
        order.push(`send:${data.active}`),
      ),
      get backgroundThrottling() {
        return this.throttled;
      },
      set backgroundThrottling(value: boolean) {
        order.push(`throttling:${value}`);
        this.throttled = value;
      },
    };
    const wc = Object.assign(
      fakeCdpWebview(78, {
        'Page.getLayoutMetrics': LAYOUT_METRICS,
        'Page.captureScreenshot': { data: JPEG_1PX },
      }),
      { backgroundThrottling: true, hostWebContents: host },
    );
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-order', 78);

    await service.screenshot('tab-order');

    expect(order).toEqual(['send:true', 'throttling:false', 'throttling:true', 'send:false']);
    service.unregisterTab('tab-order');
  });

  it('keeps a shared app window drawing until its last overlapping capture finishes', async () => {
    const service = await loadService();
    const host = { backgroundThrottling: true, isDestroyed: () => false, send: vi.fn() };
    let releaseFirst: () => void = () => {};
    const first = Object.assign(fakeCdpWebview(76, {}), {
      backgroundThrottling: true,
      hostWebContents: host,
    });
    first.debugger.sendCommand.mockImplementation((method: string) =>
      method === 'Page.getLayoutMetrics'
        ? new Promise((resolve) => (releaseFirst = () => resolve(LAYOUT_METRICS)))
        : Promise.resolve({ data: JPEG_1PX }),
    );
    const second = Object.assign(
      fakeCdpWebview(77, {
        'Page.getLayoutMetrics': LAYOUT_METRICS,
        'Page.captureScreenshot': { data: JPEG_1PX },
      }),
      { backgroundThrottling: true, hostWebContents: host },
    );
    mocks.fromId.mockImplementation((id) => (id === 76 ? first : id === 77 ? second : undefined));
    service.registerTab('tab-x', 76);
    service.registerTab('tab-y', 77);

    const pending = service.screenshot('tab-x');
    await service.screenshot('tab-y');
    expect(host.backgroundThrottling).toBe(false);

    releaseFirst();
    await pending;
    expect(host.backgroundThrottling).toBe(true);
    // One start/end bracket for the whole overlap, so presence ignores it.
    expect(host.send.mock.calls).toEqual([
      ['browser:capture-drawing', { active: true }],
      ['browser:capture-drawing', { active: false }],
    ]);
    service.unregisterTab('tab-x');
    service.unregisterTab('tab-y');
  });

  it('leaves a guest that already draws in the background unchanged', async () => {
    const service = await loadService();
    const wc = Object.assign(
      fakeCdpWebview(75, {
        'Page.getLayoutMetrics': LAYOUT_METRICS,
        'Page.captureScreenshot': { data: JPEG_1PX },
      }),
      { backgroundThrottling: false },
    );
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-unthrottled', 75);

    await service.screenshot('tab-unthrottled');

    expect(wc.backgroundThrottling).toBe(false);
    service.unregisterTab('tab-unthrottled');
  });
});

// An agent measuring animation, flicker or timing in its own hidden tab
// saw ~1 frame per second (cloudlands-fe#3861 investigation). While the
// agent acts on a tab it owns, the tab keeps drawing at full frame rate:
// the capture hold keeps the guest and its window unthrottled, and the host
// window is told to give the guest a full-size invisible box.
describe('agent drawing hold', () => {
  function heldGuest(id: number) {
    const host = {
      id: 1000 + id,
      backgroundThrottling: true,
      isDestroyed: () => false,
      send: vi.fn(),
    };
    const guest = Object.assign(fakeWebview(id, 'http://agent/'), {
      backgroundThrottling: true,
      hostWebContents: host,
      removeListener: vi.fn(),
    });
    return { guest, host };
  }

  function agentDrawingMessages(host: { send: ReturnType<typeof vi.fn> }) {
    return host.send.mock.calls
      .filter(([channel]) => channel === IPC_CHANNELS.BROWSER.AGENT_DRAWING)
      .map(([, payload]) => payload);
  }

  async function loadIdleMs() {
    const { AGENT_DRAWING_IDLE_MS } = await import('../main/embedded-browser-cdp-service');
    return AGENT_DRAWING_IDLE_MS;
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps an owned tab drawing until the idle window lapses, then restores throttling', async () => {
    const service = await loadService();
    const idleMs = await loadIdleMs();
    const { guest, host } = heldGuest(81);
    mocks.fromId.mockReturnValue(guest);
    service.registerTab('tab-agent', 81);
    service.setTabOwner('tab-agent', 'agent-1');
    const listenersBefore = guest.once.mock.calls.length;

    service.beginAgentDrawing('tab-agent', 'agent-1')();
    const onDestroyed = guest.once.mock.calls[listenersBefore][1];

    expect(service.hasAgentDrawingHold('tab-agent')).toBe(true);
    expect(guest.backgroundThrottling).toBe(false);
    expect(host.backgroundThrottling).toBe(false);
    // Presence is told before the window's visibility changes.
    expect(host.send).toHaveBeenCalledWith(IPC_CHANNELS.BROWSER.CAPTURE_DRAWING, {
      active: true,
    });
    expect(agentDrawingMessages(host)).toEqual([{ tabId: 'tab-agent', active: true }]);

    // Each action restarts the idle window.
    vi.advanceTimersByTime(idleMs - 1);
    service.beginAgentDrawing('tab-agent', 'agent-1')();
    vi.advanceTimersByTime(idleMs - 1);
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(true);
    expect(guest.backgroundThrottling).toBe(false);
    // Each action re-announces the box (idempotent in the renderer, and it
    // restores a box whose renderer state was lost) without stacking a
    // second destroyed listener.
    expect(agentDrawingMessages(host)).toEqual([
      { tabId: 'tab-agent', active: true },
      { tabId: 'tab-agent', active: true },
    ]);
    expect(guest.once).toHaveBeenCalledTimes(listenersBefore + 1);

    vi.advanceTimersByTime(1);
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(false);
    expect(guest.backgroundThrottling).toBe(true);
    expect(host.backgroundThrottling).toBe(true);
    expect(host.send).toHaveBeenCalledWith(IPC_CHANNELS.BROWSER.CAPTURE_DRAWING, {
      active: false,
    });
    expect(agentDrawingMessages(host).at(-1)).toEqual({ tabId: 'tab-agent', active: false });
    expect(guest.removeListener).toHaveBeenCalledWith('destroyed', onDestroyed);
  });

  // Review regression: a long measurement (an evaluate awaiting 40 s of
  // frames) must not lose the hold halfway through.
  it('never lapses while an action is still in flight', async () => {
    const service = await loadService();
    const idleMs = await loadIdleMs();
    const { guest } = heldGuest(87);
    mocks.fromId.mockReturnValue(guest);
    service.registerTab('tab-agent', 87);
    service.setTabOwner('tab-agent', 'agent-1');

    const endLong = service.beginAgentDrawing('tab-agent', 'agent-1');
    service.beginAgentDrawing('tab-agent', 'agent-1')();
    vi.advanceTimersByTime(idleMs * 3);
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(true);
    expect(guest.backgroundThrottling).toBe(false);

    endLong();
    endLong(); // ending twice is harmless
    vi.advanceTimersByTime(idleMs - 1);
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(false);
    expect(guest.backgroundThrottling).toBe(true);
  });

  it('only holds a tab for the agent that owns it (user and other agents keep throttling)', async () => {
    const service = await loadService();
    const { guest, host } = heldGuest(82);
    mocks.fromId.mockReturnValue(guest);
    service.registerTab('tab-user', 82);
    service.registerTab('tab-other', 82);
    service.setTabOwner('tab-other', 'agent-owner');

    service.beginAgentDrawing('tab-user', 'agent-1')();
    service.beginAgentDrawing('tab-other', 'agent-1')();

    expect(service.hasAgentDrawingHold('tab-user')).toBe(false);
    expect(service.hasAgentDrawingHold('tab-other')).toBe(false);
    expect(guest.backgroundThrottling).toBe(true);
    expect(host.backgroundThrottling).toBe(true);
    expect(host.send).not.toHaveBeenCalled();
  });

  // Review regression: an action that mounts its tab on demand must draw
  // at full rate as soon as the tab mounts, not only after it returns.
  it('holds a tab that mounts while the action is in flight', async () => {
    const service = await loadService();
    const { guest, host } = heldGuest(88);
    mocks.fromId.mockReturnValue(guest);
    service.setTabOwner('tab-agent', 'agent-1');

    const end = service.beginAgentDrawing('tab-agent', 'agent-1');
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(false);

    service.registerTab('tab-agent', 88);
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(true);
    expect(guest.backgroundThrottling).toBe(false);
    expect(agentDrawingMessages(host)).toEqual([{ tabId: 'tab-agent', active: true }]);
    end();
  });

  it('drops the guest hold on unmount or guest death, re-holds on remount, ends on close', async () => {
    const service = await loadService();
    const { guest, host } = heldGuest(83);
    mocks.fromId.mockReturnValue(guest);
    service.registerTab('tab-agent', 83);
    service.setTabOwner('tab-agent', 'agent-1');

    service.beginAgentDrawing('tab-agent', 'agent-1')();
    service.unregisterTab('tab-agent');
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(false);
    expect(guest.backgroundThrottling).toBe(true);
    expect(host.backgroundThrottling).toBe(true);
    // Still inside the idle window: a remount is held again.
    const listenersBefore = guest.once.mock.calls.length;
    service.registerTab('tab-agent', 83);
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(true);

    // The hold's own listener is attached before registerTab's cleanup one.
    const onDestroyed = guest.once.mock.calls[listenersBefore][1] as () => void;
    onDestroyed();
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(false);
    expect(guest.backgroundThrottling).toBe(true);
    expect(agentDrawingMessages(host).at(-1)).toEqual({ tabId: 'tab-agent', active: false });

    service.registerTab('tab-agent', 83);
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(true);
    service.clearTabOwnership('tab-agent');
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(false);
    expect(guest.backgroundThrottling).toBe(true);
    // Closed: a later remount is not held.
    service.registerTab('tab-agent', 83);
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(false);
  });

  it('ends the hold when another agent takes the tab over', async () => {
    const service = await loadService();
    const { guest } = heldGuest(89);
    mocks.fromId.mockReturnValue(guest);
    service.registerTab('tab-agent', 89);
    service.setTabOwner('tab-agent', 'agent-1');
    const end = service.beginAgentDrawing('tab-agent', 'agent-1');

    service.setTabOwner('tab-agent', 'agent-2');
    service.registerTab('tab-agent', 89);

    expect(service.hasAgentDrawingHold('tab-agent')).toBe(false);
    expect(guest.backgroundThrottling).toBe(true);
    end();
  });

  it('moves the hold when the tab is re-registered to a new guest', async () => {
    const service = await loadService();
    const first = heldGuest(84);
    const second = heldGuest(85);
    mocks.fromId.mockImplementation((id) =>
      id === 84 ? first.guest : id === 85 ? second.guest : undefined,
    );
    service.registerTab('tab-agent', 84);
    service.setTabOwner('tab-agent', 'agent-1');
    service.beginAgentDrawing('tab-agent', 'agent-1')();

    service.registerTab('tab-agent', 85);

    expect(first.guest.backgroundThrottling).toBe(true);
    expect(first.host.backgroundThrottling).toBe(true);
    expect(agentDrawingMessages(first.host).at(-1)).toEqual({ tabId: 'tab-agent', active: false });
    expect(second.guest.backgroundThrottling).toBe(false);
    expect(agentDrawingMessages(second.host)).toEqual([{ tabId: 'tab-agent', active: true }]);
  });

  it('a capture inside the hold does not end it early', async () => {
    const service = await loadService();
    const { host } = heldGuest(86);
    const wc = Object.assign(
      fakeCdpWebview(86, {
        'Page.getLayoutMetrics': {
          layoutViewport: { clientWidth: 800, clientHeight: 600 },
          cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 },
        },
        'Page.captureScreenshot': { data: JPEG_1PX },
      }),
      { backgroundThrottling: true, hostWebContents: host, removeListener: vi.fn() },
    );
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-agent', 86);
    service.setTabOwner('tab-agent', 'agent-1');
    service.beginAgentDrawing('tab-agent', 'agent-1')();

    await expect(service.screenshot('tab-agent')).resolves.toMatchObject({ base64: JPEG_1PX });

    expect(wc.backgroundThrottling).toBe(false);
    expect(host.backgroundThrottling).toBe(false);
    expect(service.hasAgentDrawingHold('tab-agent')).toBe(true);
  });
});

describe('screenshot Page-domain hang fallback (#3154)', () => {
  const LAYOUT_METRICS = {
    layoutViewport: { clientWidth: 800, clientHeight: 600 },
    cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 },
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the CDP screenshot when the Page domain answers', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(61, {
      'Page.getLayoutMetrics': LAYOUT_METRICS,
      'Page.captureScreenshot': { data: JPEG_1PX },
    });
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-cdp', 61);

    await expect(service.screenshot('tab-cdp')).resolves.toEqual({
      base64: JPEG_1PX,
      width: 800,
      height: 600,
    });
    expect(Buffer.from(JPEG_1PX, 'base64').subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.objectContaining({ format: 'jpeg', quality: 80 }),
    );
    expect(wc.capturePage).not.toHaveBeenCalled();
    service.unregisterTab('tab-cdp');
  });

  it('falls back to capturePage() when Page.getLayoutMetrics never answers', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(62, { 'Page.getLayoutMetrics': 'hang' });
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-hang-metrics', 62);

    const pending = service.screenshot('tab-hang-metrics');
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(pending).resolves.toEqual({
      base64: JPEG_1PX,
      width: 320,
      height: 240,
    });
    expect(wc.capturePage).toHaveBeenCalledTimes(1);
    service.unregisterTab('tab-hang-metrics');
  });

  it('falls back to capturePage() when Page.captureScreenshot never answers', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(63, {
      'Page.getLayoutMetrics': LAYOUT_METRICS,
      'Page.captureScreenshot': 'hang',
    });
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-hang-capture', 63);

    const pending = service.screenshot('tab-hang-capture');
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(pending).resolves.toEqual({
      base64: JPEG_1PX,
      width: 320,
      height: 240,
    });
    expect(wc.capturePage).toHaveBeenCalledTimes(1);
    service.unregisterTab('tab-hang-capture');
  });

  it('falls back to capturePage() when a Page-domain command rejects', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(64, {
      'Page.getLayoutMetrics': new Error('Page domain unavailable'),
    });
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-reject', 64);

    await expect(service.screenshot('tab-reject')).resolves.toEqual({
      base64: JPEG_1PX,
      width: 320,
      height: 240,
    });
    expect(wc.capturePage).toHaveBeenCalledTimes(1);
    service.unregisterTab('tab-reject');
  });

  it('propagates the error when the capturePage() fallback itself fails', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(65, {
      'Page.getLayoutMetrics': new Error('Page domain unavailable'),
    });
    wc.capturePage.mockRejectedValue(new Error('capture failed'));
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-fallback-fail', 65);

    await expect(service.screenshot('tab-fallback-fail')).rejects.toThrow(
      'Screenshot capture failed: CDP stage: Page.getLayoutMetrics failed: Page domain unavailable; Electron fallback stage: capture failed',
    );
    expect(wc.capturePage).toHaveBeenCalledTimes(1);
    service.unregisterTab('tab-fallback-fail');
  });

  it('bounds a stalled capturePage() fallback and reports both failed stages', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(
      66,
      { 'Page.getLayoutMetrics': new Error('Page domain unavailable') },
      'hang',
    );
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-fallback-hang', 66);

    const pending = service.screenshot('tab-fallback-hang');
    pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(5_100);

    await expect(pending).rejects.toThrow(
      'Screenshot capture failed: CDP stage: Page.getLayoutMetrics failed: Page domain unavailable; Electron fallback stage: capturePage timed out after 5000ms: the tab is not painting. A visible tab paints only while it is on screen: its panel\'s active tab (listTabs reports displayed: true — otherwise use { action: "showTab", tabId } to activate it without stealing focus, or focusTab to activate and focus), with its workspace in view in the app and its panel not hidden by zoom; then capture again.',
    );
    expect(wc.capturePage).toHaveBeenCalledTimes(1);
    service.unregisterTab('tab-fallback-hang');
  });
});

describe('capture stages bounded by the request deadline (intent-hq/intent#4835)', () => {
  const LAYOUT_METRICS = {
    layoutViewport: { clientWidth: 800, clientHeight: 600 },
    cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function rejection(pending: Promise<unknown>) {
    pending.catch(() => {});
    try {
      await pending;
    } catch (err) {
      return err as Error & { errorCode?: string; stage?: string };
    }
    throw new Error('expected rejection');
  }

  it('clamps a hanging Page command and the capturePage fallback to the deadline, naming the stage', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(71, { 'Page.getLayoutMetrics': 'hang' }, 'hang');
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-deadline', 71);

    // 3 s left: the 5 s CDP cap collapses to 3 s, then nothing is left for
    // the fallback — the whole chain answers at the deadline, not at 10 s.
    const pending = service.screenshot('tab-deadline', { deadline: Date.now() + 3_000 });
    const settled = rejection(pending);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(wc.capturePage).not.toHaveBeenCalled();
    // The fallback gets a zero budget, so the chain settles right after the
    // deadline — well short of the 10 s the two uncapped stages would take.
    await vi.advanceTimersByTimeAsync(101);

    const err = await settled;
    expect(err.errorCode).toBe('deadline-exhausted');
    expect(err.stage).toBe('capturePage');
    expect(err.message).toContain('Page.getLayoutMetrics timed out after 3000ms');
    expect(err.message).toContain('request deadline was exhausted');
    expect(err.message).toContain('capturePage timed out after 0ms');
    expect(wc.capturePage).toHaveBeenCalledTimes(1);
    service.unregisterTab('tab-deadline');
  });

  it('a fallback that times out on its own cap is reported as not-painting, not deadline-exhausted', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(
      72,
      { 'Page.getLayoutMetrics': new Error('Page domain unavailable') },
      'hang',
    );
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-not-painting', 72);

    const pending = service.screenshot('tab-not-painting', { deadline: Date.now() + 18_000 });
    const settled = rejection(pending);
    await vi.advanceTimersByTimeAsync(5_000);

    const err = await settled;
    expect(err.errorCode).toBe('not-painting');
    expect(err.stage).toBe('capturePage');
    expect(err.message).toContain('capturePage timed out after 5000ms: the tab is not painting');
    service.unregisterTab('tab-not-painting');
  });

  it('a successful capture inside the budget is unaffected by the deadline', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(73, {
      'Page.getLayoutMetrics': LAYOUT_METRICS,
      'Page.captureScreenshot': { data: JPEG_1PX },
    });
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-ok', 73);

    await expect(service.screenshot('tab-ok', { deadline: Date.now() + 18_000 })).resolves.toEqual({
      base64: JPEG_1PX,
      width: 800,
      height: 600,
    });
    service.unregisterTab('tab-ok');
  });

  it('bounds Runtime.evaluate by the deadline only when one is given', async () => {
    const service = await loadService();
    const wc = fakeCdpWebview(74, { 'Runtime.evaluate': 'hang' });
    mocks.fromId.mockReturnValue(wc);
    service.registerTab('tab-eval', 74);

    const bounded = service.evaluate('tab-eval', '1', { deadline: Date.now() + 1_000 });
    const settled = rejection(bounded);
    let unboundedSettled = false;
    service.evaluate('tab-eval', '1').finally(() => {
      unboundedSettled = true;
    });
    await vi.advanceTimersByTimeAsync(1_000);

    const err = await settled;
    expect(err.errorCode).toBe('deadline-exhausted');
    expect(err.stage).toBe('Runtime.evaluate');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(unboundedSettled).toBe(false);
    service.unregisterTab('tab-eval');
  });

  describe('waitForTabLoad', () => {
    function loadingWebview(id: number, url: string) {
      const listeners = new Map<string, () => void>();
      let loading = true;
      return {
        wc: {
          ...fakeWebview(id, url),
          isLoading: () => loading,
          once: vi.fn((event: string, cb: () => void) => listeners.set(event, cb)),
          removeListener: vi.fn((event: string) => listeners.delete(event)),
        },
        finishLoad() {
          loading = false;
          listeners.get('did-stop-loading')?.();
        },
      };
    }

    it('resolves undefined for a tab that is not mounted', async () => {
      const service = await loadService();
      await expect(service.waitForTabLoad('nope', 1_000)).resolves.toBeUndefined();
    });

    it('resolves immediately with the live URL when the guest is not loading', async () => {
      const service = await loadService();
      const wc = { ...fakeWebview(75, 'http://127.0.0.1:5199/app'), isLoading: () => false };
      mocks.fromId.mockReturnValue(wc);
      service.registerTab('tab-settled', 75);

      await expect(service.waitForTabLoad('tab-settled', 5_000)).resolves.toEqual({
        loading: false,
        url: 'http://127.0.0.1:5199/app',
      });
      service.unregisterTab('tab-settled');
    });

    it('resolves loading: false once did-stop-loading fires within the budget', async () => {
      const service = await loadService();
      const { wc, finishLoad } = loadingWebview(76, 'http://127.0.0.1:5199/');
      mocks.fromId.mockReturnValue(wc);
      service.registerTab('tab-loading', 76);

      const pending = service.waitForTabLoad('tab-loading', 5_000);
      await vi.advanceTimersByTimeAsync(1_000);
      finishLoad();

      await expect(pending).resolves.toEqual({ loading: false, url: 'http://127.0.0.1:5199/' });
      expect(wc.removeListener).toHaveBeenCalledWith('did-stop-loading', expect.any(Function));
      service.unregisterTab('tab-loading');
    });

    it('resolves loading: true when the budget elapses first', async () => {
      const service = await loadService();
      const { wc } = loadingWebview(77, 'http://127.0.0.1:5199/');
      mocks.fromId.mockReturnValue(wc);
      service.registerTab('tab-still-loading', 77);

      const pending = service.waitForTabLoad('tab-still-loading', 2_000);
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(pending).resolves.toEqual({ loading: true, url: 'http://127.0.0.1:5199/' });
      service.unregisterTab('tab-still-loading');
    });
  });
});
