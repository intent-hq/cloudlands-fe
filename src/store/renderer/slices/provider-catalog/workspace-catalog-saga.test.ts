import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import type { StoreAction } from '@themislib/themis/types';
import type { StoreState } from '../../types';

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  settings: vi.fn(),
  specialists: vi.fn(),
  request: vi.fn(),
  auth: vi.fn(),
  mcpServers: vi.fn(),
  mcpStatuses: vi.fn(),
  notification: undefined as undefined | ((n: { method: string; params?: unknown }) => void),
  reconnect: undefined as undefined | (() => void),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    providers: { catalog: mocks.catalog },
    settings: {
      list: mocks.settings,
      getMcpServers: mocks.mcpServers,
      getMcpServerStatuses: mocks.mcpStatuses,
    },
    specialists: { list: mocks.specialists },
  },
}));
vi.mock('$features/providers/provider-auth-status.client', () => ({
  getProviderAuthVerdicts: mocks.auth,
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  onBackendNotification: (fn: typeof mocks.notification) => {
    mocks.notification = fn;
    return () => {};
  },
  onBackendReconnected: (fn: typeof mocks.reconnect) => {
    mocks.reconnect = fn;
    return () => {};
  },
}));
import {
  initialState,
  providerCatalogReducer,
  workspaceCatalogRequested,
} from './provider-catalog-slice';
import { workspaceCatalogSaga } from './workspace-catalog-saga';
import {
  selectContextDefaultProvider,
  selectContextSpecialists,
} from './workspace-catalog-selectors';
import {
  initialState as lifecycleInitial,
  workspaceLifecycleReducer,
  workspaceMounted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';

import { initialState as availabilityInitial } from '../agent-availability/agent-availability-slice';

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
afterEach(() => vi.resetAllMocks());

describe('workspace catalog ownership', () => {
  it('sends origin IDs, isolates late responses, and refetches all contexts on an unqualified event', async () => {
    let releaseA!: (value: { providers: [] }) => void;
    const a = new Promise<{ providers: [] }>((resolve) => {
      releaseA = resolve;
    });
    mocks.catalog.mockImplementation((id: string) =>
      id === 'A' ? a : Promise.resolve({ providers: [] }),
    );
    mocks.settings.mockImplementation(async (id: string) => [
      { path: 'model.defaultProvider', value: id },
    ]);
    mocks.specialists.mockImplementation(async (_provider: undefined, id: string) => [
      { id, name: id, description: '', source: 'bundled' },
    ]);
    mocks.request.mockImplementation(async (method: string) =>
      method === 'host.findBinary'
        ? { available: true }
        : { providers: [{ id: 'claude-code', installed: true }] },
    );
    mocks.auth.mockResolvedValue({});
    mocks.mcpServers.mockImplementation(async (id: string) => [
      {
        id: `server-${id}`,
        name: 'same-name',
        type: 'stdio',
        command: 'node',
        env: { SECRET: 'redacted' },
      },
    ]);
    mocks.mcpStatuses.mockResolvedValue([]);
    const channel = stdChannel();
    let state = {
      providerCatalog: initialState,
      workspaceLifecycle: lifecycleInitial,
      agentAvailability: availabilityInitial,
    };
    const listeners = new Set<() => void>();
    const dispatch = (action: StoreAction<unknown>) => {
      state = {
        ...state,
        providerCatalog: providerCatalogReducer(state.providerCatalog, action),
        workspaceLifecycle: workspaceLifecycleReducer(state.workspaceLifecycle, action),
      };
      channel.put(action);
      listeners.forEach((listener) => listener());
    };
    const reduxStore = {
      getState: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const task = runSaga(
      { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
      workspaceCatalogSaga,
    );
    try {
      dispatch(workspaceMounted('A'));
      dispatch(workspaceMounted('B'));
      await settle();
      expect(selectContextDefaultProvider.select(state as StoreState, 'B')).toBe('B');
      expect(mocks.catalog).toHaveBeenCalledWith('A');
      expect(mocks.settings).toHaveBeenCalledWith('B');
      expect(mocks.specialists).toHaveBeenCalledWith(undefined, 'A');
      expect(mocks.request).toHaveBeenCalledWith('host.providerDiscovery', { workspaceId: 'A' });
      expect(mocks.auth).toHaveBeenCalledWith({ workspaceId: 'B' });
      expect(mocks.request).toHaveBeenCalledWith('host.findBinary', {
        name: 'claude',
        workspaceId: 'B',
      });
      expect(state.providerCatalog.byWorkspaceId?.B.readiness['claude-code'].available).toBe(true);
      expect(mocks.mcpStatuses).toHaveBeenCalledWith(['server-B'], 'B');
      expect(state.providerCatalog.byWorkspaceId?.B.mcpServers?.[0]).toEqual({
        id: 'server-B',
        name: 'same-name',
        type: 'stdio',
        command: 'node',
      });
      releaseA({ providers: [] });
      await settle();
      expect(selectContextDefaultProvider.select(state as StoreState, 'A')).toBe('A');
      expect(selectContextDefaultProvider.select(state as StoreState, 'B')).toBe('B');
      expect(selectContextSpecialists.select(state as StoreState, 'B')[0].id).toBe('B');
      mocks.notification?.({
        method: 'events.event',
        params: { event: { type: 'settings:changed', data: { value: 'unqualified' } } },
      });
      await settle();
      expect(mocks.catalog.mock.calls.map(([id]) => id)).toEqual(['A', 'B', 'A', 'B']);
      expect(selectContextDefaultProvider.select(state as StoreState, 'B')).toBe('B');
      mocks.notification?.({
        method: 'events.event',
        params: {
          event: {
            type: 'workspace:updated',
            workspaceId: 'A',
            data: {
              workspaceId: 'A',
              changes: { mcpServerToggled: { serverId: 'server-A', workspaceDisabled: true } },
            },
          },
        },
      });
      await settle();
      expect(mocks.catalog.mock.calls.map(([id]) => id)).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);
      dispatch(workspaceCatalogRequested('B'));
      mocks.reconnect?.();
      await settle();
      expect(state.providerCatalog.workspaceEpoch).toBe(3);
    } finally {
      task.cancel();
      await task.toPromise();
    }
  });
});
