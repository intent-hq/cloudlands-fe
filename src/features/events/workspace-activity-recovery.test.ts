import { BackendError } from '$lib/client/live/backend-transport-types';
import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import type { StoreState } from '$store/renderer/types';
import {
  getPrincipalActionContext,
  getPrincipalConnectionContext,
} from '$store/renderer/slices/principal/principal-context';
import {
  workspaceEventsReducer,
  eventsLoaded,
  eventReceived,
  olderEventsLoaded,
} from '$store/renderer/slices/workspace-events/workspace-events-slice';
import type { WorkspaceEvent } from './types';
import { RendererEventRecovery } from './renderer-event-recovery';
import {
  acquireWorkspaceActivityDemand,
  installWorkspaceActivityRecovery,
  runWorkspaceActivityRead,
  workspaceActivityRecoveryKey,
} from './workspace-activity-recovery';
const event = (n: number): WorkspaceEvent =>
  ({
    id: String(n),
    type: 'agent:idle',
    workspaceId: 'ws',
    timestamp: new Date(n * 1000).toISOString(),
    actor: { type: 'agent', id: 'agent' },
    data: { agentId: 'agent' },
  }) as WorkspaceEvent;
const settle = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const f of cleanups.splice(0)) f();
  vi.useRealTimers();
});
const key = workspaceActivityRecoveryKey('ws');
async function harness(
  mounted = true,
  initial = [event(1)],
  expanded = false,
  afterDispatch?: () => void,
) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let state = {
    workspaceEvents: {
      ...workspaceEventsReducer(undefined, eventsLoaded('ws', initial, 'old-cursor')),
      subscriptionGeneration: 1,
      subscriptionPending: false,
    },
    workspaceLifecycle: { sessionPhaseByWorkspaceId: mounted ? { ws: 'live' } : {} },
    connections: { hasReceivedList: true, windowBackendId: 'backend' },
    daemonHealth: { health: 'up', connectionGeneration: 1 },
    principal: {
      status: 'ready',
      context: '',
      invalidation: 0,
      presentationVersion: 0,
      snapshot: { principal: { id: 'person', isAdministrator: true }, capabilities: {} },
    },
    workspace: { workspaces: createCollection('id', [{ id: 'ws' }]), capabilityContext: '' },
  } as unknown as StoreState;
  state.principal.context = getPrincipalConnectionContext(state);
  state.workspace.capabilityContext = getPrincipalActionContext(state);
  if (expanded)
    state = {
      ...state,
      workspaceEvents: workspaceEventsReducer(
        state.workspaceEvents,
        olderEventsLoaded('ws', [], 'old-cursor'),
      ),
    };
  const actions: string[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };
  const dispatch = (action: { type: string; payload?: unknown }) => {
    actions.push(action.type);
    state = {
      ...state,
      workspaceEvents: workspaceEventsReducer(state.workspaceEvents, action as never),
    };
    notify();
    afterDispatch?.();
    return action;
  };
  let receive!: (event: RecoveryNotification) => void;
  let sequence = 0;
  const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    if (method === 'events.subscribe') return { subscriptionId: `s${++sequence}`, lossRecovery: 1 };
    if (method === 'events.fence') return params;
    if (method === 'event.query') return { items: [event(2)], nextToken: null };
    throw new Error(`Unexpected request: ${method}`);
  });
  const session = createEventRecoverySession({
    supported: true,
    isCurrent: () => true,
    onRetired: () => () => {},
    onNotification: (fn) => {
      receive = fn;
      return () => {};
    },
    request: async (method, params, observe) => {
      const result = await request(method, params);
      observe?.(result);
      return result;
    },
    dispose: () => {},
  });
  const registry = new RendererEventRecovery();
  const off = registry.onSession((scope) =>
    installWorkspaceActivityRecovery(
      scope,
      {
        getState: () => state,
        dispatch,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
      },
      registry,
    ),
  );
  const scope = registry.attach(session);
  await scope.subscribe({ workspaceId: 'ws', eventTypes: ['*'] }, { recover: true });
  cleanups.push(() => {
    off();
    registry.dispose();
  });
  return {
    registry,
    actions,
    receive: (notification: RecoveryNotification) => receive(notification),
    uninstall: off,
    scope,
    request,
    dispatch,
    get state() {
      return state;
    },
    update: (fn: (s: StoreState) => void) => {
      fn(state);
      notify();
    },
    loss: (generation = '1', id = 's1') =>
      receive({
        method: 'events.lost',
        params: { subscriptionId: id, generation, scope: { workspaceId: 'ws' } },
      }),
  };
}

describe('workspace activity recovery', () => {
  it('recovers a lost final durable row once with no event side effects or transcript reads', async () => {
    const h = await harness();
    expect(h.request.mock.calls.map((c) => c[0])).toEqual(['events.subscribe']);
    h.loss();
    await settle();
    expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((e) => e.id)).toEqual(['2']);
    expect(h.state.workspaceEvents.byWorkspaceId.ws).toMatchObject({
      nextToken: null,
      endReached: true,
      loading: false,
      loadingOlder: false,
    });
    expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(1);
    expect(
      h.request.mock.calls.filter(
        (c) => !['events.subscribe', 'event.query', 'events.fence'].includes(c[0]),
      ),
    ).toEqual([]);
    expect(h.actions).not.toContain(eventReceived.type);
    h.loss();
    await settle();
    expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(1);
  });
  it('rebuilds expanded loaded depth and cursor with dedup in one bounded cycle', async () => {
    const h = await harness(
      true,
      Array.from({ length: 250 }, (_, i) => event(i + 1)),
      true,
    );
    h.request.mockImplementation(async (method, raw) => {
      if (method === 'events.fence') return raw;
      if (method !== 'event.query') throw Error(method);
      const params = raw as { limit: number; nextToken?: string };
      const offset = Number(params.nextToken ?? 0);
      return {
        items: Array.from({ length: params.limit }, (_, i) => event(1000 - offset - i)),
        nextToken: String(offset + params.limit),
      };
    });
    h.loss();
    await settle();
    const ws = h.state.workspaceEvents.byWorkspaceId.ws;
    expect(ws.events).toHaveLength(250);
    expect(ws.events[0].id).toBe('751');
    expect(ws.events.at(-1)?.id).toBe('1000');
    expect(ws).toMatchObject({ historyExpanded: true, nextToken: '250', endReached: false });
    expect(h.request.mock.calls.filter((c) => c[0] === 'event.query').map((c) => c[1])).toEqual([
      { workspaceId: 'ws', paginate: true, limit: 100 },
      { workspaceId: 'ws', paginate: true, limit: 100, nextToken: '100' },
      { workspaceId: 'ws', paginate: true, limit: 50, nextToken: '200' },
    ]);
  });
  it('deduplicates page rows and preserves the authoritative continuation', async () => {
    const h = await harness(true, [event(1)], true);
    h.request.mockImplementation(async (method, raw) =>
      method === 'event.query' ? { items: [event(3), event(3), event(2)], nextToken: null } : raw,
    );
    h.loss();
    await settle();
    expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((e) => e.id)).toEqual(['2', '3']);
    expect(h.state.workspaceEvents.byWorkspaceId.ws.historyExpanded).toBe(true);
  });
  it('invalidates inactive loaded history lazily and recovers on explicit demand', async () => {
    const h = await harness(false);
    h.loss();
    await settle();
    expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(0);
    const release = acquireWorkspaceActivityDemand('ws');
    await settle();
    expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((e) => e.id)).toEqual(['2']);
    release();
    h.loss('2');
    await settle();
    expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(1);
  });
  it('waits for an old ordinary page across lease replacement and rejects its commit', async () => {
    const h = await harness();
    const receipt = h.registry.capture(key);
    let resolve!: () => void;
    const old = runWorkspaceActivityRead(
      key,
      receipt,
      () => new Promise<void>((r) => (resolve = r)),
    );
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['agent:*'] }, { recover: true });
    h.loss();
    await settle();
    expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(0);
    resolve();
    await old;
    await settle();
    expect(
      receipt.commit(() => {
        h.dispatch(olderEventsLoaded('ws', [event(99)], 'stale'));
      }),
    ).toBe(false);
    expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((e) => e.id)).toEqual(['2']);
    expect(h.state.workspaceEvents.byWorkspaceId.ws.nextToken).toBe(null);
  });
  it('serializes different ordinary cursor requests without coalescing them', async () => {
    const registry = new RendererEventRecovery();
    let release!: () => void;
    const requests: string[] = [];
    const first = runWorkspaceActivityRead(
      'legacy-activity',
      registry.capture('legacy-activity'),
      () => {
        requests.push('first');
        return new Promise<void>((r) => (release = r));
      },
    );
    const second = runWorkspaceActivityRead(
      'legacy-activity',
      registry.capture('legacy-activity'),
      async () => {
        requests.push('older');
      },
    );
    expect(requests).toEqual(['first']);
    release();
    await first;
    await second;
    expect(requests).toEqual(['first', 'older']);
    registry.dispose();
  });
  it('rejects held replies and queued pagination after a newer ordinary push', async () => {
    const h = await harness();
    const receipt = h.registry.capture(key);
    let resolve!: () => void;
    const first = runWorkspaceActivityRead(
      key,
      receipt,
      () => new Promise<void>((r) => (resolve = r)),
    );
    const send = vi.fn(async () => []);
    const queued = runWorkspaceActivityRead(key, receipt, send);
    const rejected = expect(queued).rejects.toThrow();
    expect(h.registry.push(key)).toBe(true);
    h.registry.capture(key).commit(() => {
      h.dispatch(eventReceived('ws', event(3)));
    });
    resolve();
    await first;
    await rejected;
    expect(send).not.toHaveBeenCalled();
    expect(
      receipt.commit(() => {
        h.dispatch(eventsLoaded('ws', [event(0)], 'stale'));
      }),
    ).toBe(false);
    expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((e) => e.id)).toEqual(['1', '3']);
    expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(0);
  });
  it.each(['principal', 'backend', 'subscription', 'workspace', 'mount'] as const)(
    'retires old pagination receipts on %s ABA',
    async (kind) => {
      const h = await harness();
      const receipt = h.registry.capture(key);
      if (kind === 'principal') {
        h.update((s) => {
          s.principal.invalidation++;
        });
        h.update((s) => {
          s.principal.invalidation--;
        });
      } else if (kind === 'backend') {
        h.update((s) => {
          s.connections.windowBackendId = 'other' as never;
        });
        h.update((s) => {
          s.connections.windowBackendId = 'backend' as never;
        });
      } else if (kind === 'subscription') {
        h.update((s) => {
          s.workspaceEvents.subscriptionGeneration++;
        });
        h.update((s) => {
          s.workspaceEvents.subscriptionGeneration--;
        });
      } else if (kind === 'workspace') {
        h.update((s) => {
          s.workspace.workspaces = createCollection('id');
        });
        h.update((s) => {
          s.workspace.workspaces = createCollection('id', [{ id: 'ws' }] as never);
        });
      } else {
        h.update((s) => {
          delete s.workspaceLifecycle.sessionPhaseByWorkspaceId.ws;
        });
        h.update((s) => {
          s.workspaceLifecycle.sessionPhaseByWorkspaceId.ws = 'live';
        });
      }
      expect(
        receipt.commit(() => {
          h.dispatch(eventsLoaded('ws', [event(90)], 'stale'));
        }),
      ).toBe(false);
      if (kind !== 'mount') expect(h.state.workspaceEvents.byWorkspaceId.ws).toBeUndefined();
    },
  );
  it('rejects malformed/repeating cursor snapshots without partial state replacement', async () => {
    const h = await harness(
      true,
      Array.from({ length: 200 }, (_, i) => event(i + 1)),
      true,
    );
    h.request.mockImplementation(async (method, raw) =>
      method === 'event.query' ? { items: [event(999)], nextToken: 'loop' } : raw,
    );
    h.loss();
    await settle();
    expect(h.state.workspaceEvents.byWorkspaceId.ws.events.at(-1)?.id).toBe('200');
    expect(h.state.workspaceEvents.byWorkspaceId.ws.nextToken).toBe('old-cursor');
    expect(h.request.mock.calls.filter((c) => c[0] === 'event.query').length).toBeLessThanOrEqual(
      2,
    );
  });
  it('clears protected history on canonical denial without retry', async () => {
    const h = await harness();
    h.request.mockImplementation(async (method, raw) => {
      if (method === 'event.query') throw { rpcCode: -32003 };
      return raw;
    });
    h.loss();
    await settle();
    await vi.advanceTimersByTimeAsync(6000);
    await settle();
    expect(h.state.workspaceEvents.byWorkspaceId.ws).toBeUndefined();
    expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(1);
  });
  it('clears installed history on teardown and invalidates its captured page receipt', async () => {
    const h = await harness();
    const receipt = h.registry.capture(key);
    h.uninstall();
    expect(h.state.workspaceEvents.byWorkspaceId.ws).toBeUndefined();
    expect(receipt.commit(() => undefined)).toBe(false);
  });
});

it.each(['recovery', 'ordinary'] as const)(
  'retains the physical read lane after a %s timeout',
  async (kind) => {
    const registry = new RendererEventRecovery();
    const key = 'timeout-workspace-activity';
    let release!: () => void;
    const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
      release = () => resolve({ errors: [], retired: false });
    });
    const error =
      kind === 'recovery'
        ? new RecoveryRequestTimeoutError(completion)
        : new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
    await expect(
      runWorkspaceActivityRead(key, registry.capture(key), async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    const send = vi.fn(async () => ['new']);
    const pending = runWorkspaceActivityRead(key, registry.capture(key), send);
    try {
      await settle();
      expect(send).not.toHaveBeenCalled();
    } finally {
      release();
      await pending;
      registry.dispose();
    }
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it('does not query durable history for transient stream, presence or watcher pushes', async () => {
  const h = await harness();
  h.loss();
  await settle();
  for (const type of [
    'chat:stream:delta',
    'agent:stream:activity',
    'terminal:data',
    'script:output',
    'presence:changed',
    'note:presence',
    'line-attribution:updated',
    'note:delete-operation',
    'client:updated',
    'host:exec:stdout',
    'host:exec:stderr',
  ])
    h.receive({
      method: 'events.event',
      params: { subscriptionId: 's1', event: { ...event(50), type } },
    });
  h.receive({
    method: 'events.event',
    params: {
      subscriptionId: 's1',
      event: { ...event(51), type: 'file:changed', actor: { type: 'system' } },
    },
  });
  await vi.advanceTimersByTimeAsync(1000);
  await settle();
  expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(1);
  expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((e) => e.id)).toEqual(['2']);
});

it('uses a fresh snapshot instead of accepting an unversioned delayed durable push after recovery', async () => {
  const h = await harness();
  h.loss();
  await settle();
  h.request.mockImplementation(async (method, raw) =>
    method === 'event.query' ? { items: [event(4)], nextToken: null } : raw,
  );
  h.receive({ method: 'events.event', params: { subscriptionId: 's1', event: event(0) } });
  expect(
    h.registry.capture(key).commit(() => {
      h.dispatch(eventReceived('ws', event(0)));
    }),
  ).toBe(false);
  await vi.advanceTimersByTimeAsync(250);
  await settle();
  expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((e) => e.id)).toEqual(['4']);
  expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(2);
});

it('covers previously unknown durable families and overlapping loss leases once', async () => {
  const h = await harness();
  await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['future:*'] }, { recover: true });
  h.loss();
  h.loss('1', 's2');
  await settle();
  expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((e) => e.id)).toEqual(['2']);
  expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(1);
});

it('discards a held recovery when another loss arrives and runs only one trailing cycle', async () => {
  const h = await harness();
  let resolve!: (page: { items: WorkspaceEvent[]; nextToken: null }) => void;
  let queries = 0;
  h.request.mockImplementation(async (method, raw) => {
    if (method !== 'event.query') return raw;
    if (++queries === 1)
      return new Promise((done) => {
        resolve = done;
      });
    return { items: [event(5)], nextToken: null };
  });
  h.loss();
  await settle();
  h.loss('2');
  h.loss('3');
  await settle();
  expect(queries).toBe(1);
  resolve({ items: [event(3)], nextToken: null });
  await settle();
  expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((e) => e.id)).toEqual(['1']);
  await vi.advanceTimersByTimeAsync(250);
  await settle();
  expect(queries).toBe(2);
  expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((e) => e.id)).toEqual(['5']);
});

it.each([-32003, -32001, -32602])(
  'retires the original ordinary owner on late canonical denial %s',
  async (rpcCode) => {
    const h = await harness();
    const readKey = workspaceActivityRecoveryKey('ws');
    const receipt = h.registry.capture(readKey);
    let release!: (value: { errors: readonly unknown[]; retired: boolean }) => void;
    const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
      release = resolve;
    });
    const timeout = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
    await expect(
      runWorkspaceActivityRead(readKey, receipt, async () => {
        throw timeout;
      }),
    ).rejects.toBe(timeout);
    h.registry.push(readKey);
    release({ errors: [{ rpcCode, data: { code: 'not-found' } }], retired: false });
    await settle();
    expect(h.state.workspaceEvents.byWorkspaceId.ws).toBeUndefined();
    expect(h.registry.capture(readKey).commit(() => undefined)).toBe(false);
    h.loss();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.request.mock.calls.filter((c) => !c[0].startsWith('events.')).length).toBe(0);
  },
);

it.each([true, false])(
  'does not clear replacement state from a late ordinary completion (retired=%s)',
  async (retired) => {
    const h = await harness();
    const readKey = workspaceActivityRecoveryKey('ws');
    let release!: (value: { errors: readonly unknown[]; retired: boolean }) => void;
    const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
      release = resolve;
    });
    const timeout = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
    await expect(
      runWorkspaceActivityRead(readKey, h.registry.capture(readKey), async () => {
        throw timeout;
      }),
    ).rejects.toBe(timeout);
    if (!retired) {
      h.registry.refreshAuthority();
      h.dispatch(eventsLoaded('ws', [event(99)], null));
    }
    const newer = h.registry.capture(readKey);
    release({ errors: [{ rpcCode: -32003 }], retired });
    await settle();
    expect(newer.commit(() => undefined)).toBe(true);
    if (!retired)
      expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((row) => row.id)).toEqual(['99']);
    if (retired)
      expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((row) => row.id)).toEqual(['1']);
  },
);

it('clears immediate ordinary denial while another physical read is held', async () => {
  const h = await harness();
  const readKey = workspaceActivityRecoveryKey('ws');
  let release!: () => void;
  const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
    release = () => resolve({ errors: [], retired: false });
  });
  const timeout = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
  await expect(
    runWorkspaceActivityRead(
      'independent-sibling-workspace-activity',
      h.registry.capture('independent-sibling-workspace-activity'),
      async () => {
        throw timeout;
      },
    ),
  ).rejects.toBe(timeout);
  try {
    await expect(
      runWorkspaceActivityRead(readKey, h.registry.capture(readKey), async () => {
        throw { rpcCode: -32003 };
      }),
    ).rejects.toEqual({ rpcCode: -32003 });
    expect(h.state.workspaceEvents.byWorkspaceId.ws).toBeUndefined();
  } finally {
    release();
    await settle();
  }
});

it.each(['authority', 'session'] as const)(
  'keeps physical occupancy only across the same session after %s replacement',
  async (change) => {
    const h = await harness();
    const readKey = workspaceActivityRecoveryKey('ws');
    let release!: () => void;
    const completion = new Promise<{ errors: readonly unknown[]; retired: boolean }>((resolve) => {
      release = () => resolve({ errors: [], retired: true });
    });
    const timeout = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, completion);
    await expect(
      runWorkspaceActivityRead(readKey, h.registry.capture(readKey), async () => {
        throw timeout;
      }),
    ).rejects.toBe(timeout);
    const next = change === 'session' ? await harness() : h;
    if (change === 'authority') h.registry.refreshAuthority();
    const send = vi.fn(async () => 'replacement');
    const pending = runWorkspaceActivityRead(readKey, next.registry.capture(readKey), send);
    try {
      await settle();
      expect(send).toHaveBeenCalledTimes(change === 'session' ? 1 : 0);
    } finally {
      release();
      await pending;
    }
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it('does not treat ordinary invalid parameters as a canonical disappearance', async () => {
  const h = await harness();
  const readKey = workspaceActivityRecoveryKey('ws');
  await expect(
    runWorkspaceActivityRead(readKey, h.registry.capture(readKey), async () => {
      throw { rpcCode: -32602 };
    }),
  ).rejects.toEqual({ rpcCode: -32602 });
  expect(h.registry.capture(readKey).commit(() => undefined)).toBe(true);
});

it('keeps inactive activity recovery demand after an ordinary stale caller releases it', async () => {
  const h = await harness(false);
  h.loss();
  await settle();
  expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(0);
  const release = acquireWorkspaceActivityDemand('ws');
  release();
  await settle();
  expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((row) => row.id)).toEqual(['2']);
  expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(1);
  h.loss('2');
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(1);
});

it('releases clean inactive activity demand without querying history', async () => {
  const h = await harness(false);
  const release = acquireWorkspaceActivityDemand('ws');
  expect(h.registry.capture(key).commit(() => undefined)).toBe(true);
  release();
  release();
  await settle();
  expect(h.registry.capture(key).isCurrent()).toBe(false);
  expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(0);
});

it('releases retained activity demand after the bounded recovery retry budget', async () => {
  const h = await harness(false);
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'event.query') throw new Error('temporarily unavailable');
    return original(method, params);
  });
  h.loss();
  const release = acquireWorkspaceActivityDemand('ws');
  release();
  await settle();
  await vi.advanceTimersByTimeAsync(10000);
  expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(3);
  expect(h.registry.capture(key).isCurrent()).toBe(false);
  expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((row) => row.id)).toEqual(['1']);
});

it('retiring held activity recovery cannot transfer released demand to its replacement', async () => {
  const h = await harness(false);
  let finish!: () => void;
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'event.query')
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return original(method, params);
  });
  h.loss();
  const release = acquireWorkspaceActivityDemand('ws');
  await settle();
  release();
  h.registry.refreshAuthority();
  h.dispatch(eventsLoaded('ws', [event(99)], null));
  finish();
  await settle();
  expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((row) => row.id)).toEqual(['99']);
  expect(h.registry.capture(key).isCurrent()).toBe(false);
  expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(1);
});

it('retains released activity demand until the final recovery fence commits', async () => {
  const h = await harness(false);
  const original = h.request.getMockImplementation()!;
  let fences = 0;
  let finish!: () => void;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'events.fence' && ++fences === 2)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return original(method, params);
  });
  h.loss();
  const release = acquireWorkspaceActivityDemand('ws');
  release();
  await settle();
  expect(fences).toBe(2);
  expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((row) => row.id)).toEqual(['1']);
  expect(h.request.mock.calls.filter((c) => c[0] === 'event.query')).toHaveLength(1);
  finish();
  await settle();
  expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((row) => row.id)).toEqual(['2']);
  expect(h.registry.capture(key).isCurrent()).toBe(false);
});

it('retains activity demand released after apply until the running cycle settles', async () => {
  let afterApply = () => {};
  const h = await harness(false, [event(1)], false, () => afterApply());
  const original = h.request.getMockImplementation()!;
  let reads = 0;
  h.request.mockImplementation(async (method, params) => {
    if (method === 'event.query') return { items: [event(++reads + 1)], nextToken: null };
    return original(method, params);
  });
  h.loss();
  const release = acquireWorkspaceActivityDemand('ws');
  let freshBeforeRelease = false;
  let currentAfterRelease = false;
  afterApply = () => {
    afterApply = () => {};
    void Promise.resolve().then(() => {
      const receipt = h.registry.capture(key);
      freshBeforeRelease = receipt.commit(() => undefined);
      release();
      currentAfterRelease = receipt.isCurrent();
      h.loss('2');
    });
  };
  await settle();
  await vi.advanceTimersByTimeAsync(250);
  expect(h.state.workspaceEvents.byWorkspaceId.ws.events.map((row) => row.id)).toEqual(['3']);
  expect(reads).toBe(2);
  expect(freshBeforeRelease).toBe(true);
  expect(currentAfterRelease).toBe(true);
  expect(h.registry.capture(key).isCurrent()).toBe(false);
  h.loss('3');
  await vi.advanceTimersByTimeAsync(250);
  expect(reads).toBe(2);
});
