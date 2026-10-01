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
import { upsertSession } from '../../agent-session/agent-session-slice';
import { store } from '../../../store';
import { connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { replaceWorkspaceList, setWorkspaceHasLoaded } from '../../workspace/workspace-slice';
import { principalSaga } from '../../principal/sagas/principal-saga';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
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
function hydrateWorkspace() {
  store.dispatch(replaceWorkspaceList([{ id: WorkspaceId('ws'), myRole: 'owner' } as Workspace]));
  store.dispatch(
    setWorkspaceHasLoaded(true, 'local', selectPrincipalActionContext.select(store.state)),
  );
}
function event(type: string, data: Record<string, unknown>) {
  wire.notification!({
    method: 'events.event',
    params: {
      subscriptionId: 'sub-new',
      event: {
        id: `event-${type}`,
        workspaceId: 'ws',
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
      if (method === 'agent.pendingPermissions') return { requests: [] };
      throw new Error(`Unexpected method ${method}`);
    });
    dispose = store.init();
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
    );
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(
      upsertSession(createTestAgent({ id: AgentId('a1'), workspaceId: WorkspaceId('ws') })),
    );
    cancel.push(
      store.runSaga(principalSaga),
      store.runSaga(permissionRecoverySaga),
      store.runSaga(daemonEventsSaga),
    );
  });
  afterEach(() => {
    cancel
      .splice(0)
      .reverse()
      .forEach((stop) => stop());
    dispose();
    vi.useRealTimers();
  });

  it('waits for the new subscribe ack after disconnected then connected, and live boundary events win', async () => {
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
});
