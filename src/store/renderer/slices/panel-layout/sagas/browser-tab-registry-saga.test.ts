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
import {
  browserTabRegistryReducer,
  initialState as browserTabRegistryInitialState,
  registryApplied,
  registryLoading,
} from '../../browser-tab-registry/browser-tab-registry-slice';
import type { BrowserTabRegistryState } from '../../browser-tab-registry/browser-tab-registry-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearPanelLayout,
  closeTab,
  emptyWorkspaceState,
  initializeLayout,
  openTabInRightmostColumn,
  openTabInRightmostColumnRequested,
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

/**
 * The registry state after the workspaces were loaded once (generation 1,
 * `applied`, nothing reported) — what a completed load leaves behind, built
 * through the production reducer.
 */
function appliedRegistry(wsIds: string[]): BrowserTabRegistryState {
  return wsIds.reduce(
    (state, wsId) =>
      browserTabRegistryReducer(
        browserTabRegistryReducer(state, registryLoading(wsId)),
        registryApplied(wsId, 1, {}),
      ),
    browserTabRegistryInitialState,
  );
}

function start(
  opts: {
    layouts?: Record<string, ReturnType<typeof settledLayout>>;
    ownClientId?: string | null;
    health?: 'healthy' | 'down';
    workspaceIds?: string[];
    /** Start with every layout already loaded from the registry (see `appliedRegistry`). */
    applied?: boolean;
  } = {},
) {
  const channel = stdChannel();
  let state: any = {
    panelLayout: { byWorkspaceId: opts.layouts ?? {} },
    browserTabRegistry: opts.applied
      ? appliedRegistry(Object.keys(opts.layouts ?? {}))
      : browserTabRegistryInitialState,
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
  let afterDispatch: ((action: StoreAction<unknown>) => void) | null = null;
  const dispatch = (action: StoreAction<unknown>) => {
    state = {
      ...state,
      panelLayout: panelLayoutReducer(state.panelLayout, action),
      browserTabRegistry: browserTabRegistryReducer(state.browserTabRegistry, action),
      browserClients: browserClientsReducer(state.browserClients, action),
    };
    dispatched.push(action);
    channel.put(action);
    afterDispatch?.(action);
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
    registry: (wsId = WS) => state.browserTabRegistry.byWorkspaceId[wsId],
    closing: () => state.browserTabRegistry.closing as Record<string, string>,
    setHealth: (health: 'healthy' | 'down', connectionGeneration: number) => {
      state = { ...state, daemonHealth: { health, connectionGeneration } };
    },
    /** Run `fn` right after each dispatch reached the reducers and the sagas. */
    onDispatched: (fn: ((action: StoreAction<unknown>) => void) | null) => {
      afterDispatch = fn;
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
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down', applied: true });
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
        applied: true,
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
        applied: true,
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
        applied: true,
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
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down', applied: true });
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
        applied: true,
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
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down', applied: true });
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
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down', applied: true });
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
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down', applied: true });
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
        applied: true,
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
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down', applied: true });
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
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down', applied: true });
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
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down', applied: true });
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
        health: 'down',
        applied: true,
      });
      h.setHealth('healthy', 1);
      h.dispatch(browserTabUpserted(WS, row({ title: undefined })));
      await flush();

      expect(h.tabs()[0].title).toBe('');
      expect(h.tabs()[0].viewport).toEqual({ mode: 'fit' });
      expect(h.tabs()[0]).not.toHaveProperty('emulatedSize');
      expect(mocks.upsertTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('reports a page title verbatim even when it equals the presentation fallback label', async () => {
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down', applied: true });
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
        applied: true,
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
      const h = start({ layouts: { [WS]: settledLayout([]) }, health: 'down', applied: true });
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
      expect(mocks.listTabs).toHaveBeenCalledTimes(3);

      // The held listing predates the teardown: the attempt is abandoned and
      // the retry re-reads the workspace instead of applying the stale rows.
      slow.resolve([]);
      await flush();
      expect(h.tabs()).toEqual([]);
      expect(mocks.syncTabs).not.toHaveBeenCalled();
      await flush(SYNC_RETRY_MS);
      expect(mocks.listTabs).toHaveBeenCalledTimes(5);
      expect(h.tabs()).toEqual([]);
      expect(mocks.syncTabs.mock.calls).toEqual([[[]]]);
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

  describe('generation fencing and snapshot safety', () => {
    const SLOW = 'ws-slow';
    const remount = (h: Harness) => {
      h.dispatch(
        initializeLayout(WS, {
          root: { type: 'panel', panelId: 'p1' },
          panels: { p1: { id: 'p1', tabs: [], activeTabId: null } },
          focusedPanelId: 'p1',
        }),
      );
      h.dispatch(setRestoreStatus(WS, 'restored'));
    };
    const teardown = (h: Harness) => {
      h.dispatch(workspaceUnmounted(WS));
      h.dispatch(clearPanelLayout(WS));
    };

    it('includes a daemon-restored own tab in the very first connect snapshot', async () => {
      mocks.listTabs.mockResolvedValue([row()]);
      const h = start({ layouts: { [WS]: settledLayout([]) } });
      await flush();
      expect(h.tabs()).toEqual([expect.objectContaining({ id: 'b1', hostClientId: OWN })]);
      expect(mocks.syncTabs.mock.calls).toEqual([
        [[expect.objectContaining({ tabId: 'b1', url: 'http://a.test/' })]],
      ]);
      expect(mocks.upsertTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('preserves a close made while the daemon was down through a failed sync and its retry', async () => {
      mocks.listTabs.mockResolvedValue([row()]);
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
      mocks.syncTabs
        .mockRejectedValueOnce(new Error('network outage'))
        .mockResolvedValue({ drop: [] });
      h.setHealth('healthy', 2);
      h.dispatch(connectionStatusChanged('connected'));
      await flush(SYNC_RETRY_MS + REPORT_DEBOUNCE_MS);

      expect(mocks.syncTabs.mock.calls.slice(1)).toEqual([[[]], [[]]]);
      expect(h.tabs()).toEqual([]);
      await stop(h);
    });

    it('does not acknowledge a tab closed before the syncTabs reply lands', async () => {
      const ack = deferred<{ drop: string[] }>();
      mocks.syncTabs.mockReturnValueOnce(ack.promise);
      const h = start({
        layouts: { [WS]: settledLayout([browserTab({ browserUrl: 'http://a.test/' })]) },
      });
      await flush(0);
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);

      h.dispatch(closeTab(WS, 'b1', undefined, undefined, { destroy: true }));
      ack.resolve({ drop: [] });
      await flush();
      expect(h.tabs()).toEqual([]);
      expect(mocks.removeTab).toHaveBeenCalledWith('b1');
      await stop(h);
    });

    it('discards both obsolete reads after a rapid unmount, remount, unmount, remount', async () => {
      const first = deferred<BrowserTabListing[]>();
      const second = deferred<BrowserTabListing[]>();
      mocks.listTabs
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
        .mockResolvedValue([]);
      const h = start({
        layouts: { [WS]: settledLayout([], 'pending' as never) },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(setRestoreStatus(WS, 'restored'));
      await flush(0);
      teardown(h);
      remount(h);
      await flush(0);
      teardown(h);
      remount(h);
      await flush(0);
      expect(mocks.listTabs).toHaveBeenCalledTimes(3);

      second.resolve([row({ tabId: 'second-old', hostClientId: OTHER })]);
      first.resolve([row({ tabId: 'first-old', hostClientId: OTHER })]);
      await flush();
      expect(h.tabs()).toEqual([]);
      expect(mocks.upsertTab).not.toHaveBeenCalled();
      expect(mocks.syncTabs).not.toHaveBeenCalled();
      await stop(h);
    });

    it('applies the fresh row, not the stale one, when a torn-down connect listing is re-read', async () => {
      const slow = deferred<BrowserTabListing[]>();
      mocks.listTabs.mockImplementation((wsId: string) =>
        wsId === WS ? Promise.resolve([row({ url: 'http://a.test/old' })]) : slow.promise,
      );
      const h = start({
        layouts: { [WS]: settledLayout([]) },
        workspaceIds: [WS, SLOW],
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(connectionStatusChanged('connected'));
      await flush(0);
      expect(h.tabs()[0]).toMatchObject({ id: 'b1', browserUrl: 'http://a.test/old' });

      h.setHealth('down', 1);
      teardown(h);
      remount(h);
      mocks.listTabs.mockImplementation((wsId: string) =>
        wsId === WS ? Promise.resolve([row({ url: 'http://a.test/fresh' })]) : slow.promise,
      );
      h.setHealth('healthy', 1);
      slow.resolve([]);
      await flush(SYNC_RETRY_MS);

      expect(h.tabs()).toEqual([expect.objectContaining({ browserUrl: 'http://a.test/fresh' })]);
      expect(mocks.syncTabs.mock.calls).toEqual([
        [[expect.objectContaining({ tabId: 'b1', url: 'http://a.test/fresh' })]],
      ]);
      await stop(h);
    });

    it.each(['teardown', 'failure'] as const)(
      'never sends a destructive empty snapshot when a re-read ends in %s',
      async (outcome) => {
        const slow = deferred<BrowserTabListing[]>();
        const reread = deferred<BrowserTabListing[]>();
        let reads = 0;
        mocks.listTabs.mockImplementation((wsId: string) => {
          if (wsId !== WS) return slow.promise;
          reads++;
          if (reads === 1) return Promise.resolve([row()]);
          if (outcome === 'failure') return Promise.reject(new Error('listing unavailable'));
          return reread.promise;
        });
        const h = start({
          layouts: { [WS]: settledLayout([]) },
          workspaceIds: [WS, SLOW],
          health: 'down',
        });
        h.setHealth('healthy', 1);
        h.dispatch(connectionStatusChanged('connected'));
        await flush(0);
        expect(h.tabs()).toHaveLength(1);

        h.setHealth('down', 1);
        teardown(h);
        remount(h);
        h.setHealth('healthy', 1);
        slow.resolve([]);
        await flush(SYNC_RETRY_MS);
        expect(reads).toBe(2);
        if (outcome === 'teardown') {
          teardown(h);
          reread.resolve([row()]);
        }
        await flush(SYNC_RETRY_MS);
        await flush(SYNC_RETRY_MS);

        expect(mocks.removeTab).not.toHaveBeenCalled();
        expect(mocks.syncTabs.mock.calls).not.toContainEqual([[]]);
        if (outcome === 'teardown') {
          // The torn-down workspace's rows pass through verbatim once it is unsettled.
          expect(mocks.syncTabs.mock.calls).toEqual([
            [[expect.objectContaining({ tabId: 'b1', url: 'http://a.test/' })]],
          ]);
        } else {
          expect(mocks.syncTabs).not.toHaveBeenCalled();
        }
        await stop(h);
      },
    );

    it('revalidates a passed-through unsettled listing that settled and reported a tab meanwhile', async () => {
      const slow = deferred<BrowserTabListing[]>();
      let rows: BrowserTabListing[] = [];
      mocks.listTabs.mockImplementation((wsId: string) =>
        wsId === SLOW ? slow.promise : Promise.resolve(rows),
      );
      const h = start({
        layouts: { [WS]: settledLayout([], 'pending' as never), [SLOW]: settledLayout([]) },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(connectionStatusChanged('connected'));
      await flush(0);
      expect(mocks.listTabs).toHaveBeenCalledWith(WS);

      // The workspace settles and reports a new tab while the other listing is held.
      remount(h);
      await flush(0);
      h.dispatch(
        openTabInRightmostColumn(WS, browserTab({ browserUrl: 'http://a.test/' }), {
          newTabId: 'b1',
        }),
      );
      await flush();
      expect(mocks.upsertTab.mock.calls).toEqual([[WS, expectedInput()]]);
      rows = [row()];

      slow.resolve([]);
      await flush();
      expect(mocks.syncTabs).not.toHaveBeenCalled();
      await flush(SYNC_RETRY_MS);
      expect(mocks.syncTabs.mock.calls).toEqual([[[expect.objectContaining({ tabId: 'b1' })]]]);
      expect(h.tabs()).toEqual([expect.objectContaining({ id: 'b1', hostClientId: OWN })]);
      await stop(h);
    });

    it('does not report a torn-down layout after a removal reply held past its remount', async () => {
      const removal = deferred<{ ok: true }>();
      const h = start({
        layouts: {
          [WS]: settledLayout([
            browserTab({ browserUrl: 'http://a.test/' }),
            browserTab({ id: 'b2', browserUrl: 'http://b.test/' }),
          ]),
        },
        health: 'down',
        applied: true,
      });
      h.setHealth('healthy', 1);
      h.dispatch(updateTabTitle(WS, 'b1', 'One'));
      await flush();
      expect(mocks.upsertTab).toHaveBeenCalledTimes(2);

      mocks.removeTab.mockReturnValueOnce(removal.promise);
      h.dispatch(updateTabBrowserUrl(WS, 'b2', 'http://b.test/stale'));
      h.dispatch(closeTab(WS, 'b1', undefined, undefined, { destroy: true }));
      await flush();
      expect(mocks.removeTab).toHaveBeenCalledWith('b1');

      mocks.listTabs.mockResolvedValue([row({ tabId: 'b2', url: 'http://b.test/fresh' })]);
      teardown(h);
      remount(h);
      await flush();
      const fresh = [expect.objectContaining({ id: 'b2', browserUrl: 'http://b.test/fresh' })];
      expect(h.tabs()).toEqual(fresh);

      removal.resolve({ ok: true });
      await flush();
      expect(mocks.upsertTab.mock.calls.map(([, tab]) => tab.url)).not.toContain(
        'http://b.test/stale',
      );
      expect(h.tabs()).toEqual(fresh);
      await stop(h);
    });

    it('keeps a mirror restored under a newer generation when a stale snapshot drops its id', async () => {
      const ack = deferred<{ drop: string[] }>();
      mocks.listTabs.mockResolvedValue([row()]);
      mocks.syncTabs.mockReturnValueOnce(ack.promise);
      const h = start({
        layouts: {
          [WS]: settledLayout([browserTab({ browserUrl: 'http://a.test/', hostClientId: OWN })]),
        },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(connectionStatusChanged('connected'));
      await flush(0);
      expect(mocks.syncTabs.mock.calls).toEqual([[[expect.objectContaining({ tabId: 'b1' })]]]);

      // Re-homed while the snapshot is in flight; the remount restores it as a mirror.
      mocks.listTabs.mockResolvedValue([row({ hostClientId: OTHER })]);
      teardown(h);
      remount(h);
      await flush();
      const mirror = [expect.objectContaining({ id: 'b1', hostClientId: OTHER })];
      expect(h.tabs()).toEqual(mirror);

      ack.resolve({ drop: ['b1'] });
      await flush();
      expect(h.tabs()).toEqual(mirror);
      expect(mocks.removeTab).not.toHaveBeenCalled();
      await stop(h);
    });

    it('keeps a tab restored under a newer generation reported when a stale snapshot drops its id, so its close is still sent', async () => {
      const ack = deferred<{ drop: string[] }>();
      mocks.listTabs.mockResolvedValue([row()]);
      mocks.syncTabs.mockReturnValueOnce(ack.promise);
      const h = start({
        layouts: {
          [WS]: settledLayout([browserTab({ browserUrl: 'http://a.test/', hostClientId: OWN })]),
        },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(connectionStatusChanged('connected'));
      await flush(0);
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);

      // Remounted while the snapshot is in flight; the fresh listing restores
      // the same own-host row under the new generation, which reports it.
      teardown(h);
      remount(h);
      await flush();
      expect(h.tabs()).toEqual([expect.objectContaining({ id: 'b1', hostClientId: OWN })]);
      expect(h.registry().reported).toHaveProperty('b1');

      // The obsolete drop belongs to the old generation: neither the layout
      // nor what the new generation reported moves.
      ack.resolve({ drop: ['b1'] });
      await flush(0);
      expect(h.tabs()).toEqual([expect.objectContaining({ id: 'b1' })]);
      expect(h.registry().reported).toHaveProperty('b1');
      expect(mocks.removeTab).not.toHaveBeenCalled();

      // A close made right after is therefore still a close: the removal is
      // sent and nothing resurrects the tab on the next remount.
      h.dispatch(closeTab(WS, 'b1', undefined, undefined, { destroy: true }));
      teardown(h);
      remount(h);
      await flush();
      expect(mocks.removeTab.mock.calls).toEqual([['b1']]);
      expect(h.tabs()).toEqual([]);
      await stop(h);
    });

    it('keeps a tab closed offline right before the unmount closed across the remount', async () => {
      const h = start({
        layouts: { [WS]: settledLayout([browserTab({ browserUrl: 'http://a.test/' })]) },
      });
      await flush();
      expect(mocks.syncTabs.mock.calls).toEqual([[[expect.objectContaining({ tabId: 'b1' })]]]);

      h.setHealth('down', 1);
      h.dispatch(closeTab(WS, 'b1', undefined, undefined, { destroy: true }));
      teardown(h);
      await flush();
      expect(h.closing()).toEqual({ b1: 'pending' });
      expect(mocks.removeTab).not.toHaveBeenCalled();

      mocks.listTabs.mockResolvedValue([row()]);
      h.setHealth('healthy', 1);
      remount(h);
      await flush();
      expect(h.tabs()).toEqual([]);
      expect(mocks.removeTab.mock.calls).toEqual([['b1']]);
      await stop(h);
    });

    it('removes the tabs closed right before the unmount when the daemon is reachable', async () => {
      const h = start({
        layouts: {
          [WS]: settledLayout([
            browserTab({ browserUrl: 'http://a.test/' }),
            browserTab({ id: 'b2', browserUrl: 'http://b.test/' }),
          ]),
        },
      });
      await flush();
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);

      h.dispatch(closeTab(WS, 'b1', undefined, undefined, { destroy: true }));
      h.dispatch(workspaceUnmounted(WS));
      await flush();
      // b2 merely left with the workspace: not a close.
      expect(mocks.removeTab.mock.calls).toEqual([['b1']]);
      expect(h.registry()).toMatchObject({ phase: 'unmounted', reported: {} });
      expect(h.closing()).toEqual({ b1: 'acknowledged' });
      await stop(h);
    });

    it('records a close as a pending removal in the same dispatch, before the report debounce', async () => {
      const h = start({
        layouts: { [WS]: settledLayout([browserTab({ browserUrl: 'http://a.test/' })]) },
      });
      await flush();
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);

      h.dispatch(closeTab(WS, 'b1', undefined, undefined, { destroy: true }));
      expect(h.closing()).toEqual({ b1: 'pending' });
      expect(h.registry().reported).toEqual({});
      expect(mocks.removeTab).not.toHaveBeenCalled();
      await flush();
      expect(mocks.removeTab.mock.calls).toEqual([['b1']]);
      expect(h.closing()).toEqual({ b1: 'acknowledged' });
      await stop(h);
    });

    it('treats closing the last panel of a mounted workspace as a close of its tabs', async () => {
      const h = start({
        layouts: { [WS]: settledLayout([browserTab({ browserUrl: 'http://a.test/' })]) },
      });
      await flush();
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);

      h.dispatch(clearPanelLayout(WS));
      expect(h.closing()).toEqual({ b1: 'pending' });
      await flush();
      expect(mocks.removeTab.mock.calls).toEqual([['b1']]);
      expect(h.registry()).toMatchObject({ phase: 'unmounted', reported: {} });
      await stop(h);
    });

    it('stops materialising the remaining rows when the workspace is torn down mid-apply', async () => {
      mocks.listTabs.mockResolvedValueOnce([
        row({ tabId: 'old-first' }),
        row({ tabId: 'old-second', url: 'http://b.test/' }),
      ]);
      const h = start({
        layouts: { [WS]: settledLayout([], 'pending' as never) },
        health: 'down',
      });
      // The teardown lands while the first row is being placed.
      h.onDispatched((action) => {
        if (action.type !== openTabInRightmostColumnRequested.type) return;
        h.onDispatched(null);
        teardown(h);
      });
      h.setHealth('healthy', 1);
      h.dispatch(setRestoreStatus(WS, 'restored'));
      await flush();

      expect(h.tabs()).toEqual([]);
      expect(h.ofType(openTabInRightmostColumnRequested.type)).toHaveLength(1);
      expect(h.registry()).toMatchObject({ phase: 'unmounted' });
      expect(mocks.syncTabs).not.toHaveBeenCalled();
      await stop(h);
    });

    it('stops materialising the remaining rows when the workspace reloads mid-apply', async () => {
      mocks.listTabs
        .mockResolvedValueOnce([
          row({ tabId: 'old-first' }),
          row({ tabId: 'old-second', url: 'http://b.test/' }),
        ])
        .mockResolvedValue([row({ tabId: 'fresh' })]);
      const h = start({
        layouts: { [WS]: settledLayout([], 'pending' as never) },
        health: 'down',
      });
      // A reconnect re-reads the workspace while the first row is being placed.
      h.onDispatched((action) => {
        if (action.type !== openTabInRightmostColumnRequested.type) return;
        h.onDispatched(null);
        h.setHealth('healthy', 2);
        h.dispatch(connectionStatusChanged('connected'));
      });
      h.setHealth('healthy', 1);
      h.dispatch(setRestoreStatus(WS, 'restored'));
      await flush();

      expect(h.tabs().map((t) => t.id)).toEqual(['old-first', 'fresh']);
      expect(mocks.syncTabs.mock.calls).toEqual([
        [
          [
            expect.objectContaining({ tabId: 'old-first' }),
            expect.objectContaining({ tabId: 'fresh' }),
          ],
        ],
      ]);
      await stop(h);
    });

    it('does not navigate a remounted tab from a tunnel resolution of its torn-down generation', async () => {
      const stored = { url: 'http://a.test/old', requestedUrl: 'http://localhost:1/' };
      mocks.listTabs.mockResolvedValue([row(stored)]);
      const obsolete = deferred<{ url: string }>();
      mocks.resolveBrowserLinkUrl
        .mockReturnValueOnce(obsolete.promise)
        .mockResolvedValue({ url: stored.url });
      const h = start({
        layouts: { [WS]: settledLayout([], 'pending' as never) },
        health: 'down',
      });
      h.setHealth('healthy', 1);
      h.dispatch(setRestoreStatus(WS, 'restored'));
      await flush(0);
      expect(h.tabs()).toEqual([expect.objectContaining({ id: 'b1', browserUrl: stored.url })]);

      teardown(h);
      remount(h);
      await flush(0);
      expect(h.tabs()).toEqual([expect.objectContaining({ id: 'b1', browserUrl: stored.url })]);
      expect(mocks.resolveBrowserLinkUrl).toHaveBeenCalledTimes(2);

      obsolete.resolve({ url: 'https://obsolete-tunnel.test/' });
      await flush();
      expect(h.tabs()).toEqual([expect.objectContaining({ id: 'b1', browserUrl: stored.url })]);
      expect(h.ofType(updateTabBrowserUrl.type)).toEqual([]);
      await stop(h);
    });

    it('does not send the snapshot of a superseded connection after a reconnect', async () => {
      const slow = deferred<BrowserTabListing[]>();
      mocks.listTabs.mockReturnValueOnce(slow.promise).mockResolvedValue([row()]);
      // Unsettled: its rows are passed through, so only the connection fence
      // stands between the old listing and the daemon.
      const h = start({ layouts: { [WS]: settledLayout([], 'pending' as never) } });
      await flush(0);
      expect(mocks.listTabs).toHaveBeenCalledTimes(1);
      expect(mocks.syncTabs).not.toHaveBeenCalled();

      h.setHealth('healthy', 2);
      h.dispatch(connectionStatusChanged('connected'));
      await flush(0);
      expect(mocks.syncTabs.mock.calls).toEqual([[[expect.objectContaining({ tabId: 'b1' })]]]);

      // The old connection's listing (taken before b1 existed) lands now.
      slow.resolve([]);
      await flush(SYNC_RETRY_MS + REPORT_DEBOUNCE_MS);
      expect(mocks.syncTabs).toHaveBeenCalledTimes(1);
      await stop(h);
    });
  });
});

