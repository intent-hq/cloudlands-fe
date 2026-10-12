import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreState } from '../../types';
import type { PermissionRequest } from './permission-types';

type Port = 'principal' | 'loaded' | 'permission' | 'denied';
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  vi.doUnmock('../principal/principal-selectors');
  vi.doUnmock('../workspace/workspace-selectors');
  vi.resetModules();
});

async function fixture() {
  vi.resetModules();
  const available = new Set<Port>();
  const events: string[] = [];
  const calls: Array<{ name: Port; receiver: unknown; args: unknown[] }> = [];
  const selectors = new Map<Port, object>();
  const unavailable = new Map<Port, Error>(
    (['principal', 'loaded', 'permission', 'denied'] as const).map((name) => [
      name,
      new Error(`Recovery port unavailable: ${name}`),
    ]),
  );
  const methodErrors = new Map<Port, Error>();
  let afterCall: ((name: Port) => void) | undefined;
  // Instrument real .select access/calls, preserving the actual callback, result and receiver.
  function instrument<Args extends unknown[], Value>(
    name: Port,
    selector: { select: (...args: Args) => Value },
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(selector, 'select');
    if (!descriptor) throw new Error(`Missing actual select descriptor: ${name}`);
    const original = selector.select;
    selectors.set(name, selector);
    Object.defineProperty(selector, 'select', {
      configurable: true,
      get() {
        events.push(`method:${name}`);
        if (methodErrors.has(name)) throw methodErrors.get(name);
        return function (this: typeof selector, ...args: Args): Value {
          events.push(`call:${name}`);
          calls.push({ name, receiver: this, args });
          const value = original.apply(this, args);
          afterCall?.(name);
          return value;
        };
      },
    });
    cleanup.push(() => Object.defineProperty(selector, 'select', descriptor));
    return () => {
      events.push(`export:${name}`);
      if (!available.has(name)) throw unavailable.get(name);
      return selector;
    };
  }
  vi.doMock('../principal/principal-selectors', async () => {
    const actual = await vi.importActual<typeof import('../principal/principal-selectors')>(
      '../principal/principal-selectors',
    );
    const read = instrument('principal', actual.selectPrincipalActionContext);
    return {
      ...actual,
      get selectPrincipalActionContext() {
        return read();
      },
    };
  });
  vi.doMock('../workspace/workspace-selectors', async () => {
    const actual = await vi.importActual<typeof import('../workspace/workspace-selectors')>(
      '../workspace/workspace-selectors',
    );
    const loaded = instrument('loaded', actual.selectWorkspaceListLoadedForBackend);
    const permission = instrument('permission', actual.selectWorkspacePermissionContext);
    const denied = instrument('denied', actual.selectWorkspaceManagementDenied);
    return {
      ...actual,
      get selectWorkspaceListLoadedForBackend() {
        return loaded();
      },
      get selectWorkspacePermissionContext() {
        return permission();
      },
      get selectWorkspaceManagementDenied() {
        return denied();
      },
    };
  });
  // Cold import of the real binding: all four recovery exports deliberately unavailable.
  const permission = await import('./permission-selectors');
  expect(events).toEqual([]);
  const { store } = await import('../../store');
  cleanup.push(store.init());
  const [
    principalActions,
    connectionActions,
    healthActions,
    eventActions,
    workspaceActions,
    permissionActions,
    agentActions,
    principalProjections,
    ids,
    workspaceFactory,
    agentFactory,
  ] = await Promise.all([
    import('../principal/principal-slice'),
    import('../connections/connections-slice'),
    import('../daemon-health/daemon-health-slice'),
    import('../workspace-events/workspace-events-slice'),
    import('../workspace/workspace-slice'),
    import('./permission-slice'),
    import('../agent-session/agent-session-slice'),
    import('../principal/principal-projections'),
    import('$shared/types/branded-ids'),
    import('../../../../test/factories/workspace.factory'),
    import('../../../../test/factories/agent.factory'),
  ]);
  function admit() {
    store.dispatch(
      connectionActions.connectionsListReceived({
        connections: [],
        activeId: 'local',
        windowBackendId: 'local',
      }),
    );
    store.dispatch(healthActions.connectionStatusChanged('connected'));
    store.dispatch(eventActions.daemonEventsSubscribed());
    const context = principalProjections.getPrincipalConnectionContext(store.state);
    if (!context) throw new Error('Actual connection context was not admitted');
    store.dispatch(principalActions.principalContextChanged(context));
    store.dispatch(
      principalActions.principalReceived(
        { context, invalidation: 0, presentationVersion: 0 },
        {
          principal: {
            id: 'owner',
            login: null,
            displayName: null,
            avatarUrl: null,
            isAdministrator: true,
            hostRole: 'owner',
            hostMembershipRevision: 1,
          },
          capabilities: {
            hostMembership: true,
            collaborationIdentity: true,
            personalPairing: false,
            authenticatedDevices: false,
          },
        },
      ),
    );
    const admitted = principalProjections.getPrincipalActionContext(store.state);
    if (!admitted) throw new Error('Actual principal was not admitted');
    return admitted;
  }
  function hydrate(context: string) {
    store.dispatch(
      workspaceActions.replaceWorkspaceList([
        workspaceFactory.createMockWorkspace({
          id: ids.WorkspaceId('z-work'),
          myRole: 'owner',
          canManage: true,
        }),
        workspaceFactory.createMockWorkspace({
          id: ids.WorkspaceId('a-work'),
          myRole: 'owner',
          canManage: true,
        }),
        workspaceFactory.createMockWorkspace({
          id: ids.WorkspaceId('b-denied'),
          myRole: 'collaborator',
          canManage: false,
        }),
      ]),
    );
    store.dispatch(workspaceActions.setWorkspaceHasLoaded(true, 'local', context));
    store.dispatch(
      agentActions.bulkUpsertSessions([
        agentFactory.createTestAgent({
          id: ids.AgentId('z-agent'),
          workspaceId: ids.WorkspaceId('z-work'),
        }),
        agentFactory.createTestAgent({
          id: ids.AgentId('a-agent'),
          workspaceId: ids.WorkspaceId('a-work'),
        }),
        agentFactory.createTestAgent({
          id: ids.AgentId('b-agent'),
          workspaceId: ids.WorkspaceId('b-denied'),
        }),
        agentFactory.createTestAgent({
          id: ids.AgentId('unbound-agent'),
          workspaceId: ids.WorkspaceId(''),
        }),
      ]),
    );
  }
  function allow(...names: Port[]) {
    for (const name of names) available.add(name);
  }
  return {
    store,
    permission,
    permissionActions,
    principalActions,
    workspaceActions,
    available,
    events,
    calls,
    selectors,
    unavailable,
    methodErrors,
    admit,
    hydrate,
    allow,
    clearTrace() {
      events.length = 0;
      calls.length = 0;
    },
    afterCall(callback: (name: Port) => void) {
      afterCall = callback;
    },
  };
}

function thrownBy(read: () => unknown): unknown {
  try {
    read();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the original selector failure');
}

function request(requestId: string, sessionId: string): PermissionRequest {
  return {
    requestId,
    sessionId,
    title: 'Run tool',
    options: [{ id: 'allow', label: 'Allow' }],
    timestamp: 1,
  };
}

function assertCalls(f: Awaited<ReturnType<typeof fixture>>, state: StoreState) {
  for (const call of f.calls) {
    expect(call.receiver).toBe(f.selectors.get(call.name));
    expect(call.args[0]).toBe(state);
  }
}

describe('permission selector import and recovery access timing', () => {
  it('imports pending counts with every recovery port unavailable and follows real request updates', async () => {
    const f = await fixture();
    expect(f.permission.selectPendingCount.select(f.store.state, 'a')).toBe(0);
    f.store.dispatch(f.permissionActions.permissionRequestReceived(request('a1', 'a')));
    f.store.dispatch(f.permissionActions.permissionRequestReceived(request('b1', 'b')));
    f.store.dispatch(f.permissionActions.permissionRequestReceived(request('a2', 'a')));
    expect(f.permission.selectPendingCount.select(f.store.state, 'a')).toBe(2);
    expect(f.permission.selectPendingCount.select(f.store.state, 'b')).toBe(1);
    f.store.dispatch(f.permissionActions.removePermissionRequest('a1'));
    expect(f.permission.selectPendingCount.select(f.store.state, 'a')).toBe(1);
    expect(f.permission.selectPermissionRequestsCollection.select(f.store.state)).toBe(
      f.store.state.permission.requests,
    );
    expect(f.events).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it('short-circuits unavailable workspace ports when the actual principal is not ready', async () => {
    const f = await fixture();
    f.allow('principal');
    const state = f.store.state;
    expect(f.permission.selectPermissionRecoveryScope.select(state)).toBeNull();
    expect(f.events).toEqual(['export:principal', 'method:principal', 'call:principal']);
    assertCalls(f, state);
    expect(f.calls[0]?.args).toEqual([state]);
  });

  it('checks actual list admission before reading workspace capabilities', async () => {
    const f = await fixture();
    f.admit();
    f.allow('principal', 'loaded');
    const state = f.store.state;
    expect(f.permission.selectPermissionRecoveryScope.select(state)).toBeNull();
    expect(f.calls.map((call) => call.name)).toEqual(['principal', 'loaded']);
    expect(f.calls[1]?.args).toEqual([state, 'local']);
    assertCalls(f, state);
  });

  it('uses canonical permission grants and sorted agents with exact receivers and arguments', async () => {
    const f = await fixture();
    const context = f.admit();
    f.hydrate(context);
    f.allow('principal', 'loaded', 'permission', 'denied');
    const state = f.store.state;
    expect(JSON.parse(f.permission.selectPermissionRecoveryScope.select(state)!)).toEqual([
      context,
      ['a-work', 'z-work'],
    ]);
    expect(f.calls.map((call) => [call.name, ...call.args.slice(1)])).toEqual([
      ['principal'],
      ['loaded', 'local'],
      ['permission', 'z-work'],
      ['permission', 'a-work'],
      ['permission', 'b-denied'],
    ]);
    assertCalls(f, state);
    f.clearTrace();
    expect(JSON.parse(f.permission.selectPermissionRecoveryAgents.select(state))).toEqual([
      ['a-agent', 'a-work', context, false],
      ['b-agent', 'b-denied', null, true],
      ['z-agent', 'z-work', context, false],
    ]);
    expect(f.calls.map((call) => [call.name, ...call.args.slice(1)])).toEqual([
      ['permission', 'z-work'],
      ['denied', 'z-work'],
      ['permission', 'a-work'],
      ['denied', 'a-work'],
      ['permission', 'b-denied'],
      ['denied', 'b-denied'],
    ]);
    assertCalls(f, state);
  });

  it('refuses recovery after real principal loss without touching workspace ports', async () => {
    const f = await fixture();
    const context = f.admit();
    f.hydrate(context);
    f.allow('principal', 'loaded', 'permission', 'denied');
    expect(f.permission.selectPermissionRecoveryScope.select(f.store.state)).not.toBeNull();
    f.store.dispatch(f.principalActions.principalContextChanged(null));
    f.available.clear();
    f.allow('principal');
    f.clearTrace();
    expect(f.permission.selectPermissionRecoveryScope.select(f.store.state)).toBeNull();
    expect(f.calls.map((call) => call.name)).toEqual(['principal']);
  });

  it('resolves the current port on each recovery read instead of retaining its import-time value', async () => {
    const f = await fixture();
    const context = f.admit();
    f.hydrate(context);
    f.allow('principal', 'loaded', 'permission', 'denied');
    expect(f.permission.selectPermissionRecoveryScope.select(f.store.state)).not.toBeNull();
    f.available.delete('permission');
    f.clearTrace();
    expect(thrownBy(() => f.permission.selectPermissionRecoveryScope.select(f.store.state))).toBe(
      f.unavailable.get('permission'),
    );
    expect(f.calls.map((call) => call.name)).toEqual(['principal', 'loaded']);
    f.allow('permission');
    expect(JSON.parse(f.permission.selectPermissionRecoveryScope.select(f.store.state)!)).toEqual([
      context,
      ['a-work', 'z-work'],
    ]);
  });

  it('resolves the loaded method before evaluating the backend argument and preserves the original error', async () => {
    const f = await fixture();
    f.admit();
    f.allow('principal', 'loaded');
    const methodFailure = new Error('Original select getter failed');
    const argumentFailure = new Error('Argument must not be evaluated');
    f.methodErrors.set('loaded', methodFailure);
    let afterPrincipal = false;
    f.afterCall((name) => {
      if (name === 'principal') afterPrincipal = true;
    });
    const connections = new Proxy(f.store.state.connections, {
      get(target, property, receiver) {
        if (property === 'windowBackendId' && afterPrincipal) {
          f.events.push('argument:backend');
          throw argumentFailure;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const state = new Proxy(f.store.state, {
      get(target, property, receiver) {
        return property === 'connections' ? connections : Reflect.get(target, property, receiver);
      },
    });
    expect(thrownBy(() => f.permission.selectPermissionRecoveryScope.select(state))).toBe(
      methodFailure,
    );
    expect(f.events).toEqual([
      'export:principal',
      'method:principal',
      'call:principal',
      'export:loaded',
      'method:loaded',
    ]);
    assertCalls(f, state);
  });

  it('propagates an actual canonical selector exception unchanged and skips later ports', async () => {
    const f = await fixture();
    f.admit();
    f.allow('principal');
    const failure = new Error('Principal snapshot read failed');
    const principal = new Proxy(f.store.state.principal, {
      get(target, property, receiver) {
        if (property === 'snapshot') throw failure;
        return Reflect.get(target, property, receiver);
      },
    });
    const state = new Proxy(f.store.state, {
      get(target, property, receiver) {
        return property === 'principal' ? principal : Reflect.get(target, property, receiver);
      },
    });
    let caught: unknown;
    try {
      f.permission.selectPermissionRecoveryScope.select(state);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(f.calls.map((call) => call.name)).toEqual(['principal']);
    assertCalls(f, state);
  });
});
