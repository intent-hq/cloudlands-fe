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
import {
  fetchWorkspaceBrowserClientRequested,
  fetchWorkspaceBrowserTabsRequested,
  hydrateBrowserClientsRequested,
  initialState,
  refreshLiveClientsRequested,
  setWorkspaceBrowserClientRequested,
} from '../browser-clients-slice';
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
  const task = runSaga(
    { channel, dispatch, getState: () => ({ browserClients: initialState }) },
    browserClientsSaga,
  );
  const dispatched = () => dispatch.mock.calls.map(([action]) => action);
  return { channel, task, dispatched };
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
      payload: ['ws-1', tabs],
    });
  });
});
