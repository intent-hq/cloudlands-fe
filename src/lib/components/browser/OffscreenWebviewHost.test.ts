/**
 * OffscreenWebviewHost (monorepo#2789 slice 2): mounts hidden webviews for
 * browser tabs of background workspaces, registers them for CDP on
 * dom-ready, drops them when the workspace is displayed again or its layout
 * state is removed (archive/delete), and enforces the LRU cap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';

const { layoutsStore, dispatchMock } = vi.hoisted(() => {
  // Minimal svelte-store-contract writable (vi.hoisted runs before imports).
  function miniWritable<T>(initial: T) {
    let value = initial;
    const subscribers = new Set<(v: T) => void>();
    return {
      subscribe(run: (v: T) => void) {
        subscribers.add(run);
        run(value);
        return () => subscribers.delete(run);
      },
      set(next: T) {
        value = next;
        for (const run of [...subscribers]) run(value);
      },
      get() {
        return value;
      },
    };
  }
  return {
    layoutsStore: miniWritable<Record<string, unknown>>({}),
    dispatchMock: vi.fn(),
  };
});

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectPanelLayoutWorkspaces: () => layoutsStore,
}));

vi.mock('$store/renderer/slices/panel-layout/panel-layout-slice', () => ({
  updateTabBrowserUrl: (...args: unknown[]) => ({
    type: 'panelLayout/updateTabBrowserUrl',
    payload: args,
  }),
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: dispatchMock },
}));

import OffscreenWebviewHost from './OffscreenWebviewHost.svelte';

function browserLayout(tabs: Array<{ id: string; url?: string }>) {
  return {
    panels: {
      'panel-1': {
        id: 'panel-1',
        tabs: tabs.map((tab) => ({
          id: tab.id,
          type: 'browser',
          title: tab.id,
          closable: true,
          browserUrl: tab.url ?? `https://example.test/${tab.id}`,
        })),
        activeTabId: tabs[0]?.id ?? null,
      },
    },
  };
}

function mountedTabIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-offscreen-webview-tab]')].map(
    (el) => el.getAttribute('data-offscreen-webview-tab') ?? '',
  );
}

describe('OffscreenWebviewHost', () => {
  const invokeMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    layoutsStore.set({});
    dispatchMock.mockClear();
    invokeMock.mockClear();
    (window as unknown as { electronAPI: { invoke: typeof invokeMock } }).electronAPI = {
      invoke: invokeMock,
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it('mounts webviews for background-workspace browser tabs but not displayed ones', async () => {
    layoutsStore.set({
      'ws-shown': browserLayout([{ id: 'tab-shown' }]),
      'ws-bg': browserLayout([{ id: 'tab-bg' }]),
    });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set(['ws-shown']) },
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
    const webview = container.querySelector('[data-offscreen-webview-tab="tab-bg"]');
    expect(webview?.getAttribute('src')).toBe('https://example.test/tab-bg');
  });

  it('registers a mounted webview for CDP on dom-ready', async () => {
    layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg' }]) });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set() },
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
    const webview = container.querySelector(
      '[data-offscreen-webview-tab="tab-bg"]',
    ) as HTMLElement & {
      getWebContentsId?: () => number;
    };
    webview.getWebContentsId = () => 77;
    webview.dispatchEvent(new Event('dom-ready'));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('browser:register-tab', {
        tabId: 'tab-bg',
        webContentsId: 77,
      }),
    );
  });

  // Regression (monorepo#3170): reparenting the <webview> recreates the
  // guest webContents and fires dom-ready again — the new guest must
  // re-register, while same-guest navigations must not stack registrations.
  it('re-registers a new guest webContents but not the same guest', async () => {
    layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg' }]) });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set() },
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
    const webview = container.querySelector(
      '[data-offscreen-webview-tab="tab-bg"]',
    ) as HTMLElement & {
      getWebContentsId?: () => number;
    };
    const registerCalls = () =>
      invokeMock.mock.calls.filter(([channel]) => channel === 'browser:register-tab');

    webview.getWebContentsId = () => 77;
    webview.dispatchEvent(new Event('dom-ready'));
    await waitFor(() => expect(registerCalls()).toHaveLength(1));

    // Same guest navigates: dom-ready fires again, no redundant registration.
    webview.dispatchEvent(new Event('dom-ready'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(registerCalls()).toHaveLength(1);

    // Guest recreated (webview reparented): new id must re-register.
    webview.getWebContentsId = () => 78;
    webview.dispatchEvent(new Event('dom-ready'));
    await waitFor(() =>
      expect(registerCalls()).toEqual([
        ['browser:register-tab', { tabId: 'tab-bg', webContentsId: 77 }],
        ['browser:register-tab', { tabId: 'tab-bg', webContentsId: 78 }],
      ]),
    );
  });

  it('retries registration on a later dom-ready after the IPC rejects', async () => {
    layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg' }]) });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set() },
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
    const webview = container.querySelector(
      '[data-offscreen-webview-tab="tab-bg"]',
    ) as HTMLElement & {
      getWebContentsId?: () => number;
    };
    const registerCalls = () =>
      invokeMock.mock.calls.filter(([channel]) => channel === 'browser:register-tab');

    invokeMock.mockRejectedValueOnce(new Error('main process not ready'));
    webview.getWebContentsId = () => 77;
    webview.dispatchEvent(new Event('dom-ready'));
    await waitFor(() => expect(registerCalls()).toHaveLength(1));

    // The failed registration reset the gate: the same guest's next
    // dom-ready retries instead of staying unregistered.
    webview.dispatchEvent(new Event('dom-ready'));
    await waitFor(() =>
      expect(registerCalls()).toEqual([
        ['browser:register-tab', { tabId: 'tab-bg', webContentsId: 77 }],
        ['browser:register-tab', { tabId: 'tab-bg', webContentsId: 77 }],
      ]),
    );
  });

  it('syncs full and in-page navigation back into the persisted tab URL', async () => {
    layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg' }]) });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set() },
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
    const webview = container.querySelector('[data-offscreen-webview-tab="tab-bg"]')!;

    const navigate = new Event('did-navigate') as Event & { url?: string };
    navigate.url = 'https://example.test/next';
    webview.dispatchEvent(navigate);
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'panelLayout/updateTabBrowserUrl',
      payload: ['ws-bg', 'tab-bg', 'https://example.test/next'],
    });

    const inPage = new Event('did-navigate-in-page') as Event & { url?: string };
    inPage.url = 'https://example.test/next#section';
    webview.dispatchEvent(inPage);
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'panelLayout/updateTabBrowserUrl',
      payload: ['ws-bg', 'tab-bg', 'https://example.test/next#section'],
    });
  });

  it('unmounts a tab when its workspace becomes displayed and when its layout is removed', async () => {
    layoutsStore.set({
      'ws-a': browserLayout([{ id: 'tab-a' }]),
      'ws-b': browserLayout([{ id: 'tab-b' }]),
    });
    const { container, rerender } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set() },
    });
    await waitFor(() => expect(mountedTabIds(container).sort()).toEqual(['tab-a', 'tab-b']));

    // ws-a becomes the displayed workspace.
    await rerender({ excludedWorkspaceIds: new Set(['ws-a']) });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-b']));

    // ws-b is archived/deleted: its layout state is cleared.
    layoutsStore.set({ 'ws-a': layoutsStore.get()['ws-a'] });
    await waitFor(() => expect(mountedTabIds(container)).toEqual([]));
  });

  it('caps mounted webviews via LRU eviction', async () => {
    let now = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      layoutsStore.set({ 'ws-1': browserLayout([{ id: 't-1' }, { id: 't-2' }]) });
      const { container } = render(OffscreenWebviewHost, {
        props: { excludedWorkspaceIds: new Set(), maxWebviews: 2 },
      });
      await waitFor(() => expect(mountedTabIds(container).sort()).toEqual(['t-1', 't-2']));

      // t-3 backgrounds later, so it is freshest; the oldest entry loses
      // (t-1/t-2 tie on timestamp — candidate order keeps t-1).
      now = 2_000;
      layoutsStore.set({
        'ws-1': browserLayout([{ id: 't-1' }, { id: 't-2' }, { id: 't-3' }]),
      });
      await waitFor(() => expect(mountedTabIds(container)).toEqual(['t-1', 't-3']));
    } finally {
      nowSpy.mockRestore();
    }
  });

  // Regression (monorepo#3366): guests parked outside the viewport
  // (left:-10000px) get viewport-culled by the compositor — no BeginFrames,
  // so CDP screenshot and capturePage hang. The host container must stay
  // in-viewport (1x1 clip at the origin), hidden via overflow + opacity.
  it('hosts guests in-viewport in a clipped invisible container, not parked offscreen', async () => {
    layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg' }]) });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set() },
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
    const host = container.querySelector('[data-offscreen-webview-host]') as HTMLElement;
    expect(host.style.left).not.toBe('-10000px');
    expect(host.className).toContain('left-0');
    expect(host.className).toContain('top-0');
    expect(host.className).toContain('overflow-hidden');
    expect(host.className).toContain('opacity-0');
    expect(host.className).toContain('pointer-events-none');
    // inert keeps the focusable webviews out of the tab order.
    expect(host.hasAttribute('inert')).toBe(true);
  });

  it('skips tabs with non-loadable URLs', async () => {
    layoutsStore.set({
      'ws-bg': browserLayout([{ id: 'tab-js', url: 'javascript:alert(1)' }]),
    });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set() },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mountedTabIds(container)).toEqual([]);
  });

  // Regression (monorepo#2857 review): the mount URL is frozen, so an
  // external browserUrl update to a hidden owned tab (e.g. an agent openTab
  // replacing it) silently diverged — the live guest must navigate.
  it('navigates a mounted hidden tab when its persisted browserUrl changes externally', async () => {
    const hiddenLayout = (url: string) => ({
      panels: {},
      hiddenTabs: {
        idField: 'id',
        ids: ['tab-hidden'],
        map: {
          'tab-hidden': {
            id: 'tab-hidden',
            type: 'browser',
            title: 'Hidden',
            closable: true,
            browserUrl: url,
            ownerAgentId: 'agent-1',
          },
        },
        refsCount: { 'tab-hidden': 1 },
      },
    });
    layoutsStore.set({ 'ws-shown': hiddenLayout('https://example.test/start') });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set(['ws-shown']) },
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-hidden']));

    const webview = container.querySelector(
      '[data-offscreen-webview-tab="tab-hidden"]',
    ) as HTMLElement & {
      getWebContentsId?: () => number;
      getURL?: () => string;
      loadURL?: (url: string) => Promise<void>;
    };
    webview.getWebContentsId = () => 88;
    webview.getURL = () => 'https://example.test/start';
    const loadURL = vi.fn().mockResolvedValue(undefined);
    webview.loadURL = loadURL;
    webview.dispatchEvent(new Event('dom-ready'));

    // Our own did-navigate echo (equal URL) must NOT reload the guest.
    layoutsStore.set({ 'ws-shown': hiddenLayout('https://example.test/start') });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(loadURL).not.toHaveBeenCalled();

    // An external replacement URL navigates the live guest without remount.
    layoutsStore.set({ 'ws-shown': hiddenLayout('https://example.test/replaced') });
    await waitFor(() => expect(loadURL).toHaveBeenCalledWith('https://example.test/replaced'));
    // Still the same mounted element — frozen src, no remount.
    expect(webview.getAttribute('src')).toBe('https://example.test/start');
  });
});
