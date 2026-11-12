import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import type { BackendNotification } from '$lib/client/live/backend-transport';
import { CURRENT_PROTOCOL_VERSION } from '../../../../../test/current-protocol-version';

const wire = vi.hoisted(() => ({
  request: vi.fn(),
  hello: { server: { capabilities: {} as Record<string, number> } },
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  notification: undefined as ((value: BackendNotification) => void) | undefined,
  reconnect: undefined as (() => void) | undefined,
}));
const authority = vi.hoisted(() => ({ actionContextReads: 0 }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: wire.request,
  readBackendPrincipal: async () => ({
    hello: structuredClone(wire.hello),
    principal: await wire.request('principal.me', {}),
  }),
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
vi.mock('../../principal/principal-context', async (original) => {
  const actual = await original<typeof import('../../principal/principal-context')>();
  return {
    ...actual,
    getPrincipalActionContext: (...args: Parameters<typeof actual.getPrincipalActionContext>) => {
      authority.actionContextReads += 1;
      return actual.getPrincipalActionContext(...args);
    },
  };
});

import { createTestAgent } from '../../../../../test/factories/agent.factory';
import { bulkUpsertSessions, setAgentStreaming } from '../../agent-session/agent-session-slice';
import { store } from '../../../store';
import { connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import {
  recordWorkspaceView,
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '../../workspace/workspace-slice';
import { setLabsMultiplayerEnabled } from '../../user-preferences/user-preferences-slice';
import { principalSaga } from '../../principal/sagas/principal-saga';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { daemonEventsSaga } from '../../workspace-events/sagas/daemon-events-saga';
import { selectPermissionRecoveryScope } from '../permission-selectors';
import { permissionRecoverySaga } from './permission-recovery-saga';

const WORKSPACES = 300;
const settle = () => vi.advanceTimersByTimeAsync(0);

function hydrate(count: number) {
  const workspaces = Array.from(
    { length: count },
    (_, index) =>
      ({
        id: WorkspaceId(`ws-${index}`),
        myRole: 'owner',
        canManage: true,
      }) as Workspace,
  );
  store.dispatch(replaceWorkspaceList(workspaces));
  store.dispatch(
    setWorkspaceHasLoaded(true, 'local', selectPrincipalActionContext.select(store.state)),
  );
  store.dispatch(
    bulkUpsertSessions(
      workspaces.map((workspace, index) =>
        createTestAgent({ id: AgentId(`agent-${index}`), workspaceId: workspace.id }),
      ),
    ),
  );
}

describe('permission recovery at scale', () => {
  let dispose: () => void;
  const cancel: Array<() => void> = [];
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    wire.hello = { server: { capabilities: { hostMembership: 1 } } };
    wire.subscribe.mockResolvedValue({ subscriptionId: 'sub' });
    wire.unsubscribe.mockResolvedValue(undefined);
    wire.request.mockImplementation(async (method) => {
      if (method === 'client.hello') return { server: { capabilities: { hostMembership: 1 } } };
      if (method === 'principal.me')
        return {
          id: 'owner',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: true,
          hostRole: 'owner',
          hostMembershipRevision: 0,
        };
      if (method === 'system.status')
        return {
          running: true,
          listenMode: 'uds',
          transports: ['uds'],
          port: null,
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          host: { os: 'linux', arch: 'x86_64', hasDisplay: false, locality: 'local' },
        };
      if (method === 'agent.pendingPermissions') return { requests: [] };
      throw new Error(`Unexpected method ${method}`);
    });
    dispose = store.init();
    store.dispatch(setLabsMultiplayerEnabled(true));
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
    );
    store.dispatch(connectionStatusChanged('connected'));
    cancel.push(
      store.runSaga(principalSaga),
      store.runSaga(permissionRecoverySaga),
      store.runSaga(daemonEventsSaga),
    );
    await settle();
    hydrate(WORKSPACES);
    await settle();
  });
  afterEach(() => {
    cancel
      .splice(0)
      .reverse()
      .forEach((stop) => stop());
    dispose();
    vi.useRealTimers();
  });

  // Every slice change re-runs both recovery selectors; per-row work must not
  // re-derive principal authority (intent stall trace 2026-11-12: 6.4 s).
  it.each([
    ['a workspace slice change', (i: number) => recordWorkspaceView('ws-1', 1_000 + i)],
    ['an agent session change', (i: number) => setAgentStreaming('agent-1', i % 2 === 0)],
  ])('derives authority once per recovery evaluation after %s', async (_, action) => {
    const before = selectPermissionRecoveryScope.select(store.state);
    expect(JSON.parse(before!)[1]).toHaveLength(WORKSPACES);
    authority.actionContextReads = 0;
    for (let i = 0; i < 10; i++) store.dispatch(action(i));
    await settle();
    expect(authority.actionContextReads / 10).toBeLessThanOrEqual(8);
    expect(selectPermissionRecoveryScope.select(store.state)).toBe(before);
  });
});
