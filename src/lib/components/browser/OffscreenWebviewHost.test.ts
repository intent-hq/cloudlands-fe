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
    const webview = container.querySelector('[data-offscreen-webview-tab="tab-bg"]') as HTMLElement & {
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

  it('unmounts a tab when its workspace becomes displayed and when its layout is removed', async () => {
    layoutsStore.set({
      'ws-a': browserLayout([{ id: 'tab-a' }]),
      'ws-b': browserLayout([{ id: 'tab-b' }]),
    });
    const { container, rerender } = render(OffscreenWebviewHost, {
      props: { excludedWorkspaceIds: new Set() },
    });
    await waitFor(() =>
      expect(mountedTabIds(container).sort()).toEqual(['tab-a', 'tab-b']),
    );

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
});
