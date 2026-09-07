import { runSaga, stdChannel } from 'redux-saga';
import { fork } from 'typed-redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({
  listTabs: vi.fn(),
  upsertTab: vi.fn(),
  removeTab: vi.fn(),
  syncTabs: vi.fn(),
  resolveBrowserLinkUrl: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    browser: {
      listTabs: mocks.listTabs,
      upsertTab: mocks.upsertTab,
      removeTab: mocks.removeTab,
      syncTabs: mocks.syncTabs,
    },
  },
}));
vi.mock('$lib/utils/browser-url-resolution', () => ({
  resolveBrowserLinkUrl: mocks.resolveBrowserLinkUrl,
}));

import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { BrowserTab, BrowserTabListing } from '$shared/types/browser-clients';
import type { StoreAction } from '@augmentcode/themis/utils/store/create-action';
import {
  browserClientsReducer,
  browserTabClosed,
  browserTabUpserted,
  initialState as browserClientsInitialState,
  ownClientIdReceived,
} from '../../browser-clients/browser-clients-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import {
  clearPanelLayout,
  closeTab,
  emptyWorkspaceState,
  initializeLayout,
  openTabInRightmostColumn,
  panelLayoutReducer,
  setRestoreStatus,
  updateTabBrowserUrl,
  updateTabTitle,
} from '../panel-layout-slice';
import type { PanelTab } from '../panel-layout-types';
import { browserTabRegistrySaga, REPORT_DEBOUNCE_MS } from './browser-tab-registry-saga';
import { watchRightmostColumnRequests } from './panel-layout-saga';

const WS = 'ws-1';
const OWN = 'cli-desk';
const OTHER = 'cli-laptop';
const NOW = '2026-09-07T00:00:00.000Z';

function row(overrides: Partial<BrowserTab> = {}): BrowserTabListing {
  return {
    tabId: 'b1',
    workspaceId: WS,
    hostClientId: OWN,
    url: 'http://a.test/',
    visibility: 'visible',
    createdAt: NOW,
    updatedAt: NOW,
    hostConnected: true,
    ...overrides,
  };
}

function browserTab(overrides: Partial<PanelTab> = {}): PanelTab {
  return { id: 'b1', type: 'browser', title: 'Browser', closable: true, ...overrides };
}

function settledLayout(tabs: PanelTab[], restoreStatus = 'restored' as const) {
  return {
    ...emptyWorkspaceState,
    root: { type: 'panel' as const, panelId: 'p1' },
    panels: { p1: { id: 'p1', tabs, activeTabId: tabs[0]?.id ?? null } },
    focusedPanelId: 'p1',
    restoreStatus,
  };
}

type Harness = ReturnType<typeof start>;

function start(
  opts: {
    layouts?: Record<string, ReturnType<typeof settledLayout>>;
    ownClientId?: string | null;
    health?: 'healthy' | 'down';
    workspaceIds?: string[];
  } = {},
) {
  const channel = stdChannel();
  let state: any = {
    panelLayout: { byWorkspaceId: opts.layouts ?? {} },
    browserClients: {
      ...browserClientsInitialState,
      ownClientId: opts.ownClientId === undefined ? OWN : opts.ownClientId,
    },
    daemonHealth: { health: opts.health ?? 'healthy', connectionGeneration: 1 },
    connections: { activeId: LOCAL_CONNECTION_ID, windowBackendId: LOCAL_CONNECTION_ID },
    workspace: {
      workspaces: createCollection(
        'id',
        (opts.workspaceIds ?? Object.keys(opts.layouts ?? {})).map((id) => ({ id })),
      ),
      hasLoaded: true,
      loadedBackendId: LOCAL_CONNECTION_ID,
    },
  };
  const dispatched: StoreAction<unknown>[] = [];
  const dispatch = (action: StoreAction<unknown>) => {
    state = {
      ...state,
      panelLayout: panelLayoutReducer(state.panelLayout, action),
      browserClients: browserClientsReducer(state.browserClients, action),
    };
    dispatched.push(action);
    channel.put(action);
  };
  // The rightmost-column router lives in panelLayoutSaga; materialised rows
  // go through it exactly as agent opens do.
  const task = runSaga({ channel, dispatch, getState: () => state }, function* root() {
    yield* fork(watchRightmostColumnRequests);
    yield* fork(browserTabRegistrySaga);
  });
  return {
    task,
    dispatch,
    dispatched,
    ofType: (type: string) => dispatched.filter((a) => a.type === type),
    tabs: (wsId = WS) =>
      Object.values(state.panelLayout.byWorkspaceId[wsId]?.panels ?? {}).flatMap(
        (panel: any) => panel.tabs as PanelTab[],
      ),
    setHealth: (health: 'healthy' | 'down', connectionGeneration: number) => {
      state = { ...state, daemonHealth: { health, connectionGeneration } };
    },
  };
}

async function flush(ms = REPORT_DEBOUNCE_MS) {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.advanceTimersByTimeAsync(0);
}

async function stop(h: Harness) {
  h.task.cancel();
  await flush(0);
}

const expectedInput = (overrides: Record<string, unknown> = {}) => ({
  tabId: 'b1',
  url: 'http://a.test/',
  requestedUrl: null,
  title: 'Browser',
  ownerAgentId: null,
  ownerAgentName: null,
  visibility: 'visible',
  emulatedSize: null,
  ...overrides,
});

describe('browserTabRegistrySaga', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.listTabs.mockResolvedValue([]);
    mocks.syncTabs.mockResolvedValue({ drop: [] });
    mocks.removeTab.mockResolvedValue({ ok: true });
    mocks.upsertTab.mockImplementation(async (workspaceId: string, tab: { tabId: string }) =>
      row({ ...tab, workspaceId }),
    );
    mocks.resolveBrowserLinkUrl.mockImplementation(async (url: string) => ({ url }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('host reporting', () => {
    it('reports a newly opened hosted tab with browser.upsertTab and records the host', async () => {
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down' });
      h.setHealth('healthy', 1);
      h.dispatch(
        openTabInRightmostColumn(WS, browserTab({ browserUrl: 'http://a.test/' }), {
          newTabId: 'b1',
        }),
      );
      await flush();

      expect(mocks.upsertTab.mock.calls).toEqual([[WS, expectedInput()]]);
      expect(h.tabs()[0]).toMatchObject({ id: 'b1', hostClientId: OWN });
      await stop(h);
    });

    it('coalesces a navigation burst into one report and ignores the canonical echo', async () => {
      const h = start({
        layouts: { [WS]: settledLayout([browserTab({ browserUrl: 'http://a.test/' })]) },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(updateTabBrowserUrl(WS, 'b1', 'http://a.test/one'));
      h.dispatch(updateTabTitle(WS, 'b1', 'One'));
      h.dispatch(updateTabBrowserUrl(WS, 'b1', 'http://a.test/two'));
      await flush();
      expect(mocks.upsertTab.mock.calls).toEqual([
        [WS, expectedInput({ url: 'http://a.test/two', title: 'One' })],
      ]);

      h.dispatch(browserTabUpserted(WS, row({ url: 'http://a.test/two', title: 'One' })));
      await flush();
      expect(mocks.upsertTab).toHaveBeenCalledTimes(1);
      expect(h.tabs()[0]).toMatchObject({ browserUrl: 'http://a.test/two', hostClientId: OWN });
      await stop(h);
    });

    it('reports a hidden owned tab as hidden and a destroyed tab with browser.removeTab', async () => {
      const h = start({
        layouts: {
          [WS]: settledLayout([
            browserTab({ browserUrl: 'http://a.test/', ownerAgentId: 'agent-1' }),
            { id: 'n1', type: 'note', title: 'Note', closable: true },
          ]),
        },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(closeTab(WS, 'b1', 'p1', 1000));
      await flush();
      expect(mocks.upsertTab.mock.calls).toEqual([
        [WS, expectedInput({ ownerAgentId: 'agent-1', visibility: 'hidden' })],
      ]);

      h.dispatch(closeTab(WS, 'b1', undefined, 2000, { destroy: true }));
      await flush();
      expect(mocks.removeTab.mock.calls).toEqual([['b1']]);
      expect(mocks.upsertTab).toHaveBeenCalledTimes(1);
      await stop(h);
    });

    it('does not report tabs hosted elsewhere or geometry-only shells', async () => {
      const h = start({
        layouts: {
          [WS]: settledLayout([
            browserTab({ id: 'mirror', hostClientId: OTHER, browserUrl: 'http://m.test/' }),
            browserTab({ id: 'shell', hostClientId: OWN }),
          ]),
        },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(updateTabTitle(WS, 'mirror', 'Renamed'));
      await flush();
      expect(mocks.upsertTab).not.toHaveBeenCalled();
      await stop(h);
    });
  });

  describe('restore from the registry', () => {
    it('fills geometry-only tabs from browser.listTabs and materialises rows with no local tab', async () => {
      mocks.listTabs.mockResolvedValue([
        row({
          url: 'http://a.test/restored',
          title: 'Restored',
          requestedUrl: 'http://localhost:1/',
        }),
        row({ tabId: 'b2', hostClientId: OTHER, url: 'http://m.test/', title: 'Mirror' }),
      ]);
      // The tunnel still resolves to the stored URL: nothing to re-resolve.
      mocks.resolveBrowserLinkUrl.mockResolvedValue({ url: 'http://a.test/restored' });
      const h = start({
        layouts: { [WS]: settledLayout([browserTab({ hostClientId: OWN })], 'pending' as never) },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(setRestoreStatus(WS, 'restored'));
      await flush();

      expect(mocks.listTabs.mock.calls).toEqual([[WS]]);
      expect(h.tabs()).toEqual([
        expect.objectContaining({
          id: 'b1',
          hostClientId: OWN,
          browserUrl: 'http://a.test/restored',
          browserRequestedUrl: 'http://localhost:1/',
          title: 'Restored',
        }),
        expect.objectContaining({
          id: 'b2',
          type: 'browser',
          hostClientId: OTHER,
          browserUrl: 'http://m.test/',
          title: 'Mirror',
        }),
      ]);
      // Rows applied from the registry are already what the daemon holds.
      expect(mocks.upsertTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('destroys acknowledged local tabs the registry no longer holds and migrates legacy ones', async () => {
      const h = start({
        layouts: {
          [WS]: settledLayout(
            [
              browserTab({ id: 'gone', hostClientId: OWN }),
              browserTab({ id: 'legacy', browserUrl: 'http://legacy.test/' }),
            ],
            'pending' as never,
          ),
        },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(setRestoreStatus(WS, 'restored'));
      await flush();

      expect(h.tabs().map((t) => t.id)).toEqual(['legacy']);
      expect(mocks.upsertTab.mock.calls).toEqual([
        [WS, expectedInput({ tabId: 'legacy', url: 'http://legacy.test/' })],
      ]);
      expect(h.tabs()[0]).toMatchObject({ hostClientId: OWN });
      await stop(h);
    });

    it('forgets acknowledged tabs the listing no longer holds instead of removing them later', async () => {
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down' });
      h.setHealth('healthy', 1);
      h.dispatch(
        openTabInRightmostColumn(WS, browserTab({ browserUrl: 'http://a.test/' }), {
          newTabId: 'b1',
        }),
      );
      await flush();
      expect(mocks.upsertTab).toHaveBeenCalledTimes(1);

      // The layout is torn down and rebuilt (unmount → remount) while the
      // daemon, in the meantime, dropped the tab.
      h.dispatch(clearPanelLayout(WS));
      h.dispatch(
        initializeLayout(WS, {
          root: { type: 'panel', panelId: 'p1' },
          panels: { p1: { id: 'p1', tabs: [], activeTabId: null } },
          focusedPanelId: 'p1',
        }),
      );
      h.dispatch(setRestoreStatus(WS, 'restored'));
      await flush();
      h.dispatch(updateTabTitle(WS, 'none', 'noop'));
      await flush();
      expect(mocks.removeTab).not.toHaveBeenCalled();
      await stop(h);
    });
  });

  describe('connect / reconnect', () => {
    it('sends one browser.syncTabs snapshot covering settled and unsettled workspaces, then applies drop', async () => {
      mocks.listTabs.mockImplementation(async (wsId: string) =>
        wsId === 'ws-2'
          ? [row({ tabId: 'remote-own', workspaceId: 'ws-2', url: 'http://r.test/' })]
          : [row({ url: 'http://a.test/' })],
      );
      mocks.syncTabs.mockResolvedValue({ drop: ['b1'] });
      const h = start({
        layouts: {
          [WS]: settledLayout([
            browserTab({ hostClientId: OWN, browserUrl: 'http://a.test/' }),
            browserTab({ id: 'legacy', browserUrl: 'http://legacy.test/' }),
          ]),
        },
        workspaceIds: [WS, 'ws-2'],
      });
      await flush();

      expect(mocks.syncTabs.mock.calls).toEqual([
        [
          [
            { ...expectedInput(), workspaceId: WS },
            { ...expectedInput({ tabId: 'legacy', url: 'http://legacy.test/' }), workspaceId: WS },
            {
              ...expectedInput({ tabId: 'remote-own', url: 'http://r.test/', title: null }),
              workspaceId: 'ws-2',
            },
          ],
        ],
      ]);
      expect(h.tabs().map((t) => t.id)).toEqual(['legacy']);
      expect(h.tabs()[0]).toMatchObject({ hostClientId: OWN });
      // The snapshot already reported everything: no point upserts follow.
      expect(mocks.upsertTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('re-syncs on a new connection generation only', async () => {
      const h = start({ layouts: { [WS]: settledLayout([]) } });
      await flush();
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);

      h.dispatch(connectionStatusChanged('connected'));
      await flush();
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);

      h.setHealth('healthy', 2);
      h.dispatch(connectionStatusChanged('connected'));
      await flush();
      expect(mocks.syncTabs).toHaveBeenCalledTimes(2);
      await stop(h);
    });

    it('waits for the own clientId before reporting anything', async () => {
      const h = start({
        layouts: { [WS]: settledLayout([browserTab({ browserUrl: 'http://a.test/' })]) },
        ownClientId: null,
      });
      await flush();
      expect(mocks.syncTabs).not.toHaveBeenCalled();
      expect(mocks.upsertTab).not.toHaveBeenCalled();

      h.dispatch(ownClientIdReceived(OWN));
      await flush();
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);
      await stop(h);
    });
  });

  describe('browser:tab-* events', () => {
    it('re-homes a tab to a mirror when the daemon names another host, and back to live', async () => {
      const h = start({
        layouts: {
          [WS]: settledLayout([browserTab({ hostClientId: OWN, browserUrl: 'http://a.test/' })]),
        },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(
        browserTabUpserted(
          WS,
          row({ hostClientId: OTHER, url: 'http://a.test/moved', title: 'Browser' }),
        ),
      );
      await flush();
      expect(h.tabs()[0]).toMatchObject({ hostClientId: OTHER, browserUrl: 'http://a.test/moved' });
      expect(mocks.upsertTab).not.toHaveBeenCalled();

      h.dispatch(
        browserTabUpserted(
          WS,
          row({ hostClientId: OWN, url: 'http://a.test/back', title: 'Browser' }),
        ),
      );
      await flush();
      expect(h.tabs()[0]).toMatchObject({ hostClientId: OWN, browserUrl: 'http://a.test/back' });
      expect(mocks.upsertTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('materialises a remote row as a mirror and destroys the local tab on tab-closed', async () => {
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down' });
      h.setHealth('healthy', 1);
      h.dispatch(
        browserTabUpserted(WS, row({ tabId: 'b2', hostClientId: OTHER, url: 'http://m.test/' })),
      );
      await flush();
      expect(h.tabs()).toEqual([
        expect.objectContaining({ id: 'b2', hostClientId: OTHER, browserUrl: 'http://m.test/' }),
      ]);

      h.dispatch(browserTabClosed(WS, 'b2'));
      await flush();
      expect(h.tabs()).toEqual([]);
      expect(mocks.removeTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('ignores an own-host echo for a tab already closed here', async () => {
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down' });
      h.setHealth('healthy', 1);
      h.dispatch(browserTabUpserted(WS, row({ tabId: 'stale', hostClientId: OWN })));
      await flush();
      expect(h.tabs()).toEqual([]);
      await stop(h);
    });
  });
});
