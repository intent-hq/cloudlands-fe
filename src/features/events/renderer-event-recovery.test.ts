import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import {
  agentLockReducer,
  setAgentLockState,
} from '$store/renderer/slices/agent-lock/agent-lock-slice';
import { RendererEventRecovery } from './renderer-event-recovery';

function harness() {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let receive!: (notification: RecoveryNotification) => void;
  let retire!: () => void;
  let current = true;
  let sequence = 0;
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'events.subscribe')
      return { subscriptionId: `lease-${++sequence}`, lossRecovery: 1 };
    if (method === 'events.fence') return params;
    if (method === 'file-tracking.getAgentLocks')
      return { lockedAgentIds: ['new'], lockedFilePaths: ['new.ts'] };
    return {};
  });
  const session = createEventRecoverySession({
    supported: true,
    isCurrent: () => current,
    onRetired: (handler) => {
      retire = handler;
      return () => {};
    },
    onNotification: (handler) => {
      receive = handler;
      return () => {};
    },
    request: async (method, params, observe) => {
      const result = await request(method, params);
      observe?.(result);
      return result;
    },
    dispose: () => {
      current = false;
    },
  });
  return {
    session,
    request,
    emit: (n: RecoveryNotification) => receive(n),
    retire: () => {
      current = false;
      retire();
    },
  };
}
async function settle() {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());

describe('renderer recovery owner lifetimes', () => {
  it('recovers a lost final lock snapshot into the reducer with one read and two fences', async () => {
    const h = harness(),
      registry = new RendererEventRecovery();
    let state = agentLockReducer(
      undefined,
      setAgentLockState('ws', { old: true }, { 'old.ts': true }),
    );
    const off = registry.onSession((scope) => {
      const owner = scope.registerResource({
        key: 'locks:ws',
        workspaceId: 'ws',
        eventTypes: ['changes:agent-locks'],
        isCurrent: () => true,
        read: ({ request }) =>
          request<{ lockedAgentIds: string[]; lockedFilePaths: string[] }>(
            'file-tracking.getAgentLocks',
            { workspaceId: 'ws' },
          ),
        apply: (snapshot) => {
          state = agentLockReducer(
            state,
            setAgentLockState(
              'ws',
              Object.fromEntries(snapshot.lockedAgentIds.map((id) => [id, true as const])),
              Object.fromEntries(snapshot.lockedFilePaths.map((path) => [path, true as const])),
            ),
          );
        },
        invalidate: () => {},
        retire: () => {
          state = agentLockReducer(state, setAgentLockState('ws', {}, {}));
        },
      });
      return () => owner.dispose();
    });
    const scope = registry.attach(h.session);
    await scope.subscribe(
      { workspaceId: 'ws', eventTypes: ['changes:agent-locks'] },
      { recover: true },
    );
    const oldReply = registry.capture('locks:ws');
    h.emit({
      method: 'events.lost',
      params: { subscriptionId: 'lease-1', generation: '1', scope: { workspaceId: 'ws' } },
    });
    await settle();
    expect(state.byWorkspaceId.ws).toEqual({
      lockedAgentIds: { new: true },
      lockedFilePaths: { 'new.ts': true },
    });
    expect(
      oldReply.commit(() => {
        state = agentLockReducer(state, setAgentLockState('ws', { old: true }, {}));
      }),
    ).toBe(false);
    expect(h.request.mock.calls).toEqual([
      [
        'events.subscribe',
        { workspaceId: 'ws', eventTypes: ['changes:agent-locks'], lossRecovery: 1 },
      ],
      ['events.fence', { subscriptionIds: ['lease-1'] }],
      ['file-tracking.getAgentLocks', { workspaceId: 'ws' }],
      ['events.fence', { subscriptionIds: ['lease-1'] }],
    ]);
    h.retire();
    expect(state.byWorkspaceId.ws).toEqual({ lockedAgentIds: {}, lockedFilePaths: {} });
    off();
    registry.dispose();
  });

  it('invalidates legacy receipts across attachment and same-key workspace ABA', () => {
    const h = harness(),
      registry = new RendererEventRecovery();
    const beforeAttach = registry.capture('locks:ws');
    const scope = registry.attach(h.session);
    const register = () =>
      scope.registerResource({
        key: 'locks:ws',
        workspaceId: 'ws',
        eventTypes: ['changes:agent-locks'],
        isCurrent: () => true,
        read: async () => [],
        apply: () => {},
        invalidate: () => {},
        retire: () => {},
      });
    const first = register(),
      old = registry.capture('locks:ws');
    first.dispose();
    const second = register();
    expect(beforeAttach.commit(() => undefined)).toBe(false);
    expect(old.commit(() => undefined)).toBe(false);
    expect(registry.capture('locks:ws').commit(() => undefined)).toBe(true);
    second.dispose();
    registry.dispose();
  });

  it('keeps command authority across pushes but never across owner ABA', () => {
    const h = harness(),
      registry = new RendererEventRecovery();
    const scope = registry.attach(h.session);
    const register = () =>
      scope.registerResource({
        key: 'agent:ws',
        workspaceId: 'ws',
        eventTypes: ['agent:*'],
        isCurrent: () => true,
        read: async () => [],
        apply: () => {},
        invalidate: () => {},
        retire: () => {},
      });
    const owner = register();
    const command = registry.captureAuthority('agent:ws');
    const snapshot = registry.capture('agent:ws');
    registry.push('agent:ws');
    expect(command.commit(() => {})).toBe(true);
    expect(snapshot.commit(() => {})).toBe(false);
    owner.dispose();
    register();
    expect(command.commit(() => {})).toBe(false);
    registry.dispose();
  });

  it('a clean direct push rejects an older reply without issuing recovery reads', () => {
    const h = harness(),
      registry = new RendererEventRecovery();
    const scope = registry.attach(h.session);
    scope.registerResource({
      key: 'locks:ws',
      workspaceId: 'ws',
      eventTypes: ['changes:agent-locks'],
      isCurrent: () => true,
      read: async () => [],
      apply: () => {},
      invalidate: () => {},
      retire: () => {},
    });
    let state = 'initial';
    const old = registry.capture('locks:ws');
    expect(registry.push('locks:ws')).toBe(true);
    registry.capture('locks:ws').commit(() => {
      state = 'push';
    });
    expect(
      old.commit(() => {
        state = 'old';
      }),
    ).toBe(false);
    expect(state).toBe('push');
    expect(h.request).not.toHaveBeenCalled();
    registry.dispose();
  });

  it('retires protected state once when caller authority changes before a direct commit', () => {
    const h = harness(),
      registry = new RendererEventRecovery();
    const scope = registry.attach(h.session);
    let authorized = true;
    const retire = vi.fn();
    scope.registerResource({
      key: 'locks:ws',
      workspaceId: 'ws',
      eventTypes: ['changes:agent-locks'],
      isCurrent: () => authorized,
      read: async () => [],
      apply: () => {},
      invalidate: () => {},
      retire,
    });
    const token = registry.capture('locks:ws');
    authorized = false;
    expect(token.commit(() => undefined)).toBe(false);
    expect(registry.push('locks:ws')).toBe(false);
    expect(retire).toHaveBeenCalledTimes(1);
    registry.dispose();
  });
  it('delivers admitted events to the bridge alongside independent owners with per-owner receipts', async () => {
    const h = harness(),
      registry = new RendererEventRecovery();
    const independent = vi.fn();
    let bridged = 'initial';
    const bridge = vi.fn((_event, receipts) => {
      receipts.get('locks:ws')?.commit(() => {
        bridged = 'push';
      });
    });
    const scope = registry.attach(h.session, bridge);
    scope.registerResource({
      key: 'locks:ws',
      workspaceId: 'ws',
      eventTypes: ['changes:agent-locks'],
      isCurrent: () => true,
      read: async () => 'recovered',
      apply: (value) => {
        bridged = value;
      },
      invalidate: () => {},
      retire: () => {},
    });
    scope.registerResource({
      key: 'independent:ws',
      workspaceId: 'ws',
      eventTypes: ['changes:agent-locks'],
      isCurrent: () => true,
      read: async () => [],
      apply: () => {},
      invalidate: () => {},
      retire: () => {},
      onEvent: independent,
    });
    await scope.subscribe(
      { workspaceId: 'ws', eventTypes: ['changes:agent-locks'] },
      { recover: true },
    );
    const event = {
      method: 'events.event',
      params: {
        subscriptionId: 'lease-1',
        event: { type: 'changes:agent-locks', workspaceId: 'ws' },
      },
    };
    h.emit(event);
    await settle();
    expect(bridged).toBe('push');
    expect(independent).toHaveBeenCalledTimes(1);
    h.emit({
      method: 'events.lost',
      params: { subscriptionId: 'lease-1', generation: '1', scope: { workspaceId: 'ws' } },
    });
    await settle();
    expect(bridged).toBe('recovered');
    h.emit(event);
    await settle();
    expect(bridged).toBe('recovered');
    expect(independent).toHaveBeenCalledTimes(1);
    expect(bridge).toHaveBeenCalledTimes(2);
    expect(bridge.mock.calls[1][1].get('locks:ws')).toBeNull();
    h.emit({ ...event, params: { ...event.params, subscriptionId: 'foreign' } });
    await settle();
    expect(bridge).toHaveBeenCalledTimes(2);
    registry.dispose();
  });

  it('binds ordinary requests and transient observers to their captured session', async () => {
    const h = harness(),
      registry = new RendererEventRecovery();
    const scope = registry.attach(h.session);
    const observed = vi.fn();
    scope.onNotification(observed);
    let resolve!: (value: unknown) => void;
    h.request.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = scope.request('snapshot');
    h.emit({ method: 'transient', params: {} });
    await settle();
    expect(observed).toHaveBeenCalledTimes(1);
    h.retire();
    resolve({ stale: true });
    await expect(pending).rejects.toThrow();
    await expect(scope.request('snapshot')).rejects.toThrow();
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(scope.isCurrent()).toBe(false);
  });
  it('retires factory requests and receipts on same-connection authority ABA without replacing the global lease', async () => {
    const h = harness(),
      registry = new RendererEventRecovery();
    const scopes: import('./renderer-event-recovery').RendererRecoveryScope[] = [];
    registry.onSession((scope) => {
      scopes.push(scope);
      scope.registerResource({
        key: 'locks:ws',
        workspaceId: 'ws',
        eventTypes: ['changes:agent-locks'],
        isCurrent: () => true,
        read: async () => [],
        apply: () => {},
        invalidate: () => {},
        retire: () => {},
      });
      return () => {};
    });
    const session = registry.attach(h.session);
    await session.subscribe(
      { workspaceId: 'ws', eventTypes: ['changes:agent-locks'] },
      { recover: true },
    );
    const old = registry.capture('locks:ws');
    registry.refreshAuthority();
    registry.refreshAuthority();
    expect(scopes).toHaveLength(3);
    expect(scopes[0].isCurrent()).toBe(false);
    await expect(scopes[0].request('snapshot')).rejects.toThrow();
    expect(old.commit(() => undefined)).toBe(false);
    expect(registry.capture('locks:ws').commit(() => undefined)).toBe(true);
    expect(session.ownsSubscription('lease-1')).toBe(true);
    expect(h.request).toHaveBeenCalledTimes(1);
    registry.dispose();
  });
});

describe('authority selected after asynchronous workspace discovery', () => {
  it.each(['retained', 'replaced', 'added', 'retired', 'loss', 'push'] as const)(
    'uses the original owner snapshot after %s',
    (change) => {
      const h = harness();
      const registry = new RendererEventRecovery();
      const scope = registry.attach(h.session);
      const owner = {
        key: 'tasks:ws',
        workspaceId: 'ws',
        eventTypes: ['task:*'],
        isCurrent: () => true,
        read: async () => null,
        apply: () => undefined,
        invalidate: () => undefined,
        retire: () => undefined,
      };
      const initial = change !== 'added' ? scope.registerResource(owner) : undefined;
      const select = registry.captureAuthoritySelector();
      if (change === 'replaced') {
        initial?.dispose();
        scope.registerResource(owner);
      }
      if (change === 'added') scope.registerResource(owner);
      if (change === 'retired') registry.dispose();
      if (change === 'loss') registry.invalidate('tasks:ws');
      if (change === 'push') registry.push('tasks:ws');
      const commit = vi.fn();
      expect(
        select('tasks:ws').commit(() => {
          commit();
        }),
      ).toBe(['retained', 'loss', 'push'].includes(change));
      expect(commit).toHaveBeenCalledTimes(['retained', 'loss', 'push'].includes(change) ? 1 : 0);
      registry.dispose();
    },
  );
});

it('keeps physical accounting identity through authority refresh and retirement', () => {
  const registry = new RendererEventRecovery();
  const legacy = registry.capturePhysicalSessionIdentity();
  registry.dispose();
  expect(registry.capturePhysicalSessionIdentity()).toBe(legacy);
  const first = harness();
  registry.attach(first.session);
  const physical = registry.capturePhysicalSessionIdentity();
  const authority = registry.captureAuthority('accounting-control');
  expect(physical).not.toBe(legacy);
  registry.refreshAuthority();
  expect(registry.capturePhysicalSessionIdentity()).toBe(physical);
  expect(authority.isCurrent()).toBe(false);
  first.retire();
  expect(registry.capturePhysicalSessionIdentity()).toBe(physical);
  registry.dispose();
  expect(registry.capturePhysicalSessionIdentity()).toBe(physical);
  const replacement = harness();
  registry.attach(replacement.session);
  expect(registry.capturePhysicalSessionIdentity()).not.toBe(physical);
  registry.dispose();
});

describe('data receipts selected after asynchronous child discovery', () => {
  it.each(['retained', 'push', 'loss', 'replaced', 'added', 'retired', 'authority'] as const)(
    'retains original data admission after %s',
    (change) => {
      const registry = new RendererEventRecovery();
      const scope = registry.attach(harness().session);
      const owner = {
        key: 'agents:child',
        workspaceId: 'ws',
        eventTypes: ['agent:*'],
        isCurrent: () => true,
        read: async () => null,
        apply: () => undefined,
        invalidate: () => undefined,
        retire: () => undefined,
      };
      const handle = change === 'added' ? undefined : scope.registerResource(owner);
      const select = registry.captureSelector();
      if (change === 'push') registry.push(owner.key);
      if (change === 'loss') registry.invalidate(owner.key);
      if (change === 'replaced') {
        handle?.dispose();
        scope.registerResource(owner);
      }
      if (change === 'added') scope.registerResource(owner);
      if (change === 'retired') registry.retireWorkspace('ws');
      if (change === 'authority') {
        registry.refreshAuthority();
        registry.refreshAuthority();
      }
      const apply = vi.fn();
      expect(select(owner.key).commit(apply)).toBe(change === 'retained');
      expect(apply).toHaveBeenCalledTimes(change === 'retained' ? 1 : 0);
      registry.dispose();
    },
  );
});

describe('captured resource retirement', () => {
  it.each([
    'current',
    'push',
    'loss',
    'missing',
    'replaced',
    'retired',
    'authority',
    'revoked',
  ] as const)('retires only the original authority after %s', (change) => {
    const registry = new RendererEventRecovery();
    const scope = registry.attach(harness().session);
    let current = true;
    const retire = vi.fn();
    const owner = {
      key: 'captured-retirement',
      workspaceId: 'ws',
      eventTypes: ['agent:*'],
      isCurrent: () => current,
      read: async () => null,
      apply: () => undefined,
      invalidate: () => undefined,
      retire,
    };
    const handle = change === 'missing' ? undefined : scope.registerResource(owner);
    const captured = registry.captureRetirement(owner.key);
    const denial = Object.assign(new Error('denied'), { rpcCode: -32003 });
    if (change === 'missing') scope.registerResource(owner);
    if (change === 'push') registry.push(owner.key);
    if (change === 'loss') registry.invalidate(owner.key);
    if (change === 'replaced') {
      handle?.dispose();
      scope.registerResource(owner);
    }
    if (change === 'retired') registry.retireWorkspace('ws');
    if (change === 'authority') {
      registry.refreshAuthority();
      scope.registerResource(owner);
    }
    if (change === 'revoked') current = false;
    const allowed = ['current', 'push', 'loss'].includes(change);
    expect(captured(denial)).toBe(allowed);
    expect(retire.mock.calls.some(([error]) => error === denial)).toBe(allowed);
    if (allowed) {
      expect(registry.captureAuthority(owner.key).isCurrent()).toBe(false);
      expect(captured(denial)).toBe(false);
      expect(retire).toHaveBeenCalledTimes(1);
    }
    registry.dispose();
  });
});
