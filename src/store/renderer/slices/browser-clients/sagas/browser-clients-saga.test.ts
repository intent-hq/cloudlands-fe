import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  ownClientId: vi.fn(),
  getBrowserClient: vi.fn(),
  setBrowserClient: vi.fn(),
  listTabs: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    clients: { list: mocks.list, ownClientId: mocks.ownClientId },
    workspaces: {
      getBrowserClient: mocks.getBrowserClient,
      setBrowserClient: mocks.setBrowserClient,
    },
    browser: { listTabs: mocks.listTabs },
  },
}));

import type { LiveClient } from '$shared/types/browser-clients';
import { resolveDrivingClientView } from '$lib/components/workspace/driving-indicator';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { StoreAction } from '@augmentcode/themis/utils/store/create-action';
import type { StoreState } from '../../../types';
import { removeWorkspaceEntity } from '../../workspace/workspace-slice';
import { selectWorkspaceDrivingClient } from '../browser-clients-selectors';
import {
  workspaceDeleted,
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  browserClientsReducer,
  fetchWorkspaceBrowserClientRequested,
  fetchWorkspaceBrowserTabsRequested,
  hydrateBrowserClientsRequested,
  initialState,
  refreshLiveClientsRequested,
  setWorkspaceBrowserClientRequested,
  workspaceBrowserClientReceived,
} from '../browser-clients-slice';
import { emptyWorkspaceBrowserClientsState } from '../browser-clients-types';
import { browserClientsSaga } from './browser-clients-saga';

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const desk: LiveClient = {
  clientId: 'cli-desk',
  name: 'Intent Desktop',
  capabilities: { browserExec: true },
  connections: 1,
  transports: ['uds'],
  connectedAt: '2026-09-07T00:00:00.000Z',
};

function start() {
  const channel = stdChannel();
  const dispatch = vi.fn((action) => channel.put(action));
  const state = { browserClients: initialState };
  const task = runSaga({ channel, dispatch, getState: () => state }, browserClientsSaga);
  const dispatched = () => dispatch.mock.calls.map(([action]) => action);
  const setTabsRevision = (wsId: string, tabsRevision: number) => {
    state.browserClients = {
      ...state.browserClients,
      byWorkspaceId: {
        ...state.browserClients.byWorkspaceId,
        [wsId]: {
          ...(state.browserClients.byWorkspaceId[wsId] ?? emptyWorkspaceBrowserClientsState),
          tabsRevision,
        },
      },
    };
  };
  return { channel, task, dispatched, setTabsRevision };
}

/** Saga wired to the real reducer, so lifecycle races are observed on state. */
function startWithReducer() {
  const channel = stdChannel();
  let state = { browserClients: initialState };
  const dispatch = (action: StoreAction<unknown>) => {
    state = { browserClients: browserClientsReducer(state.browserClients, action) };
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, browserClientsSaga);
  return {
    dispatch,
    task,
    entry: (wsId: string) => state.browserClients.byWorkspaceId[wsId],
    /** The sidebar indicator's view for `wsId`, resolved from live state. */
    sidebar: (wsId: string) =>
      resolveDrivingClientView(
        selectWorkspaceDrivingClient.select(state as unknown as StoreState, wsId),
      ),
  };
}

describe('browserClientsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([desk]);
    mocks.ownClientId.mockResolvedValue('cli-desk');
  });

  it('hydrate probes the own clientId, then reads client.list once', async () => {
    const { channel, task, dispatched } = start();
    channel.put(hydrateBrowserClientsRequested());
    await settle();
    task.cancel();

    expect(mocks.ownClientId).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(dispatched()).toEqual([
      { type: 'browserClients/ownClientIdReceived', payload: ['cli-desk'] },
      { type: 'browserClients/refreshLiveClientsRequested', payload: [] },
      { type: 'browserClients/liveClientsReceived', payload: [[desk]] },
    ]);
  });

  it('coalesces a burst of refreshLiveClientsRequested into one in-flight read plus one trailing read', async () => {
    const first = deferred<LiveClient[]>();
    mocks.list.mockReturnValueOnce(first.promise);
    const { channel, task, dispatched } = start();

    channel.put(refreshLiveClientsRequested());
    channel.put(refreshLiveClientsRequested());
    channel.put(refreshLiveClientsRequested());
    channel.put(refreshLiveClientsRequested());
    await settle();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    first.resolve([]);
    await settle();
    task.cancel();

    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(dispatched().filter((a) => a.type === 'browserClients/liveClientsReceived')).toEqual([
      { type: 'browserClients/liveClientsReceived', payload: [[]] },
      { type: 'browserClients/liveClientsReceived', payload: [[desk]] },
    ]);
  });

  it('swallows a failed client.list read without dispatching a snapshot', async () => {
    mocks.list.mockRejectedValueOnce(new Error('transport down'));
    const { channel, task, dispatched } = start();
    channel.put(refreshLiveClientsRequested());
    await settle();
    task.cancel();

    expect(dispatched().filter((a) => a.type === 'browserClients/liveClientsReceived')).toEqual([]);
  });

  it('hydrates once on the first workspace mount, then only reads that workspace browser client', async () => {
    const browserClient = { source: 'default', resolved: { clientId: 'cli-desk' } };
    mocks.getBrowserClient.mockResolvedValue(browserClient);
    const { dispatch, task, entry } = startWithReducer();

    dispatch(workspaceMounted('ws-1'));
    await settle();
    expect(mocks.ownClientId).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.getBrowserClient.mock.calls).toEqual([['ws-1']]);
    expect(entry('ws-1').browserClient).toEqual(browserClient);

    dispatch(workspaceMounted('ws-2'));
    await settle();
    task.cancel();

    expect(mocks.ownClientId).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.getBrowserClient.mock.calls).toEqual([['ws-1'], ['ws-2']]);
    expect(entry('ws-2').browserClient).toEqual(browserClient);
  });

  describe('presence changes (client:connected / client:disconnected → refreshLiveClientsRequested)', () => {
    const laptop: LiveClient = { ...desk, clientId: 'cli-laptop', name: 'laptop' };
    const pinnedLaptop = { source: 'workspace', clientId: 'cli-laptop', resolved: laptop };
    const pinnedLaptopOffline = { source: 'workspace', clientId: 'cli-laptop', resolved: null };

    it('re-reads the browser client of mounted workspaces only, not on the initial load', async () => {
      mocks.list.mockResolvedValue([desk, laptop]);
      mocks.getBrowserClient.mockResolvedValue(pinnedLaptop);
      const { dispatch, task } = startWithReducer();

      dispatch(workspaceMounted('ws-1'));
      await settle();
      expect(mocks.getBrowserClient.mock.calls).toEqual([['ws-1']]);

      dispatch(workspaceMounted('ws-2'));
      await settle();
      dispatch(workspaceUnmounted('ws-2'));
      await settle();
      mocks.getBrowserClient.mockClear();

      dispatch(refreshLiveClientsRequested());
      await settle();
      task.cancel();

      expect(mocks.list).toHaveBeenCalledTimes(2);
      expect(mocks.getBrowserClient.mock.calls).toEqual([['ws-1']]);
    });

    it('a pinned client disconnecting and reconnecting moves the sidebar offline and back without a remount', async () => {
      mocks.list.mockResolvedValue([desk, laptop]);
      mocks.getBrowserClient.mockResolvedValue(pinnedLaptop);
      const { dispatch, task, sidebar } = startWithReducer();

      dispatch(workspaceMounted('ws-1'));
      await settle();
      expect(sidebar('ws-1')).toMatchObject({ mode: 'elsewhere', canSwitchHere: true });

      mocks.list.mockResolvedValue([desk]);
      mocks.getBrowserClient.mockResolvedValue(pinnedLaptopOffline);
      dispatch(refreshLiveClientsRequested());
      await settle();
      expect(sidebar('ws-1')).toMatchObject({ mode: 'offline', canSwitchHere: true });

      mocks.list.mockResolvedValue([desk, laptop]);
      mocks.getBrowserClient.mockResolvedValue(pinnedLaptop);
      dispatch(refreshLiveClientsRequested());
      await settle();
      task.cancel();

      expect(sidebar('ws-1')).toMatchObject({ mode: 'elsewhere', canSwitchHere: true });
    });

    it('an unpinned default falling through to this client is reflected after the disconnect', async () => {
      mocks.list.mockResolvedValue([desk, laptop]);
      mocks.getBrowserClient.mockResolvedValue({ source: 'default', resolved: laptop });
      const { dispatch, task, sidebar, entry } = startWithReducer();

      dispatch(workspaceMounted('ws-1'));
      await settle();
      expect(sidebar('ws-1')).toMatchObject({ mode: 'elsewhere' });

      mocks.list.mockResolvedValue([desk]);
      mocks.getBrowserClient.mockResolvedValue({ source: 'default', resolved: desk });
      dispatch(refreshLiveClientsRequested());
      await settle();
      task.cancel();

      expect(entry('ws-1').browserClient).toEqual({ source: 'default', resolved: desk });
      expect(sidebar('ws-1')).toBeNull();
    });
  });

  it('reads workspace.getBrowserClient per workspace and stores the result', async () => {
    const browserClient = {
      clientId: 'cli-desk',
      source: 'workspace',
      resolved: { clientId: 'cli-desk' },
    };
    mocks.getBrowserClient.mockResolvedValue(browserClient);
    const { channel, task, dispatched } = start();
    channel.put(fetchWorkspaceBrowserClientRequested('ws-1'));
    await settle();
    task.cancel();

    expect(mocks.getBrowserClient.mock.calls).toEqual([['ws-1']]);
    expect(dispatched()).toContainEqual({
      type: 'browserClients/workspaceBrowserClientReceived',
      payload: ['ws-1', browserClient],
    });
  });

  it('writes the pin through workspace.setBrowserClient and stores the daemon result', async () => {
    const cleared = { source: 'default', resolved: null };
    mocks.setBrowserClient.mockResolvedValue(cleared);
    const { channel, task, dispatched } = start();
    channel.put(setWorkspaceBrowserClientRequested('ws-1', null));
    await settle();
    task.cancel();

    expect(mocks.setBrowserClient.mock.calls).toEqual([['ws-1', null]]);
    expect(dispatched()).toContainEqual({
      type: 'browserClients/workspaceBrowserClientReceived',
      payload: ['ws-1', cleared],
    });
  });

  it('keeps only the latest pin write per workspace so a slow earlier echo cannot win', async () => {
    const slowPin = deferred<unknown>();
    const pinned = {
      clientId: 'cli-desk',
      source: 'workspace',
      resolved: { clientId: 'cli-desk' },
    };
    const cleared = { source: 'default', resolved: null };
    const otherPinned = {
      clientId: 'cli-laptop',
      source: 'workspace',
      resolved: { clientId: 'cli-laptop' },
    };
    mocks.setBrowserClient.mockImplementation((wsId: string, clientId: string | null) => {
      if (wsId === 'ws-2') return Promise.resolve(otherPinned);
      return clientId === null ? Promise.resolve(cleared) : slowPin.promise;
    });
    const { channel, task, dispatched } = start();

    channel.put(setWorkspaceBrowserClientRequested('ws-1', 'cli-desk'));
    channel.put(setWorkspaceBrowserClientRequested('ws-1', null));
    channel.put(setWorkspaceBrowserClientRequested('ws-2', 'cli-laptop'));
    await settle();
    slowPin.resolve(pinned);
    await settle();
    task.cancel();

    // Every write still reaches the daemon (it applies them in order) …
    expect(mocks.setBrowserClient.mock.calls).toEqual([
      ['ws-1', 'cli-desk'],
      ['ws-1', null],
      ['ws-2', 'cli-laptop'],
    ]);
    // … but only the latest write per workspace updates the mirror.
    expect(
      dispatched().filter((a) => a.type === 'browserClients/workspaceBrowserClientReceived'),
    ).toEqual([
      { type: 'browserClients/workspaceBrowserClientReceived', payload: ['ws-1', cleared] },
      { type: 'browserClients/workspaceBrowserClientReceived', payload: ['ws-2', otherPinned] },
    ]);
  });

  it('re-reads browser.listTabs when a browser:tab-* patch landed while the read was in flight', async () => {
    const firstRead = deferred<unknown[]>();
    const stale = [{ tabId: 'tab-stale' }];
    const fresh = [{ tabId: 'tab-fresh' }];
    mocks.listTabs.mockReturnValueOnce(firstRead.promise).mockResolvedValueOnce(fresh);
    const { channel, task, dispatched, setTabsRevision } = start();

    channel.put(fetchWorkspaceBrowserTabsRequested('ws-1'));
    await settle();
    expect(mocks.listTabs).toHaveBeenCalledTimes(1);

    // A tab event patches the mirror (revision 0 → 1) before the snapshot lands.
    setTabsRevision('ws-1', 1);
    firstRead.resolve(stale);
    await settle();
    task.cancel();

    expect(mocks.listTabs.mock.calls).toEqual([['ws-1'], ['ws-1']]);
    expect(
      dispatched().filter((a) => a.type === 'browserClients/workspaceBrowserTabsReceived'),
    ).toEqual([
      // Stamped with the stale revision: the reducer discards it.
      { type: 'browserClients/workspaceBrowserTabsReceived', payload: ['ws-1', stale, 0] },
      { type: 'browserClients/workspaceBrowserTabsReceived', payload: ['ws-1', fresh, 1] },
    ]);
  });

  it('reads browser.listTabs per workspace and stores the listing', async () => {
    const tabs = [
      {
        tabId: 'tab-1',
        workspaceId: 'ws-1',
        hostClientId: 'cli-desk',
        url: 'https://a/',
        visibility: 'visible',
        createdAt: 't',
        updatedAt: 't',
        hostConnected: true,
      },
    ];
    mocks.listTabs.mockResolvedValue(tabs);
    const { channel, task, dispatched } = start();
    channel.put(fetchWorkspaceBrowserTabsRequested('ws-1'));
    await settle();
    task.cancel();

    expect(mocks.listTabs.mock.calls).toEqual([['ws-1']]);
    expect(dispatched()).toContainEqual({
      type: 'browserClients/workspaceBrowserTabsReceived',
      payload: ['ws-1', tabs, 0],
    });
  });

  describe('workspace teardown while a per-workspace call is in flight', () => {
    const WS = 'ws-gone';
    const listedTab = {
      tabId: 'tab-1',
      workspaceId: WS,
      hostClientId: 'cli-desk',
      url: 'https://a/',
      visibility: 'visible',
      createdAt: 't',
      updatedAt: 't',
      hostConnected: true,
    };
    const pinned = {
      source: 'workspace',
      clientId: 'cli-desk',
      resolved: { clientId: 'cli-desk' },
    };
    const unpinned = { source: 'default', resolved: null };

    const requests = {
      listTabs: {
        mock: () => mocks.listTabs,
        request: () => fetchWorkspaceBrowserTabsRequested(WS),
        reply: [listedTab],
      },
      getBrowserClient: {
        mock: () => mocks.getBrowserClient,
        request: () => fetchWorkspaceBrowserClientRequested(WS),
        reply: pinned,
      },
      setBrowserClient: {
        mock: () => mocks.setBrowserClient,
        request: () => setWorkspaceBrowserClientRequested(WS, 'cli-desk'),
        reply: pinned,
      },
    } as const;
    const teardowns = {
      workspaceDeleted: () => workspaceDeleted(WS),
      workspaceUnmounted: () => workspaceUnmounted(WS),
      removeWorkspaceEntity: () => removeWorkspaceEntity(WS),
    } as const;
    const cells = Object.keys(requests).flatMap((call) =>
      Object.keys(teardowns).map((teardown) => [call, teardown] as const),
    ) as [keyof typeof requests, keyof typeof teardowns][];

    it.each(cells)('drops the %s reply that lands after %s', async (call, teardown) => {
      const slow = deferred<unknown>();
      requests[call].mock().mockReturnValue(slow.promise);
      const { dispatch, task, entry } = startWithReducer();
      dispatch(workspaceBrowserClientReceived(WS, unpinned));
      dispatch(requests[call].request());
      await settle();
      expect(requests[call].mock()).toHaveBeenCalledTimes(1);

      dispatch(teardowns[teardown]());
      expect(entry(WS)).toBeUndefined();
      slow.resolve(requests[call].reply);
      await settle();
      task.cancel();

      // The cleared entry is not recreated by the late reply.
      expect(entry(WS)).toBeUndefined();
    });

    it('a reply from before an unmount does not apply to the remounted workspace (listTabs)', async () => {
      const first = deferred<unknown>();
      const second = deferred<unknown>();
      const fresh = [{ ...listedTab, tabId: 'tab-fresh' }];
      mocks.listTabs.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { dispatch, task, entry } = startWithReducer();

      dispatch(fetchWorkspaceBrowserTabsRequested(WS));
      await settle();
      dispatch(workspaceUnmounted(WS));

      // Remounted, but its own read is not in flight yet when the pre-unmount
      // read lands: nothing supersedes it, and it is stamped with the same
      // revision (0) a fresh mount starts at — it must still be discarded.
      first.resolve([listedTab]);
      await settle();
      expect(entry(WS)).toBeUndefined();

      dispatch(fetchWorkspaceBrowserTabsRequested(WS));
      await settle();
      expect(mocks.listTabs).toHaveBeenCalledTimes(2);
      second.resolve(fresh);
      await settle();
      task.cancel();
      expect(getItems(entry(WS)!.tabs)).toEqual(fresh);
    });

    it('a reply from before an unmount does not apply to the remounted workspace (getBrowserClient)', async () => {
      const first = deferred<unknown>();
      const second = deferred<unknown>();
      mocks.getBrowserClient.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { dispatch, task, entry } = startWithReducer();

      dispatch(fetchWorkspaceBrowserClientRequested(WS));
      await settle();
      dispatch(workspaceUnmounted(WS));

      first.resolve(pinned);
      await settle();
      expect(entry(WS)).toBeUndefined();

      dispatch(fetchWorkspaceBrowserClientRequested(WS));
      await settle();
      expect(mocks.getBrowserClient).toHaveBeenCalledTimes(2);
      second.resolve(unpinned);
      await settle();
      task.cancel();
      expect(entry(WS)?.browserClient).toEqual(unpinned);
    });
  });
});
