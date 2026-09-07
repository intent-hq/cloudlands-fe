import { runSaga, stdChannel } from 'redux-saga';
import { fork } from 'typed-redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection, getItems } from '@augmentcode/themis/utils/collections/collection-utils';

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
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
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
import {
  browserTabRegistrySaga,
  REPORT_DEBOUNCE_MS,
  SYNC_RETRY_MS,
} from './browser-tab-registry-saga';
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
  return { id: 'b1', type: 'browser', title: 'Example page', closable: true, ...overrides };
}

function settledLayout(
  tabs: PanelTab[],
  restoreStatus = 'restored' as const,
  hiddenTabs: PanelTab[] = [],
) {
  return {
    ...emptyWorkspaceState,
    root: { type: 'panel' as const, panelId: 'p1' },
    panels: { p1: { id: 'p1', tabs, activeTabId: tabs[0]?.id ?? null } },
    focusedPanelId: 'p1',
    restoreStatus,
    hiddenTabs: createCollection<PanelTab, 'id'>('id', hiddenTabs),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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
    hidden: (wsId = WS) => getItems(state.panelLayout.byWorkspaceId[wsId].hiddenTabs) as PanelTab[],
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
  title: 'Example page',
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
          row({ hostClientId: OTHER, url: 'http://a.test/moved', title: 'Example page' }),
        ),
      );
      await flush();
      expect(h.tabs()[0]).toMatchObject({ hostClientId: OTHER, browserUrl: 'http://a.test/moved' });
      expect(mocks.upsertTab).not.toHaveBeenCalled();

      h.dispatch(
        browserTabUpserted(
          WS,
          row({ hostClientId: OWN, url: 'http://a.test/back', title: 'Example page' }),
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

    it('ignores an own-host echo for a tab closed here until the daemon confirms the close', async () => {
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down' });
      h.setHealth('healthy', 1);
      h.dispatch(
        openTabInRightmostColumn(WS, browserTab({ browserUrl: 'http://a.test/' }), {
          newTabId: 'b1',
        }),
      );
      await flush();
      h.dispatch(closeTab(WS, 'b1', undefined, undefined, { destroy: true }));
      await flush();
      expect(mocks.removeTab.mock.calls).toEqual([['b1']]);

      // The daemon's tab-opened echo for the first report arrives after the close.
      h.dispatch(browserTabUpserted(WS, row({ hostClientId: OWN })));
      await flush();
      expect(h.tabs()).toEqual([]);
      await stop(h);
    });

    it('materialises an own-host row for a tab it does not hold (a locally closed mirror re-homed here)', async () => {
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down' });
      h.setHealth('healthy', 1);
      h.dispatch(
        browserTabUpserted(WS, row({ tabId: 'b2', hostClientId: OWN, title: 'Example page' })),
      );
      await flush();
      expect(h.tabs()).toEqual([expect.objectContaining({ id: 'b2', hostClientId: OWN })]);
      // The row is already what the daemon holds.
      expect(mocks.upsertTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('moves an existing tab between hidden and visible to match the row, without re-reporting it', async () => {
      const hiddenMirror = browserTab({
        hostClientId: OTHER,
        browserUrl: 'http://a.test/',
        ownerAgentId: 'agent-1',
      });
      const h = start({
        layouts: { [WS]: settledLayout([], 'restored', [hiddenMirror]) },
        health: 'down',
      });
      h.setHealth('healthy', 1);

      // Re-homed here as a visible tab: it must surface before the reporter
      // runs, or the host would overwrite the daemon with visibility: hidden.
      h.dispatch(
        browserTabUpserted(
          WS,
          row({ hostClientId: OWN, ownerAgentId: 'agent-1', title: 'Example page' }),
        ),
      );
      await flush();
      expect(h.tabs()).toEqual([expect.objectContaining({ id: 'b1', hostClientId: OWN })]);
      expect(h.hidden()).toEqual([]);
      expect(mocks.upsertTab).not.toHaveBeenCalled();

      h.dispatch(
        browserTabUpserted(
          WS,
          row({ hostClientId: OTHER, ownerAgentId: 'agent-1', visibility: 'hidden' }),
        ),
      );
      await flush();
      expect(h.tabs()).toEqual([]);
      expect(h.hidden()).toEqual([expect.objectContaining({ id: 'b1', hostClientId: OTHER })]);
      expect(mocks.upsertTab).not.toHaveBeenCalled();
      await stop(h);
    });
  });

  describe('races', () => {
    it('keeps a tab closed while the daemon was unreachable closed across the reconnect', async () => {
      const h = start({
        layouts: {
          [WS]: settledLayout([browserTab({ hostClientId: OWN, browserUrl: 'http://a.test/' })]),
        },
      });
      await flush();
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);

      h.setHealth('down', 1);
      h.dispatch(closeTab(WS, 'b1', undefined, undefined, { destroy: true }));
      await flush();
      expect(mocks.removeTab).not.toHaveBeenCalled();

      // The daemon still holds the row; the reconnect must not bring it back.
      mocks.listTabs.mockResolvedValue([row()]);
      h.setHealth('healthy', 2);
      h.dispatch(connectionStatusChanged('connected'));
      await flush();
      expect(h.tabs()).toEqual([]);
      expect(mocks.syncTabs.mock.calls[1]).toEqual([[]]);
      await stop(h);
    });

    it('re-reads a listing that raced browser:tab-closed instead of resurrecting the tab', async () => {
      const first = deferred<BrowserTabListing[]>();
      mocks.listTabs.mockReturnValueOnce(first.promise).mockResolvedValueOnce([]);
      const h = start({
        layouts: { [WS]: settledLayout([], 'pending' as never) },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(setRestoreStatus(WS, 'restored'));
      await flush(0);
      expect(mocks.listTabs).toHaveBeenCalledTimes(1);

      h.dispatch(browserTabClosed(WS, 'b2'));
      first.resolve([row({ tabId: 'b2', hostClientId: OTHER })]);
      await flush();
      expect(mocks.listTabs).toHaveBeenCalledTimes(2);
      expect(h.tabs()).toEqual([]);
      await stop(h);
    });

    it('lets a re-home that landed during the first upsertTab win over its reply', async () => {
      const reply = deferred<BrowserTab>();
      mocks.upsertTab.mockReturnValueOnce(reply.promise);
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down' });
      h.setHealth('healthy', 1);
      h.dispatch(
        openTabInRightmostColumn(WS, browserTab({ browserUrl: 'http://a.test/' }), {
          newTabId: 'b1',
        }),
      );
      await flush();
      expect(mocks.upsertTab).toHaveBeenCalledTimes(1);

      h.dispatch(browserTabUpserted(WS, row({ hostClientId: OTHER, title: 'Example page' })));
      await flush();
      expect(h.tabs()[0]).toMatchObject({ hostClientId: OTHER });

      reply.resolve(row({ hostClientId: OWN }));
      await flush();
      expect(h.tabs()[0]).toMatchObject({ hostClientId: OTHER });
      expect(mocks.upsertTab).toHaveBeenCalledTimes(1);
      await stop(h);
    });

    it('retries a connect-time sync whose listing failed instead of skipping the generation', async () => {
      mocks.listTabs.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
      const h = start({ layouts: { [WS]: settledLayout([]) } });
      await flush();
      expect(mocks.syncTabs).not.toHaveBeenCalled();

      await flush(SYNC_RETRY_MS);
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);
      await stop(h);
    });
  });

  describe('re-home, teardown and echo races', () => {
    it('follows the canonical URL and visibility of a mirror the daemon re-homed here while away', async () => {
      mocks.listTabs.mockResolvedValue([
        row({ url: 'http://a.test/new', ownerAgentId: 'agent-1', visibility: 'hidden' }),
      ]);
      const h = start({
        layouts: {
          [WS]: settledLayout([
            browserTab({
              hostClientId: OTHER,
              ownerAgentId: 'agent-1',
              browserUrl: 'http://a.test/stale',
            }),
          ]),
        },
      });
      await flush();

      expect(mocks.syncTabs.mock.calls[0][0][0]).toMatchObject({
        url: 'http://a.test/new',
        visibility: 'hidden',
      });
      expect(h.tabs()).toEqual([]);
      expect(h.hidden()[0]).toMatchObject({ hostClientId: OWN, browserUrl: 'http://a.test/new' });
      await stop(h);
    });

    it('does not undo a re-home with a late syncTabs acknowledgement of an unacknowledged tab', async () => {
      const ack = deferred<{ drop: string[] }>();
      mocks.syncTabs.mockReturnValueOnce(ack.promise);
      const h = start({
        layouts: { [WS]: settledLayout([browserTab({ browserUrl: 'http://a.test/' })]) },
      });
      await flush(0);
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);

      h.dispatch(browserTabUpserted(WS, row({ hostClientId: OTHER, ownerAgentId: 'agent-1' })));
      ack.resolve({ drop: [] });
      await flush();
      expect(h.tabs()[0]).toMatchObject({ hostClientId: OTHER });
      expect(mocks.upsertTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('does not resurrect a tab closed here when its echo lands inside the report debounce', async () => {
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down' });
      h.setHealth('healthy', 1);
      h.dispatch(
        openTabInRightmostColumn(WS, browserTab({ browserUrl: 'http://a.test/' }), {
          newTabId: 'b1',
        }),
      );
      await flush();
      expect(mocks.upsertTab).toHaveBeenCalledTimes(1);

      h.dispatch(closeTab(WS, 'b1', undefined, undefined, { destroy: true }));
      h.dispatch(browserTabUpserted(WS, row()));
      await flush();
      expect(h.tabs()).toEqual([]);
      expect(mocks.removeTab).toHaveBeenCalledWith('b1');
      await stop(h);
    });

    it('does not resurrect a tab closed here while its first upsertTab is still in flight', async () => {
      const reply = deferred<BrowserTab>();
      mocks.upsertTab.mockReturnValueOnce(reply.promise);
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down' });
      h.setHealth('healthy', 1);
      h.dispatch(
        openTabInRightmostColumn(WS, browserTab({ browserUrl: 'http://a.test/' }), {
          newTabId: 'b1',
        }),
      );
      await flush();
      expect(mocks.upsertTab).toHaveBeenCalledTimes(1);

      h.dispatch(closeTab(WS, 'b1', undefined, undefined, { destroy: true }));
      h.dispatch(browserTabUpserted(WS, row()));
      reply.resolve(row());
      await flush();
      expect(h.tabs()).toEqual([]);
      expect(mocks.removeTab).toHaveBeenCalledWith('b1');
      await stop(h);
    });

    it('discards a restore read the workspace teardown overtook, even though the revision is 0 again', async () => {
      const old = deferred<BrowserTabListing[]>();
      mocks.listTabs.mockReturnValueOnce(old.promise).mockResolvedValue([]);
      const h = start({
        layouts: { [WS]: settledLayout([], 'pending' as never) },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(setRestoreStatus(WS, 'empty'));
      await flush(0);

      h.dispatch(workspaceUnmounted(WS));
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
      old.resolve([row({ hostClientId: OTHER })]);
      await flush();
      expect(h.tabs()).toEqual([]);
      await stop(h);
    });

    it('does not read tabs that left the layout on unmount as closed when the workspace remounts', async () => {
      mocks.listTabs.mockResolvedValue([row()]);
      const h = start({
        layouts: { [WS]: settledLayout([browserTab({ browserUrl: 'http://a.test/' })]) },
      });
      await flush();
      expect(mocks.syncTabs.mock.calls[0][0]).toHaveLength(1);

      h.dispatch(workspaceUnmounted(WS));
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
      expect(h.tabs()[0]).toMatchObject({ id: 'b1', hostClientId: OWN });
      expect(mocks.removeTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('drops a cleared title and emulation instead of keeping the old host fields', async () => {
      const h = start({
        layouts: {
          [WS]: settledLayout([
            browserTab({
              hostClientId: OTHER,
              browserUrl: 'http://a.test/',
              title: 'Stale host title',
              emulatedSize: { width: 900, height: 700 },
              viewport: { mode: 'custom', width: 900, height: 700 },
            }),
          ]),
        },
      });
      h.dispatch(browserTabUpserted(WS, row({ title: undefined })));
      await flush();

      expect(h.tabs()[0].title).toBe('');
      expect(h.tabs()[0].viewport).toEqual({ mode: 'fit' });
      expect(h.tabs()[0]).not.toHaveProperty('emulatedSize');
      expect(mocks.upsertTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('reports a page title verbatim even when it equals the presentation fallback label', async () => {
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down' });
      h.setHealth('healthy', 1);
      h.dispatch(
        openTabInRightmostColumn(WS, browserTab({ browserUrl: 'http://a.test/' }), {
          newTabId: 'b1',
        }),
      );
      await flush();
      h.dispatch(updateTabTitle(WS, 'b1', 'Browser'));
      await flush();
      expect(mocks.upsertTab.mock.calls.at(-1)?.[1]).toEqual(expectedInput({ title: 'Browser' }));

      h.dispatch(updateTabTitle(WS, 'b1', ''));
      await flush();
      expect(mocks.upsertTab.mock.calls.at(-1)?.[1]).toEqual(expectedInput({ title: null }));
      await stop(h);
    });

    it('keeps a canonical title equal to the fallback label when a mirror is re-homed here', async () => {
      const h = start({
        layouts: {
          [WS]: settledLayout([browserTab({ hostClientId: OTHER, browserUrl: 'http://a.test/' })]),
        },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(browserTabUpserted(WS, row({ title: 'Browser' })));
      await flush();
      expect(h.tabs()[0]).toMatchObject({ hostClientId: OWN, title: 'Browser' });
      expect(mocks.upsertTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('restores a remounted workspace while the first upsertTab of its old layout is still in flight', async () => {
      const reply = deferred<BrowserTab>();
      mocks.upsertTab.mockReturnValueOnce(reply.promise);
      mocks.listTabs.mockResolvedValue([row()]);
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down' });
      h.setHealth('healthy', 1);
      h.dispatch(
        openTabInRightmostColumn(WS, browserTab({ browserUrl: 'http://a.test/' }), {
          newTabId: 'b1',
        }),
      );
      await flush();
      expect(mocks.upsertTab).toHaveBeenCalledTimes(1);

      h.dispatch(workspaceUnmounted(WS));
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
      reply.resolve(row());
      await flush();
      expect(h.tabs()).toHaveLength(1);
      expect(h.tabs()[0]).toMatchObject({ id: 'b1', hostClientId: OWN });
      expect(mocks.removeTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('re-reads a connect-time listing held past the workspace teardown instead of applying it', async () => {
      const SLOW = 'ws-slow';
      const slow = deferred<BrowserTabListing[]>();
      mocks.listTabs.mockImplementation((wsId: string) =>
        wsId === WS ? Promise.resolve([row({ hostClientId: OTHER })]) : slow.promise,
      );
      const h = start({
        layouts: { [WS]: settledLayout([]) },
        workspaceIds: [WS, SLOW],
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(connectionStatusChanged('connected'));
      await flush(0);
      expect(mocks.listTabs).toHaveBeenCalledWith(WS);

      h.dispatch(workspaceUnmounted(WS));
      h.dispatch(clearPanelLayout(WS));
      mocks.listTabs.mockImplementation((wsId: string) =>
        wsId === WS ? Promise.resolve([]) : slow.promise,
      );
      h.dispatch(
        initializeLayout(WS, {
          root: { type: 'panel', panelId: 'p1' },
          panels: { p1: { id: 'p1', tabs: [], activeTabId: null } },
          focusedPanelId: 'p1',
        }),
      );
      h.dispatch(setRestoreStatus(WS, 'restored'));
      await flush();
      expect(h.tabs()).toEqual([]);

      slow.resolve([]);
      await flush();
      expect(h.tabs()).toEqual([]);
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);
      await stop(h);
    });

    it('cancels the startup sync with the saga root instead of syncing after teardown', async () => {
      const listing = deferred<BrowserTabListing[]>();
      mocks.listTabs.mockReturnValueOnce(listing.promise);
      const h = start({ layouts: { [WS]: settledLayout([]) } });
      await flush(0);
      expect(mocks.listTabs).toHaveBeenCalledTimes(1);

      h.task.cancel();
      listing.resolve([row()]);
      await flush();
      expect(mocks.syncTabs).not.toHaveBeenCalled();
    });
  });
});
