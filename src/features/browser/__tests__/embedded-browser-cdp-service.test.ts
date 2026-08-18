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

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

type PanelTab = { tabId: string; url: string; title: string; closable?: boolean };

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

describe('findModelTabByExactUrl (#2541)', () => {
  const URL_A = 'http://localhost:3000/board';

  it('returns a tab this agent opened on the exact URL and refreshes its lease', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-a', url: URL_A, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(41, URL_A)]);
    service.registerTab('tab-a', 41);
    service.touchLease('tab-a', 'agent-1');

    await expect(service.findModelTabByExactUrl(URL_A, 'agent-1', 'ws-1')).resolves.toBe('tab-a');
    // Reuse re-claims the lease for the requesting agent
    expect(service.findIdleTab('agent-1')).toBeUndefined();
  });

  it('never returns a user-opened tab (no lease entry)', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-user', url: URL_A, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(42, URL_A)]);
    service.registerTab('tab-user', 42);

    await expect(service.findModelTabByExactUrl(URL_A, 'agent-1', 'ws-1')).resolves.toBeUndefined();
  });

  it('skips a tab actively leased by a different agent', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-other', url: URL_A, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(43, URL_A)]);
    service.registerTab('tab-other', 43);
    service.touchLease('tab-other', 'agent-2');

    await expect(service.findModelTabByExactUrl(URL_A, 'agent-1', 'ws-1')).resolves.toBeUndefined();
  });

  it("claims another agent's tab once its lease has expired", async () => {
    vi.useFakeTimers();
    try {
      const service = await loadService();
      wireRenderer([{ tabId: 'tab-expired', url: URL_A, title: 'A' }]);
      mocks.getAllWebContents.mockReturnValue([fakeWebview(44, URL_A)]);
      service.registerTab('tab-expired', 44);
      service.touchLease('tab-expired', 'agent-2');
      vi.advanceTimersByTime(4 * 60 * 1000); // past the 3-minute idle timeout

      await expect(service.findModelTabByExactUrl(URL_A, 'agent-1', 'ws-1')).resolves.toBe(
        'tab-expired',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('matches by exact string equality only — no URL normalization', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-slash', url: `${URL_A}/`, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(45, `${URL_A}/`)]);
    service.registerTab('tab-slash', 45);
    service.touchLease('tab-slash', 'agent-1');

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
    service.touchLease('tab-elsewhere', 'agent-1');

    await expect(service.findModelTabByExactUrl(URL_A, 'agent-1', 'ws-1')).resolves.toBeUndefined();
  });
});

describe('findModelTabByRequestedUrl (#2787)', () => {
  const REQUESTED = 'http://127.0.0.1:5190/';
  const TUNNELED_OLD = 'http://127.0.0.1:55001/';

  it('returns a tab whose lease recorded the requested URL even when its live URL differs', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-a', url: TUNNELED_OLD, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(51, TUNNELED_OLD)]);
    service.registerTab('tab-a', 51);
    service.touchLease('tab-a', 'agent-1', REQUESTED);

    await expect(service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1')).resolves.toBe(
      'tab-a',
    );
    // Reuse re-claims the lease for the requesting agent
    expect(service.findIdleTab('agent-1')).toBeUndefined();
  });

  it('never returns a user-opened tab (no lease entry)', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-user', url: TUNNELED_OLD, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(52, TUNNELED_OLD)]);
    service.registerTab('tab-user', 52);

    await expect(
      service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1'),
    ).resolves.toBeUndefined();
  });

  it('returns undefined for leases that recorded no requested URL', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-plain', url: TUNNELED_OLD, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(53, TUNNELED_OLD)]);
    service.registerTab('tab-plain', 53);
    service.touchLease('tab-plain', 'agent-1');

    await expect(
      service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1'),
    ).resolves.toBeUndefined();
  });

  it('skips a tab actively leased by a different agent', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-other', url: TUNNELED_OLD, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(54, TUNNELED_OLD)]);
    service.registerTab('tab-other', 54);
    service.touchLease('tab-other', 'agent-2', REQUESTED);

    await expect(
      service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1'),
    ).resolves.toBeUndefined();
  });

  it("claims another agent's tab once its lease has expired", async () => {
    vi.useFakeTimers();
    try {
      const service = await loadService();
      wireRenderer([{ tabId: 'tab-expired', url: TUNNELED_OLD, title: 'A' }]);
      mocks.getAllWebContents.mockReturnValue([fakeWebview(55, TUNNELED_OLD)]);
      service.registerTab('tab-expired', 55);
      service.touchLease('tab-expired', 'agent-2', REQUESTED);
      vi.advanceTimersByTime(4 * 60 * 1000); // past the 3-minute idle timeout

      await expect(service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1')).resolves.toBe(
        'tab-expired',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('a plain touchLease refresh preserves the recorded requested URL', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-a', url: TUNNELED_OLD, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(56, TUNNELED_OLD)]);
    service.registerTab('tab-a', 56);
    service.touchLease('tab-a', 'agent-1', REQUESTED);
    service.touchLease('tab-a', 'agent-1'); // e.g. a screenshot on the tab

    await expect(service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1')).resolves.toBe(
      'tab-a',
    );
  });

  it('touchLease with null clears the recorded requested URL (tab repurposed)', async () => {
    const service = await loadService();
    wireRenderer([{ tabId: 'tab-a', url: TUNNELED_OLD, title: 'A' }]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(58, TUNNELED_OLD)]);
    service.registerTab('tab-a', 58);
    service.touchLease('tab-a', 'agent-1', REQUESTED);
    service.touchLease('tab-a', 'agent-1', null); // repurposed for a non-tunneled open

    await expect(
      service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1'),
    ).resolves.toBeUndefined();
  });

  it("never returns a matching tab from another workspace's panel layout", async () => {
    const service = await loadService();
    wireRenderer([]);
    mocks.getAllWebContents.mockReturnValue([fakeWebview(57, TUNNELED_OLD)]);
    service.registerTab('tab-elsewhere', 57);
    service.touchLease('tab-elsewhere', 'agent-1', REQUESTED);

    await expect(
      service.findModelTabByRequestedUrl(REQUESTED, 'agent-1', 'ws-1'),
    ).resolves.toBeUndefined();
  });
});
