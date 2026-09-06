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

const mocks = vi.hoisted(() => ({
  sendToWorkspaceWindows: vi.fn(),
  getAllWebContents: vi.fn(() => [] as unknown[]),
  fromId: vi.fn(() => undefined),
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
  title: string;
  closable?: boolean;
  ownerAgentId?: string;
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
  mocks.fromId.mockReturnValue(undefined);
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
    wireRenderer([
      { tabId: 'tab-owned', url: 'http://a/', title: 'A', ownerAgentId: 'agent-1' },
      { tabId: 'tab-user', url: 'http://b/', title: 'B' },
    ]);

    // Fresh service: the in-memory registry knows nothing until a tab list
    // reply crosses the IPC boundary.
    expect(service.getTabOwner('tab-owned')).toBeUndefined();
    await expect(service.resolveTabOwner('tab-owned', 'ws-1')).resolves.toBe('agent-1');
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
      'Screenshot capture failed: CDP stage: Page.getLayoutMetrics failed: Page domain unavailable; Electron fallback stage: capturePage timed out after 5000ms: the tab is not painting (it is not the active (displayed) tab of a visible panel, or its surface is occluded). Use { action: "showTab", tabId } to activate it in its panel without stealing focus (or focusTab to activate and focus), check listTabs "displayed", then capture again.',
    );
    expect(wc.capturePage).toHaveBeenCalledTimes(1);
    service.unregisterTab('tab-fallback-hang');
  });
});
