import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import type { StoreAction } from '@themislib/themis/types';
import type { LiveClient, WorkspaceBrowserClient } from '$shared/types/browser-clients';

const transport = vi.hoisted(() => ({
  request: vi.fn(),
  reconnect: new Set<() => void>(),
}));

// Keep the live facade, saga, reducers and selectors together. Only daemon I/O
// is replaced: these are protocol-shaped replies from one window's backend.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: transport.request,
  onBackendReconnected: (handler: () => void) => {
    transport.reconnect.add(handler);
    return () => transport.reconnect.delete(handler);
  },
}));
vi.mock('$lib/client', async () => {
  const { LiveClientsClient } = await import('$lib/client/live/live-clients-client');
  const { LiveWorkspacesClient } = await import('$lib/client/live/live-workspaces-client');
  return {
    appClient: { clients: new LiveClientsClient(), workspaces: new LiveWorkspacesClient() },
  };
});

import { __resetOwnClientIdForTesting } from '$lib/client/live/live-clients-client';
import type { StoreState } from '../../../types';
import {
  initialState as lifecycleInitialState,
  workspaceLifecycleReducer,
  workspaceMounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectWorkspaceDrivingClient } from '../browser-clients-selectors';
import {
  browserClientsReducer,
  hydrateBrowserClientsRequested,
  initialState,
} from '../browser-clients-slice';
import { browserClientsSaga } from './browser-clients-saga';

const desktop: LiveClient = {
  clientId: 'desktop-before-reconnect',
  capabilities: { browserExec: true },
  connections: 1,
  transports: ['wss'],
  connectedAt: '2026-10-09T00:00:00.000Z',
};
const tasks: Task[] = [];
let currentClient: LiveClient;
let resolution: WorkspaceBrowserClient;

function start() {
  const channel = stdChannel();
  let state = { browserClients: initialState, workspaceLifecycle: lifecycleInitialState };
  const dispatch = (action: StoreAction<unknown>) => {
    state = {
      browserClients: browserClientsReducer(state.browserClients, action),
      workspaceLifecycle: workspaceLifecycleReducer(state.workspaceLifecycle, action),
    };
    channel.put(action);
  };
  tasks.push(runSaga({ channel, dispatch, getState: () => state }, browserClientsSaga));
  return {
    dispatch,
    view: () => selectWorkspaceDrivingClient.select(state as unknown as StoreState, 'ws-1'),
  };
}

// Drain promises without adding timing assumptions or polling a failing assertion.
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function reconnect() {
  for (const handler of transport.reconnect) handler();
}

beforeEach(() => {
  currentClient = { ...desktop };
  resolution = { source: 'default', resolved: { clientId: desktop.clientId } };
  transport.request.mockReset();
  transport.request.mockImplementation(async (method: string) => {
    if (method === 'client.hello')
      return {
        clientId: currentClient.clientId,
        protocolVersion: '10.4',
        server: {
          locality: 'remote',
          hasDisplay: false,
          osArch: 'linux/x86_64',
          version: '0.10.33',
          protocolVersion: '10.4',
          capabilities: {},
        },
      };
    if (method === 'client.list') return { clients: [currentClient] };
    if (method === 'workspace.getBrowserClient') return { browserClient: resolution };
    throw new Error(`Unexpected backend mutation or request: ${method}`);
  });
});

afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  __resetOwnClientIdForTesting();
});

describe('browser recovery across a backend reconnect', () => {
  it('hydrates exact identity and workspace routing from the same backend', async () => {
    const run = start();
    run.dispatch(workspaceMounted('ws-1'));
    await settle();

    expect(run.view()).toMatchObject({
      ownClientId: desktop.clientId,
      eligibleClients: [{ clientId: desktop.clientId, connected: true }],
      driving: { clientId: desktop.clientId, connected: true },
      pinnedClientId: null,
    });
    expect(transport.request).toHaveBeenCalledWith('client.hello', {});
    expect(transport.request).toHaveBeenCalledWith('client.list', { workspaceId: 'ws-1' });
    expect(transport.request).toHaveBeenCalledWith('workspace.getBrowserClient', {
      workspaceId: 'ws-1',
    });
  });

  it('retains a matching identity when the daemon reconnects with the same client', async () => {
    const run = start();
    run.dispatch(workspaceMounted('ws-1'));
    await settle();
    reconnect();
    await settle();

    expect(run.view().eligibleClients).toContainEqual(
      expect.objectContaining({ clientId: run.view().ownClientId, connected: true }),
    );
    expect(run.view().ownClientId).toBe(desktop.clientId);
  });

  it('learns the new authoritative hello identity after reconnect', async () => {
    const run = start();
    run.dispatch(workspaceMounted('ws-1'));
    await settle();

    // A replaced/re-authenticated connection can have a different canonical ID.
    // It must come from hello; matching names or ID suffixes is not authority.
    currentClient = { ...desktop, clientId: 'member:device:desktop-after-reconnect' };
    reconnect();
    await settle();

    expect(run.view().eligibleClients).toEqual([
      expect.objectContaining({ clientId: currentClient.clientId, connected: true }),
    ]);
    expect(run.view().ownClientId).toBe(currentClient.clientId);
  });

  it('does not reuse a successful old hello when hydration is explicitly retried after reconnect', async () => {
    const run = start();
    run.dispatch(workspaceMounted('ws-1'));
    await settle();
    currentClient = { ...desktop, clientId: 'new-authoritative-client' };
    reconnect();
    await settle();
    run.dispatch(hydrateBrowserClientsRequested('ws-1'));
    await settle();

    expect(run.view().ownClientId).toBe(currentClient.clientId);
  });

  it('refreshes a pin changed during the outage even when client identity is unchanged', async () => {
    resolution = {
      source: 'workspace',
      clientId: desktop.clientId,
      resolved: { clientId: desktop.clientId },
    };
    const run = start();
    run.dispatch(workspaceMounted('ws-1'));
    await settle();
    expect(run.view().pinnedClientId).toBe(desktop.clientId);

    // Another authorized client clears the pin while this socket is disconnected.
    resolution = { source: 'default', resolved: { clientId: desktop.clientId } };
    reconnect();
    await settle();

    expect(run.view().eligibleClients).toContainEqual(
      expect.objectContaining({ clientId: desktop.clientId, connected: true }),
    );
    expect(run.view().pinnedClientId).toBeNull();
  });
});
