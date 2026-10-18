import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { Workspace } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import type { BackendNotification } from '$lib/client/live/backend-transport';

const wire = vi.hoisted(() => ({
  request: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  notification: undefined as ((value: BackendNotification) => void) | undefined,
  reconnect: undefined as (() => void) | undefined,
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: wire.request,
  backendSubscribe: wire.subscribe,
  backendUnsubscribe: wire.unsubscribe,
  onBackendNotification: (handler: typeof wire.notification) => {
    wire.notification = handler;
    return () => {
      wire.notification = undefined;
    };
  },
  onBackendReconnected: (handler: typeof wire.reconnect) => {
    wire.reconnect = handler;
    return () => {
      wire.reconnect = undefined;
    };
  },
}));
vi.mock('$features/events/daemon-events-bridge.client', async (original) => ({
  ...(await original<typeof import('$features/events/daemon-events-bridge.client')>()),
  refreshDaemonEventsAfterReconnect: vi.fn(),
}));
vi.mock('$features/agent/interrupted-agents-service', () => ({
  notifyInterruptedAgentsSubscriptionReady: vi.fn(),
}));

import { createTestAgent } from '../../../../../test/factories/agent.factory';
import { bulkUpsertSessions } from '../../agent-session/agent-session-slice';
import { store } from '../../../store';
import { connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { replaceWorkspaceList, setWorkspaceHasLoaded } from '../../workspace/workspace-slice';
import { lifecycleReadSaga } from '../../workspace-lifecycle/sagas/lifecycle-read-saga';
import {
  selectWorkspaceById,
  selectWorkspacePermissionContext,
} from '../../workspace/workspace-selectors';
import { setLabsMultiplayerEnabled } from '../../user-preferences/user-preferences-slice';
import { principalSaga } from '../../principal/sagas/principal-saga';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { daemonHealthSaga } from '../../daemon-health/sagas/daemon-health-saga';
import { daemonEventsSaga } from '../../workspace-events/sagas/daemon-events-saga';
import { permissionRecoverySaga } from './permission-recovery-saga';
import { DAEMON_EVENTS_SUBSCRIBE_TYPES } from '$features/events/daemon-events-bridge.client';

const prompt = {
  requestId: 'p1',
  sessionId: 'a1',
  title: 'Run command',
  options: [{ id: 'allow_once', label: 'Allow' }],
  timestamp: 1,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
const settle = () => vi.advanceTimersByTimeAsync(0);
const reads = () =>
  wire.request.mock.calls.filter(([method]) => method === 'agent.pendingPermissions');
function hydrateWorkspace(canManage = true) {
  store.dispatch(
    replaceWorkspaceList([
      {
        id: WorkspaceId('test-workspace'),
        myRole: canManage ? 'owner' : 'collaborator',
        canManage,
      } as Workspace,
    ]),
  );
  store.dispatch(
    setWorkspaceHasLoaded(true, 'local', selectPrincipalActionContext.select(store.state)),
  );
  store.dispatch(
    bulkUpsertSessions([
      createTestAgent({ id: AgentId('a1'), workspaceId: WorkspaceId('test-workspace') }),
    ]),
  );
}
let eventId = 0;
function event(type: string, data: Record<string, unknown>) {
  wire.notification!({
    method: 'events.event',
    params: {
      subscriptionId: 'sub-new',
      event: {
        id: `event-${++eventId}-${type}`,
        workspaceId: 'test-workspace',
        type,
        timestamp: '2026-10-01T00:00:00Z',
        actor: { type: 'agent', id: 'a1' },
        data,
      },
    },
  });
}

describe('permission recovery subscription boundary', () => {
  let dispose: () => void;
  const cancel: Array<() => void> = [];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    wire.subscribe.mockResolvedValue({ subscriptionId: 'sub-old' });
    wire.unsubscribe.mockResolvedValue(undefined);
    wire.request.mockImplementation(async (method) => {
      if (method === 'client.hello') return { server: { capabilities: {} } };
      if (method === 'principal.me')
        return {
          id: 'person',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: true,
        };
      if (method === 'system.status')
        return {
          running: true,
          listenMode: 'uds',
          transports: ['uds'],
          port: null,
          protocolVersion: '2.6',
          host: { os: 'linux', arch: 'x86_64', hasDisplay: false, locality: 'local' },
        };
      if (method === 'agent.pendingPermissions') return { requests: [] };
      throw new Error(`Unexpected method ${method}`);
    });
    dispose = store.init();
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
    );
    store.dispatch(connectionStatusChanged('connected'));
  });
  function boot() {
    cancel.push(
      store.runSaga(principalSaga),
      store.runSaga(permissionRecoverySaga),
      store.runSaga(daemonEventsSaga),
    );
  }
  afterEach(() => {
    cancel
      .splice(0)
      .reverse()
      .forEach((stop) => stop());
    dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock('$lib/components/patterns/notify');
  });

  it('waits for the new subscribe ack after disconnected then connected, and live boundary events win', async () => {
    boot();
    await settle();
    hydrateWorkspace();
    await settle();
    expect(reads()).toEqual([['agent.pendingPermissions', {}]]);
    const ack = deferred<{ subscriptionId: string }>();
    const snapshot = deferred<{ requests: (typeof prompt)[] }>();
    wire.subscribe.mockReturnValueOnce(ack.promise);
    wire.request.mockClear();
    wire.request.mockImplementation(async (method) => {
      if (method === 'client.hello') return { server: { capabilities: {} } };
      if (method === 'principal.me')
        return {
          id: 'person',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: true,
        };
      if (method === 'agent.pendingPermissions') return snapshot.promise;
      throw new Error(`Unexpected method ${method}`);
    });
    store.dispatch(connectionStatusChanged('disconnected'));
    store.dispatch(connectionStatusChanged('connected'));
    wire.reconnect!();
    await settle();
    // Exercise the old principal-ready-before-ack path, including its capability hydration.
    hydrateWorkspace();
    await settle();
    expect(wire.subscribe).toHaveBeenLastCalledWith({
      eventTypes: [...DAEMON_EVENTS_SUBSCRIBE_TYPES],
    });
    expect(reads()).toEqual([]);
    event('agent:permission:request', prompt);
    ack.resolve({ subscriptionId: 'sub-new' });
    await settle();
    hydrateWorkspace();
    await settle();
    expect(reads()).toEqual([['agent.pendingPermissions', {}]]);
    expect(getItems(store.state.permission.requests)).toMatchObject([prompt]);
    event('agent:permission:resolved', {
      requestId: 'p1',
      outcome: { outcome: 'selected', optionId: 'allow_once' },
    });
    await settle();
    snapshot.resolve({ requests: [prompt] });
    await settle();
    expect(getItems(store.state.permission.requests)).toEqual([]);
    expect(reads()).toHaveLength(1);
  });
  it.each(['notification import', 'boot snapshot'] as const)(
    'keeps reconnect acknowledgment current while a %s is held',
    async (held) => {
      boot();
      await settle();
      hydrateWorkspace();
      await settle();
      expect(reads()).toHaveLength(1);
      const snapshot = deferred<{ status: string }>();
      const notification = deferred<{ notify: { warning: ReturnType<typeof vi.fn> } }>();
      const importNotification = vi.fn(() => notification.promise);
      if (held === 'notification import') {
        vi.doMock('$lib/components/patterns/notify', importNotification);
      }
      let statusHandler!: (payload: unknown) => void;
      vi.stubGlobal('electronAPI', {
        invoke: vi.fn((channel) =>
          channel === IPC_CHANNELS.BACKEND.GET_STATUS
            ? held === 'boot snapshot'
              ? snapshot.promise
              : Promise.resolve({ status: 'connected', transport: { versionMismatch: true } })
            : Promise.resolve(undefined),
        ),
        on: vi.fn((channel, handler) => {
          if (channel === IPC_CHANNELS.BACKEND.STATUS) statusHandler = handler;
          return 'status-listener';
        }),
        offById: vi.fn(),
      });
      cancel.push(store.runSaga(daemonHealthSaga));
      await settle();
      if (held === 'notification import') {
        await vi.waitFor(() => expect(importNotification).toHaveBeenCalledOnce());
      }
      statusHandler({ status: 'disconnected' });
      statusHandler({ status: 'connecting' });
      statusHandler({ status: 'connected' });
      wire.subscribe.mockResolvedValueOnce({ subscriptionId: 'sub-new' });
      wire.reconnect!();
      await settle();
      snapshot.resolve({ status: 'connected' });
      const warning = vi.fn();
      notification.resolve({ notify: { warning } });
      if (held === 'notification import')
        await vi.waitFor(() => expect(warning).toHaveBeenCalledOnce());
      await settle();
      hydrateWorkspace();
      await settle();
      expect(store.state.workspaceEvents.subscriptionPending).toBe(false);
      expect(selectPrincipalActionContext.select(store.state)).not.toBeNull();
      expect(reads()).toHaveLength(2);
      expect(wire.subscribe).toHaveBeenCalledTimes(2);

      // A genuinely newer drop still invalidates an acknowledgment in flight.
      const staleAck = deferred<{ subscriptionId: string }>();
      wire.subscribe.mockReturnValueOnce(staleAck.promise);
      statusHandler({ status: 'disconnected' });
      statusHandler({ status: 'connecting' });
      statusHandler({ status: 'connected' });
      wire.reconnect!();
      await settle();
      statusHandler({ status: 'disconnected' });
      staleAck.resolve({ subscriptionId: 'sub-stale' });
      await settle();
      expect(store.state.workspaceEvents.subscriptionPending).toBe(true);
      expect(selectPrincipalActionContext.select(store.state)).toBeNull();
      expect(reads()).toHaveLength(2);
    },
  );

  async function bootGuest() {
    store.dispatch(setLabsMultiplayerEnabled(true));
    wire.subscribe.mockResolvedValue({ subscriptionId: 'sub-new' });
    wire.request.mockImplementation(async (method) => {
      if (method === 'client.hello') return { server: { capabilities: { hostMembership: 1 } } };
      if (method === 'principal.me')
        return {
          id: 'guest',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: false,
          hostRole: 'guest',
          hostMembershipRevision: 0,
        };
      if (method === 'system.status')
        return {
          running: true,
          listenMode: 'uds',
          transports: ['uds'],
          port: null,
          protocolVersion: '2.6',
          host: { os: 'linux', arch: 'x86_64', hasDisplay: false, locality: 'local' },
        };
      if (method === 'agent.pendingPermissions') return { requests: [] };
      throw new Error(`Unexpected method ${method}`);
    });
    boot();
    await settle();
    hydrateWorkspace(false);
    await settle();
    cancel.push(store.runSaga(lifecycleReadSaga));
    wire.request.mockClear();
  }

  it('recovers once after a real membership event grants management, with quiet equivalent deltas', async () => {
    await bootGuest();
    wire.request.mockImplementation(async (method) => {
      if (method === 'workspace.get')
        return { workspace: { id: 'test-workspace', canManage: true, myRole: 'owner' } };
      if (method === 'agent.pendingPermissions') return { requests: [prompt] };
      throw new Error(`Unexpected method ${method}`);
    });
    event('workspace:updated', { changes: { members: true } });
    await settle();
    expect(wire.request).toHaveBeenCalledWith('workspace.get', { workspaceId: 'test-workspace' });
    expect(selectWorkspaceById.select(store.state, 'test-workspace')).toMatchObject({
      canManage: true,
      myRole: 'owner',
    });
    expect(reads()).toEqual([['agent.pendingPermissions', {}]]);
    expect(store.state.agentSessions.byAgentId.a1?.workspaceId).toBe('test-workspace');
    expect(selectWorkspacePermissionContext.select(store.state, 'test-workspace')).not.toBeNull();
    expect(getItems(store.state.permission.requests)).toMatchObject([prompt]);
    event('workspace:updated', { changes: { members: true } });
    await settle();
    event('workspace:updated', { changes: { title: 'Renamed' } });
    await settle();
    expect(reads()).toHaveLength(1);
  });

  it.each(['newer membership event', 'disconnect', 'capability hydration'] as const)(
    'discards a delayed grant after %s',
    async (change) => {
      await bootGuest();
      if (change === 'capability hydration') {
        hydrateWorkspace(true);
        await settle();
        wire.request.mockClear();
      }
      const reply = deferred<{ workspace: { id: string; canManage: boolean; myRole: string } }>();
      wire.request.mockImplementation(async (method) => {
        if (method === 'workspace.get') return reply.promise;
        if (method === 'agent.pendingPermissions') return { requests: [prompt] };
        throw new Error(`Unexpected method ${method}`);
      });
      event('workspace:updated', { changes: { members: true } });
      await settle();
      if (change === 'disconnect') store.dispatch(connectionStatusChanged('disconnected'));
      else if (change === 'capability hydration') {
        hydrateWorkspace(false);
        await settle();
        wire.request.mockClear();
      } else event('workspace:updated', { changes: { members: true } });
      wire.request.mockImplementation(async (method) => {
        if (method === 'workspace.get')
          return { workspace: { id: 'test-workspace', canManage: false, myRole: 'collaborator' } };
        if (method === 'agent.pendingPermissions') return { requests: [prompt] };
        throw new Error(`Unexpected method ${method}`);
      });
      reply.resolve({ workspace: { id: 'test-workspace', canManage: true, myRole: 'owner' } });
      await settle();
      expect(selectWorkspaceById.select(store.state, 'test-workspace')).toMatchObject({
        canManage: false,
        myRole: 'collaborator',
      });
      expect(reads()).toEqual([]);
      expect(getItems(store.state.permission.requests)).toEqual([]);
    },
  );
});
