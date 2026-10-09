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
  workspaceUnmounted,
  workspaceDeleted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectWorkspaceDrivingClient } from '../browser-clients-selectors';
import {
  browserClientsReducer,
  hydrateBrowserClientsRequested,
  fetchWorkspaceBrowserClientRequested,
  refreshLiveClientsRequested,
  setWorkspaceBrowserClientRequested,
  initialState,
} from '../browser-clients-slice';
import { removeWorkspaceEntity } from '../../workspace/workspace-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
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

function start(mounted: string[] = []) {
  const channel = stdChannel();
  let state = { browserClients: initialState, workspaceLifecycle: lifecycleInitialState };
  const dispatch = (action: StoreAction<unknown>) => {
    state = {
      browserClients: browserClientsReducer(state.browserClients, action),
      workspaceLifecycle: workspaceLifecycleReducer(state.workspaceLifecycle, action),
    };
    channel.put(action);
  };
  for (const wsId of mounted) dispatch(workspaceMounted(wsId));
  tasks.push(runSaga({ channel, dispatch, getState: () => state }, browserClientsSaga));
  return {
    dispatch,
    confirmed: () => state.browserClients.ownClientIdConfirmed,
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
  it('retries a failed current hello on remount while retaining hosted identity', async () => {
    const run = start();
    run.dispatch(workspaceMounted('ws-1'));
    await settle();
    const normal = transport.request.getMockImplementation()!;
    let failHello = true;
    transport.request.mockImplementation((method, params) => {
      if (method === 'client.hello' && failHello) {
        failHello = false;
        return Promise.reject(new Error('temporary hello failure'));
      }
      return normal(method, params);
    });
    reconnect();
    await settle();
    expect(run.view().ownClientId).toBe(desktop.clientId);
    expect(run.confirmed()).toBe(false);
    run.dispatch(workspaceUnmounted('ws-1'));
    run.dispatch(workspaceMounted('ws-1'));
    await settle();
    expect(
      transport.request.mock.calls.filter(([method]) => method === 'client.hello'),
    ).toHaveLength(3);
    expect(run.confirmed()).toBe(true);
    expect(run.view().ownClientId).toBe(desktop.clientId);
  });

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

    // Conditional contract: if main reports a different canonical ID, use it exactly.
    // This fixture does not establish that ordinary reconnect changes identity.
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('connection lifetime races', () => {
  it('defers browser admission until a workspace is mounted', async () => {
    const run = start();
    run.dispatch(connectionStatusChanged('connecting'));
    run.dispatch(connectionStatusChanged('connected'));
    await settle();
    expect(transport.request).not.toHaveBeenCalled();
    run.dispatch(workspaceMounted('ws-1'));
    await settle();
    expect(run.confirmed()).toBe(true);
    expect(run.view().eligibleClients).toHaveLength(1);
  });

  it('restarts canceled startup hydration on plain connected after a delayed status snapshot', async () => {
    const oldHello = deferred<{ clientId: string }>();
    const oldResolution = deferred<{ browserClient: WorkspaceBrowserClient }>();
    const normal = transport.request.getMockImplementation()!;
    let helloPending = true;
    let resolutionPending = true;
    transport.request.mockImplementation((method, params) => {
      if (method === 'client.hello' && helloPending) {
        helloPending = false;
        return oldHello.promise;
      }
      if (method === 'workspace.getBrowserClient' && resolutionPending) {
        resolutionPending = false;
        return oldResolution.promise;
      }
      return normal(method, params);
    });
    const run = start();
    run.dispatch(workspaceMounted('ws-1'));
    await settle();
    run.dispatch(connectionStatusChanged('connecting'));
    await settle();
    run.dispatch(connectionStatusChanged('connected'));
    await settle();
    oldHello.resolve({ clientId: 'obsolete-startup-id' });
    oldResolution.resolve({
      browserClient: { source: 'workspace', clientId: 'obsolete-pin', resolved: null },
    });
    await settle();
    expect(run.confirmed()).toBe(true);
    expect(run.view()).toMatchObject({
      ownClientId: desktop.clientId,
      pinnedClientId: null,
      eligibleClients: [{ clientId: desktop.clientId, connected: true }],
      driving: { clientId: desktop.clientId, connected: true },
    });
  });

  it('does not rehydrate an admitted connection on repeated connected metadata', async () => {
    const run = start();
    run.dispatch(workspaceMounted('ws-1'));
    await settle();
    transport.request.mockClear();
    run.dispatch(connectionStatusChanged('connected'));
    run.dispatch(connectionStatusChanged('connected'));
    await settle();
    expect(run.confirmed()).toBe(true);
    expect(transport.request).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores old hello %s after current hydration succeeds',
    async (outcome) => {
      const old = deferred<{ clientId: string }>();
      const normal = transport.request.getMockImplementation()!;
      let first = true;
      transport.request.mockImplementation((method: string, ...args: unknown[]) => {
        if (method === 'client.hello' && first) {
          first = false;
          return old.promise;
        }
        return normal(method, ...args);
      });
      const run = start();
      run.dispatch(workspaceMounted('ws-1'));
      await settle();
      reconnect();
      await settle();
      expect(run.view().ownClientId).toBe(desktop.clientId);
      if (outcome === 'resolve') old.resolve({ clientId: 'obsolete-caller' });
      else old.reject(new Error('old connection closed'));
      await settle();
      run.dispatch(hydrateBrowserClientsRequested('ws-1'));
      await settle();
      expect(run.view().ownClientId).toBe(desktop.clientId);
      expect(
        transport.request.mock.calls.filter(([method]) => method === 'client.hello'),
      ).toHaveLength(2);
    },
  );

  it.each(['client.list', 'workspace.getBrowserClient', 'workspace.setBrowserClient'])(
    'discards an old %s reply after reconnect',
    async (method) => {
      const run = start();
      run.dispatch(workspaceMounted('ws-1'));
      await settle();
      const old = deferred<unknown>();
      const normal = transport.request.getMockImplementation()!;
      let first = true;
      transport.request.mockImplementation((name: string, ...args: unknown[]) => {
        if (name === method && first) {
          first = false;
          return old.promise;
        }
        return normal(name, ...args);
      });
      if (method === 'client.list') run.dispatch(refreshLiveClientsRequested('ws-1'));
      else if (method === 'workspace.getBrowserClient')
        run.dispatch(fetchWorkspaceBrowserClientRequested('ws-1'));
      else run.dispatch(setWorkspaceBrowserClientRequested('ws-1', 'old-pin'));
      await settle();
      reconnect();
      await settle();
      old.resolve(
        method === 'client.list'
          ? { clients: [] }
          : { browserClient: { source: 'workspace', clientId: 'old-pin', resolved: null } },
      );
      await settle();
      expect(run.view().pinnedClientId).toBeNull();
      expect(run.view().eligibleClients).toHaveLength(1);
    },
  );

  it('retains tab-host identity while invalidating recovery eligibility on disconnect', async () => {
    const run = start();
    run.dispatch(workspaceMounted('ws-1'));
    await settle();
    run.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    // BrowserTabType uses ownClientId to retain the native hosted surface.
    expect(run.view().ownClientId).toBe(desktop.clientId);
    expect(run.view().eligibleClients).toEqual([]);
  });
});

describe('mounted workspace lifetime across reconnect', () => {
  it('refreshes workspaces already mounted when the browser saga starts', async () => {
    const run = start(['ws-1']);
    reconnect();
    await settle();
    expect(run.view().ownClientId).toBe(desktop.clientId);
    expect(run.view().eligibleClients).toHaveLength(1);
    expect(transport.request).toHaveBeenCalledWith('workspace.getBrowserClient', {
      workspaceId: 'ws-1',
    });
  });

  it.each([workspaceUnmounted, workspaceDeleted, removeWorkspaceEntity])(
    'does not reconnect a cleaned workspace until a real remount (%s)',
    async (cleanup) => {
      const run = start();
      run.dispatch(workspaceMounted('ws-1'));
      await settle();
      run.dispatch(cleanup('ws-1'));
      transport.request.mockClear();
      reconnect();
      reconnect();
      await settle();
      expect(
        transport.request.mock.calls.some(([, params]) => params?.workspaceId === 'ws-1'),
      ).toBe(false);
      run.dispatch(workspaceMounted('ws-1'));
      await settle();
      expect(run.view().eligibleClients).toHaveLength(1);
      expect(transport.request).toHaveBeenCalledWith('workspace.getBrowserClient', {
        workspaceId: 'ws-1',
      });
    },
  );
});
