/**
 * OffscreenWebviewHost (monorepo#2789 slice 2): mounts hidden webviews for
 * browser tabs of background workspaces, registers them for CDP on
 * dom-ready, drops them when the workspace is displayed again or its layout
 * state is removed (archive/delete), and enforces the LRU cap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

const {
  layoutsStore,
  ownClientIdStore,
  mountedLeasesStore,
  recoveryStore,
  navigationStore,
  dispatchMock,
} = vi.hoisted(() => {
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
    ownClientIdStore: miniWritable<string | null>('cli-own'),
    mountedLeasesStore: miniWritable<Record<string, Record<string, true>>>({}),
    recoveryStore: miniWritable<Record<string, string>>({}),
    navigationStore: miniWritable<Record<string, { url: string; kind: 'observed' | 'requested' }>>(
      {},
    ),
    dispatchMock: vi.fn(),
  };
});

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectPanelLayoutWorkspaces: () => layoutsStore,
}));

vi.mock('$store/renderer/slices/browser-clients/browser-clients-selectors', () => ({
  selectOwnClientId: () => ownClientIdStore,
}));

vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectMountedBrowserTabLeases: () => mountedLeasesStore,
  selectBrowserTabRecoveryRequests: () => recoveryStore,
  selectBrowserTabNavigations: () => navigationStore,
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
import {
  acquireBrowserTabMount,
  releaseBrowserTabMount,
  tabStateReducer,
} from '$store/renderer/slices/tab-state/tab-state-slice';

function browserLayout(tabs: Array<{ id: string; url?: string; hostClientId?: string }>) {
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
          ...(tab.hostClientId === undefined ? {} : { hostClientId: tab.hostClientId }),
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
    ownClientIdStore.set('cli-own');
    mountedLeasesStore.set({});
    recoveryStore.set({});
    navigationStore.set({});
    dispatchMock.mockClear();
    dispatchMock.mockImplementation((action) => {
      const initial = tabStateReducer(undefined, { type: '@@INIT' });
      const next = tabStateReducer(
        {
          ...initial,
          browserTabRecoveryRequests: recoveryStore.get(),
          browserTabNavigations: navigationStore.get(),
        },
        action,
      );
      if (next.browserTabNavigations !== navigationStore.get())
        navigationStore.set(next.browserTabNavigations);
      if (next.browserTabRecoveryRequests !== recoveryStore.get())
        recoveryStore.set(next.browserTabRecoveryRequests);
    });
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

  it.each([true, false])(
    'registers a hidden owned blank tab without revealing it (workspace displayed: %s)',
    async (displayed) => {
      const tab = {
        id: 'tab-blank',
        type: 'browser',
        browserUrl: 'about:blank',
        ownerAgentId: 'agent-1',
        hostClientId: 'cli-own',
      };
      layoutsStore.set({
        'ws-blank': {
          panels: {},
          hiddenTabs: { ids: [tab.id], map: { [tab.id]: tab } },
        },
      });
      const { container } = render(OffscreenWebviewHost, {
        excludedWorkspaceIds: new Set(displayed ? ['ws-blank'] : []),
        maxWebviews: 0,
      });
      await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-blank']));
      const webview = container.querySelector('webview')!;
      Object.assign(webview, { getWebContentsId: () => 91, getURL: () => 'about:blank' });
      await fireEvent(webview, new Event('dom-ready'));
      expect(invokeMock).toHaveBeenCalledExactlyOnceWith('browser:register-tab', {
        tabId: 'tab-blank',
        webContentsId: 91,
      });
      expect(dispatchMock).not.toHaveBeenCalled();
      recoveryStore.set({ 'tab-blank': 'explicit-navigation' });
      await waitFor(() => expect(recoveryStore.get()).toEqual({}));
      expect(container.querySelector('webview')).toBe(webview);
    },
  );

  it('keeps foreign-host blank tabs excluded and unowned blank tabs within the cache cap', async () => {
    const foreign = {
      id: 'tab-foreign',
      type: 'browser',
      browserUrl: 'about:blank',
      ownerAgentId: 'agent-1',
      hostClientId: 'cli-other',
    };
    layoutsStore.set({
      'ws-bg': browserLayout([
        { id: 'tab-blank', url: 'about:blank', hostClientId: 'cli-own' },
        { id: 'tab-capped', url: 'about:blank', hostClientId: 'cli-own' },
        { id: 'tab-mirror', url: 'about:blank', hostClientId: 'cli-other' },
      ]),
      'ws-shown': {
        panels: {},
        hiddenTabs: { ids: [foreign.id], map: { [foreign.id]: foreign } },
      },
    });
    const { container } = render(OffscreenWebviewHost, {
      excludedWorkspaceIds: new Set(['ws-shown']),
      maxWebviews: 1,
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-blank']));
    recoveryStore.set({
      'tab-foreign': 'explicit-navigation',
      'tab-mirror': 'explicit-navigation',
    });
    await waitFor(() => expect(recoveryStore.get()).toEqual({}));
    expect(mountedTabIds(container)).toEqual(['tab-blank']);
  });

  it('rejects other about URLs and blocked protocols for hidden and background tabs', async () => {
    const blocked = [
      'about:config',
      'about:srcdoc',
      'about:blank#fragment',
      'about:blank?query',
      'javascript:alert(1)',
      'data:text/html,hello',
      'chrome://settings',
      'not a url',
    ].map((url, index) => ({ id: `blocked-${index}`, url }));
    const hidden = blocked.map(({ id, url }) => ({
      id: `hidden-${id}`,
      type: 'browser',
      browserUrl: url,
      ownerAgentId: 'agent-1',
      hostClientId: 'cli-own',
    }));
    layoutsStore.set({
      'ws-bg': browserLayout([{ id: 'allowed' }, ...blocked]),
      'ws-shown': {
        panels: {},
        hiddenTabs: {
          ids: hidden.map((tab) => tab.id),
          map: Object.fromEntries(hidden.map((tab) => [tab.id, tab])),
        },
      },
    });
    const { container } = render(OffscreenWebviewHost, {
      excludedWorkspaceIds: new Set(['ws-shown']),
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['allowed']));
    recoveryStore.set(Object.fromEntries(hidden.map((tab) => [tab.id, 'explicit-navigation'])));
    await waitFor(() => expect(recoveryStore.get()).toEqual({}));
    expect(mountedTabIds(container)).toEqual(['allowed']);
  });

  it('replaces a dead guest only on request, registers the replacement and ignores its neutral URL', async () => {
    layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg' }]) });
    const { container } = render(OffscreenWebviewHost, { excludedWorkspaceIds: new Set() });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
    const old = container.querySelector('webview')!;
    Object.assign(old, {
      getWebContentsId: () => 10,
      getURL: () => {
        throw new Error('Invalid guestInstanceId: 10');
      },
    });
    await fireEvent(old, new Event('destroyed'));
    expect(container.querySelector('webview')).toBe(old);
    recoveryStore.set({ 'tab-bg': 'req-1' });
    await waitFor(() => expect(container.querySelector('webview')).not.toBe(old));
    const replacement = container.querySelector('webview')!;
    const loadURL = vi.fn().mockResolvedValue(undefined);
    let actualUrl = 'about:blank';
    Object.assign(replacement, {
      getWebContentsId: () => 11,
      getURL: () => actualUrl,
      loadURL,
    });
    await fireEvent(replacement, Object.assign(new Event('did-navigate'), { url: 'about:blank' }));
    await fireEvent(replacement, new Event('dom-ready'));
    expect(invokeMock).toHaveBeenCalledWith('browser:register-tab', {
      tabId: 'tab-bg',
      webContentsId: 11,
    });
    expect(loadURL).not.toHaveBeenCalled();
    expect(
      dispatchMock.mock.calls.filter(
        ([action]) => action.type === 'panelLayout/updateTabBrowserUrl',
      ),
    ).toEqual([]);
    actualUrl = 'https://example.test/recovered';
    replacement.dispatchEvent(Object.assign(new Event('did-navigate'), { url: actualUrl }));
    replacement.dispatchEvent(new Event('dom-ready'));
    expect(loadURL).not.toHaveBeenCalled();
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'panelLayout/updateTabBrowserUrl',
      payload: ['ws-bg', 'tab-bg', 'https://example.test/recovered'],
    });
    expect(recoveryStore.get()).toEqual({});
  });

  it('admits an evicted tab on explicit recovery without exceeding the unowned cap', async () => {
    const layout = browserLayout([{ id: 'tab-first' }, { id: 'tab-evicted' }]);
    layoutsStore.set({ 'ws-bg': layout });
    const { container } = render(OffscreenWebviewHost, {
      excludedWorkspaceIds: new Set(),
      maxWebviews: 1,
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-first']));
    recoveryStore.set({ 'tab-evicted': 'explicit-navigation' });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-evicted']));
    await waitFor(() => expect(recoveryStore.get()).toEqual({}));
    const admitted = container.querySelector('webview')!;
    Object.assign(admitted, {
      getWebContentsId: () => 14,
      getURL: () => 'https://example.test/tab-evicted',
    });
    await fireEvent(admitted, new Event('dom-ready'));
    expect(invokeMock).toHaveBeenCalledWith('browser:register-tab', {
      tabId: 'tab-evicted',
      webContentsId: 14,
    });
    layoutsStore.set({ 'ws-bg': { ...layout } });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-evicted']));
    expect(container.querySelector('webview')).toBe(admitted);
  });

  it('does not replace a live or still-attaching guest on a recovery request', async () => {
    layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg' }]) });
    const { container } = render(OffscreenWebviewHost, { excludedWorkspaceIds: new Set() });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
    const webview = container.querySelector('webview')!;
    recoveryStore.set({ 'tab-bg': 'attaching' });
    await waitFor(() => expect(recoveryStore.get()).toEqual({}));
    expect(container.querySelector('webview')).toBe(webview);
    Object.assign(webview, {
      getWebContentsId: () => 12,
      getURL: () => 'https://example.test/tab-bg',
    });
    recoveryStore.set({ 'tab-bg': 'live' });
    await waitFor(() => expect(recoveryStore.get()).toEqual({}));
    expect(container.querySelector('webview')).toBe(webview);
  });

  it.each(['did-navigate', 'did-navigate-in-page'])(
    'does not roll back %s before the saved URL reaches the action',
    async (eventType) => {
      const originalUrl = 'https://example.test/original';
      const navigatedUrl = 'https://example.test/navigated';
      layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg', url: originalUrl }]) });
      const { container } = render(OffscreenWebviewHost, { excludedWorkspaceIds: new Set() });
      await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
      const webview = container.querySelector('webview')!;
      let actualUrl = originalUrl;
      const loadURL = vi.fn().mockResolvedValue(undefined);
      Object.assign(webview, {
        getWebContentsId: () => 12,
        getURL: () => actualUrl,
        loadURL,
      });
      webview.dispatchEvent(new Event('dom-ready'));
      actualUrl = navigatedUrl;
      webview.dispatchEvent(
        Object.assign(new Event(eventType), { url: navigatedUrl, isMainFrame: true }),
      );
      // Electron may deliver dom-ready before Svelte propagates our dispatched URL.
      webview.dispatchEvent(new Event('dom-ready'));
      expect(loadURL).not.toHaveBeenCalled();
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'panelLayout/updateTabBrowserUrl',
        payload: ['ws-bg', 'tab-bg', navigatedUrl],
      });
      // Another selector can update the action while its URL prop is still stale.
      recoveryStore.set({ 'tab-bg': 'healthy-guest' });
      await waitFor(() => expect(recoveryStore.get()).toEqual({}));
      expect(loadURL).not.toHaveBeenCalled();
      layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg', url: navigatedUrl }]) });
      await fireEvent(webview, new Event('dom-ready'));
      expect(loadURL).not.toHaveBeenCalled();
      const externalUrl = 'https://example.test/external';
      layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg', url: externalUrl }]) });
      await waitFor(() => expect(loadURL).toHaveBeenCalledExactlyOnceWith(externalUrl));
    },
  );

  it.each([false, true])(
    'does not replay a main navigation before commit (hidden: %s)',
    async (hidden) => {
      const originalUrl = 'https://example.test/recovered';
      const nextUrl = 'https://example.test/second';
      const layout = (url: string) =>
        hidden
          ? {
              panels: {},
              hiddenTabs: {
                ids: ['tab-bg'],
                map: {
                  'tab-bg': {
                    id: 'tab-bg',
                    type: 'browser',
                    browserUrl: url,
                    ownerAgentId: 'agent-1',
                  },
                },
              },
            }
          : browserLayout([{ id: 'tab-bg', url }]);
      layoutsStore.set({ 'ws-bg': layout(originalUrl) });
      const { container } = render(OffscreenWebviewHost, { excludedWorkspaceIds: new Set() });
      await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
      const webview = container.querySelector('webview')!;
      let actualUrl = originalUrl;
      const loadURL = vi.fn().mockResolvedValue(undefined);
      Object.assign(webview, {
        getWebContentsId: () => 12,
        getURL: () => actualUrl,
        loadURL,
      });
      webview.dispatchEvent(new Event('dom-ready'));

      // Main has assigned location.href, but the response has not committed.
      // Its persisted-URL notification is an observation, not another request.
      navigationStore.set({ 'tab-bg': { url: nextUrl, kind: 'observed' } });
      layoutsStore.set({ 'ws-bg': layout(nextUrl) });
      await tick();
      expect(loadURL).not.toHaveBeenCalled();

      // A failed main load must not cause a passive renderer retry. An explicit
      // same-URL retry from main remains an observation here too.
      webview.dispatchEvent(
        Object.assign(new Event('did-fail-load'), { isMainFrame: true, errorCode: -105 }),
      );
      navigationStore.set({ 'tab-bg': { url: nextUrl, kind: 'observed' } });
      layoutsStore.set({ 'ws-bg': layout(nextUrl) });
      await tick();
      expect(navigationStore.get()).toEqual({});
      expect(loadURL).not.toHaveBeenCalled();
      layoutsStore.set({ 'ws-bg': layout(nextUrl) });
      await tick();
      expect(loadURL).not.toHaveBeenCalled();

      // A replacement command retries the same persisted URL after failure.
      // Its consumption and later layout updates must not repeat that load.
      navigationStore.set({ 'tab-bg': { url: nextUrl, kind: 'requested' } });
      layoutsStore.set({ 'ws-bg': layout(nextUrl) });
      await tick();
      expect(loadURL).toHaveBeenCalledExactlyOnceWith(nextUrl);
      expect(navigationStore.get()).toEqual({});
      layoutsStore.set({ 'ws-bg': layout(nextUrl) });
      await tick();
      expect(loadURL).toHaveBeenCalledTimes(1);
      actualUrl = nextUrl;
      webview.dispatchEvent(Object.assign(new Event('did-navigate'), { url: nextUrl }));
      webview.dispatchEvent(new Event('dom-ready'));
      expect(loadURL).toHaveBeenCalledTimes(1);
      loadURL.mockClear();

      // Deliberate external changes still navigate, including back to a URL
      // that was previously observed from main.
      const externalUrl = 'https://example.test/external';
      layoutsStore.set({ 'ws-bg': layout(externalUrl) });
      await waitFor(() => expect(loadURL).toHaveBeenCalledExactlyOnceWith(externalUrl));
      actualUrl = externalUrl;
      webview.dispatchEvent(Object.assign(new Event('did-navigate'), { url: externalUrl }));
      layoutsStore.set({ 'ws-bg': layout(nextUrl) });
      await waitFor(() => expect(loadURL).toHaveBeenCalledTimes(2));
      expect(loadURL).toHaveBeenLastCalledWith(nextUrl);
    },
  );

  it('discards recovery when the tab is removed before the request is rendered', async () => {
    layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg' }]) });
    const { container } = render(OffscreenWebviewHost, { excludedWorkspaceIds: new Set() });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
    recoveryStore.set({ 'tab-bg': 'req-removed' });
    layoutsStore.set({});
    await waitFor(() => expect(mountedTabIds(container)).toEqual([]));
    await waitFor(() => expect(recoveryStore.get()).toEqual({}));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('discards navigation intent for a permanently removed tab or visible guest', async () => {
    const shown = browserLayout([{ id: 'visible' }]);
    layoutsStore.set({ 'ws-shown': shown, 'ws-bg': browserLayout([{ id: 'removed' }]) });
    const { container } = render(OffscreenWebviewHost, {
      excludedWorkspaceIds: new Set(['ws-shown']),
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['removed']));
    navigationStore.set({
      visible: { url: 'https://example.test/visible', kind: 'observed' },
      removed: { url: 'https://example.test/removed', kind: 'requested' },
    });
    layoutsStore.set({ 'ws-shown': shown });
    await waitFor(() => expect(navigationStore.get()).toEqual({}));
    expect(mountedTabIds(container)).toEqual([]);
  });

  it('discards an unmountable recovery without bypassing the existing cache cap', async () => {
    layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg' }]) });
    const { container } = render(OffscreenWebviewHost, {
      excludedWorkspaceIds: new Set(),
      maxWebviews: 0,
    });
    recoveryStore.set({ 'tab-bg': 'req-capped' });
    await waitFor(() => expect(recoveryStore.get()).toEqual({}));
    expect(mountedTabIds(container)).toEqual([]);
  });

  it('mounts only tabs hosted by this client; mirrors mount once the host moves here', async () => {
    layoutsStore.set({
      'ws-bg': browserLayout([
        { id: 'tab-own', hostClientId: 'cli-own' },
        { id: 'tab-mirror', hostClientId: 'cli-other' },
        { id: 'tab-legacy' },
      ]),
    });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set() },
    });
    await waitFor(() => expect(mountedTabIds(container).sort()).toEqual(['tab-legacy', 'tab-own']));

    layoutsStore.set({
      'ws-bg': browserLayout([
        { id: 'tab-own', hostClientId: 'cli-own' },
        { id: 'tab-mirror', hostClientId: 'cli-own' },
        { id: 'tab-legacy' },
      ]),
    });
    await waitFor(() =>
      expect(mountedTabIds(container).sort()).toEqual(['tab-legacy', 'tab-mirror', 'tab-own']),
    );
  });

  it('excludes retained mounts, but hosts never-visited tabs and resumes after cache eviction', async () => {
    let state = tabStateReducer(undefined, acquireBrowserTabMount('tab-retained', 'mount-1'));
    mountedLeasesStore.set(state.mountedBrowserTabLeases);
    layoutsStore.set({
      'ws-bg': browserLayout([{ id: 'tab-retained' }, { id: 'tab-unvisited' }]),
    });
    const { container, rerender } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set(['ws-bg']) },
    });
    await rerender({ excludedWorkspaceIds: new Set() });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-unvisited']));
    const unvisited = container.querySelector('webview');

    state = tabStateReducer(state, releaseBrowserTabMount('tab-retained', 'mount-1'));
    mountedLeasesStore.set(state.mountedBrowserTabLeases);
    await waitFor(() =>
      expect(mountedTabIds(container).sort()).toEqual(['tab-retained', 'tab-unvisited']),
    );
    expect(container.querySelector('[data-offscreen-webview-tab="tab-unvisited"]')).toBe(unvisited);

    state = tabStateReducer(state, acquireBrowserTabMount('tab-retained', 'mount-2'));
    mountedLeasesStore.set(state.mountedBrowserTabLeases);
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-unvisited']));
  });

  it('waits for a panel mount to release before hosting a newly hidden owned tab', async () => {
    const state = tabStateReducer(undefined, acquireBrowserTabMount('tab-owned', 'mount-1'));
    mountedLeasesStore.set(state.mountedBrowserTabLeases);
    layoutsStore.set({
      'ws-shown': {
        panels: {},
        hiddenTabs: {
          ids: ['tab-owned'],
          map: {
            'tab-owned': {
              id: 'tab-owned',
              type: 'browser',
              browserUrl: 'https://example.test/owned',
              ownerAgentId: 'agent-1',
            },
          },
        },
      },
    });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set(['ws-shown']) },
    });
    expect(mountedTabIds(container)).toEqual([]);
    mountedLeasesStore.set(
      tabStateReducer(state, releaseBrowserTabMount('tab-owned', 'mount-1'))
        .mountedBrowserTabLeases,
    );
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-owned']));
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

  // Electron resolves every <webview> method against the element's cached
  // guest id and throws when it is unset or the guest is gone.
  const noGuest = () => {
    throw new Error('The WebView must be attached to the DOM');
  };

  // A guest that closes itself (window.close()) fires `destroyed`; the
  // action must survive it and release its registration gate so a
  // recreated guest's dom-ready registers again.
  it('releases the CDP registration gate when the guest is destroyed', async () => {
    layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg' }]) });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set() },
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
    const webview = container.querySelector(
      '[data-offscreen-webview-tab="tab-bg"]',
    ) as HTMLElement & {
      getWebContentsId?: () => number;
      getURL?: () => string;
    };
    const registerCalls = () =>
      invokeMock.mock.calls.filter(([channel]) => channel === 'browser:register-tab');

    webview.getWebContentsId = () => 77;
    webview.getURL = () => 'https://example.test/tab-bg';
    webview.dispatchEvent(new Event('dom-ready'));
    await waitFor(() => expect(registerCalls()).toHaveLength(1));

    webview.getURL = noGuest;
    expect(() => webview.dispatchEvent(new Event('destroyed'))).not.toThrow();

    // Same webContentsId on the next dom-ready: the gate was released, so
    // the guest registers again instead of being skipped as "same guest".
    webview.getURL = () => 'https://example.test/tab-bg';
    webview.dispatchEvent(new Event('dom-ready'));
    await waitFor(() =>
      expect(registerCalls()).toEqual([
        ['browser:register-tab', { tabId: 'tab-bg', webContentsId: 77 }],
        ['browser:register-tab', { tabId: 'tab-bg', webContentsId: 77 }],
      ]),
    );
  });

  // Reparenting fires the old guest's `destroyed` with no ordering guarantee
  // against the replacement's dom-ready; a live replacement must keep its
  // ready state so browserUrl updates keep navigating it.
  it('ignores a stale destroyed that arrives after the replacement guest is ready', async () => {
    layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg' }]) });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set() },
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
    const webview = container.querySelector(
      '[data-offscreen-webview-tab="tab-bg"]',
    ) as HTMLElement & {
      getWebContentsId?: () => number;
      getURL?: () => string;
      loadURL?: ReturnType<typeof vi.fn>;
    };
    const registerCalls = () =>
      invokeMock.mock.calls.filter(([channel]) => channel === 'browser:register-tab');

    webview.getWebContentsId = () => 78;
    webview.getURL = () => 'https://example.test/tab-bg';
    webview.loadURL = vi.fn().mockResolvedValue(undefined);
    webview.dispatchEvent(new Event('dom-ready'));
    await waitFor(() => expect(registerCalls()).toHaveLength(1));

    webview.dispatchEvent(new Event('destroyed'));

    layoutsStore.set({
      'ws-bg': browserLayout([{ id: 'tab-bg', url: 'https://example.test/next' }]),
    });
    await waitFor(() => expect(webview.loadURL).toHaveBeenCalledWith('https://example.test/next'));
    expect(registerCalls()).toHaveLength(1);
  });

  it('logs a destroyed guest URL without userinfo, query or fragment', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const closeUrl = 'https://u:pw@auth.example.test/cb?code=SECRETCODE&state=s1#access_token=TOK';
    layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg', url: closeUrl }]) });
    const { container } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set() },
    });
    await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
    const webview = container.querySelector(
      '[data-offscreen-webview-tab="tab-bg"]',
    ) as HTMLElement & { getURL?: () => string };

    webview.getURL = noGuest;
    webview.dispatchEvent(new Event('destroyed'));

    const logged = warn.mock.calls.find(([msg]) => String(msg).includes('guest was destroyed'));
    expect(logged).toBeDefined();
    expect((logged![1] as { url: string }).url).toBe('https://auth.example.test/cb');
    for (const call of warn.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain('SECRETCODE');
      expect(serialized).not.toContain('TOK');
      expect(serialized).not.toContain('u:pw');
    }
    warn.mockRestore();
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

    const inPage = new Event('did-navigate-in-page') as Event & {
      url?: string;
      isMainFrame?: boolean;
    };
    inPage.url = 'https://example.test/next#section';
    inPage.isMainFrame = true;
    webview.dispatchEvent(inPage);
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'panelLayout/updateTabBrowserUrl',
      payload: ['ws-bg', 'tab-bg', 'https://example.test/next#section'],
    });
  });

  // intent#4767: a hidden tab must not persist its iframe's URL as its own.
  it.each(['about:blank', 'https://iframe.test/widget#section'])(
    'ignores hidden-tab subframe in-page navigation to %s',
    async (url) => {
      const mainUrl = 'https://example.test/docs';
      layoutsStore.set({
        'ws-shown': {
          panels: {},
          hiddenTabs: {
            ids: ['tab-hidden'],
            map: {
              'tab-hidden': {
                id: 'tab-hidden',
                type: 'browser',
                title: 'Docs',
                browserUrl: mainUrl,
                ownerAgentId: 'agent-1',
              },
            },
          },
        },
      });
      const { container } = render(OffscreenWebviewHost, {
        props: { excludedWorkspaceIds: new Set(['ws-shown']) },
      });
      await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-hidden']));
      const webview = container.querySelector('[data-offscreen-webview-tab="tab-hidden"]')!;

      await fireEvent(
        webview,
        Object.assign(new Event('did-navigate-in-page'), { url, isMainFrame: false }),
      );
      expect(dispatchMock).not.toHaveBeenCalled();

      await fireEvent(
        webview,
        Object.assign(new Event('did-navigate-in-page'), {
          url: `${mainUrl}#next`,
          isMainFrame: true,
        }),
      );
      expect(dispatchMock).toHaveBeenCalledExactlyOnceWith({
        type: 'panelLayout/updateTabBrowserUrl',
        payload: ['ws-shown', 'tab-hidden', `${mainUrl}#next`],
      });
    },
  );

  it.each(['did-navigate', 'did-navigate-in-page'])(
    'persists deliberate main-frame blank navigation via %s',
    async (eventType) => {
      layoutsStore.set({ 'ws-bg': browserLayout([{ id: 'tab-bg' }]) });
      const { container } = render(OffscreenWebviewHost, {
        props: { excludedWorkspaceIds: new Set() },
      });
      await waitFor(() => expect(mountedTabIds(container)).toEqual(['tab-bg']));
      const webview = container.querySelector('[data-offscreen-webview-tab="tab-bg"]')!;

      await fireEvent(
        webview,
        Object.assign(new Event(eventType), { url: 'about:blank', isMainFrame: true }),
      );
      expect(dispatchMock).toHaveBeenCalledExactlyOnceWith({
        type: 'panelLayout/updateTabBrowserUrl',
        payload: ['ws-bg', 'tab-bg', 'about:blank'],
      });
    },
  );

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
