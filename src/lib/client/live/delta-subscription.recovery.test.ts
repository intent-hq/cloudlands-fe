import { afterEach, describe, expect, it, vi } from 'vitest';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { ownTypedCollectionRecovery } from './typed-collection-recovery';
import { createDeltaSubscription } from './delta-subscription';
const transport = vi.hoisted(() => ({
  notify: undefined as ((n: RecoveryNotification) => void) | undefined,
  reconnect: undefined as (() => void) | undefined,
  next: 0,
  request: vi.fn(),
}));
vi.mock('./backend-transport', () => ({
  backendRequest: (...args: unknown[]) => transport.request(...args),
  onBackendNotification: (handler: typeof transport.notify) => {
    transport.notify = handler;
    return () => {
      transport.notify = undefined;
    };
  },
  onBackendReconnected: (handler: typeof transport.reconnect) => {
    transport.reconnect = handler;
    return () => {
      transport.reconnect = undefined;
    };
  },
}));
const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
const stops: Array<() => void> = [];
function harness(supported = true, dynamic = false) {
  let ids!: (values: readonly string[]) => void;
  vi.useFakeTimers();
  vi.setSystemTime(0);
  transport.request.mockImplementation(async (method: string) =>
    method.endsWith('.subscribe') ? { subscriptionId: `typed-${++transport.next}` } : {},
  );
  let receive!: (n: RecoveryNotification) => void;
  let retired!: () => void;
  let current = true;
  const read = vi.fn(async () => ({ notes: [{ id: 'a', value: 'new' }] }));
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'events.subscribe')
      return { subscriptionId: 'generic', ...(supported ? { lossRecovery: 1 } : {}) };
    if (method === 'events.fence') return params;
    if (method === 'note.list') return read();
    if (method === 'note.subscribe' || method === 'note.unsubscribe')
      return transport.request(method, params);
    return {};
  });
  const session = createEventRecoverySession({
    supported,
    isCurrent: () => current,
    onRetired: (fn) => {
      retired = fn;
      return () => {};
    },
    onNotification: (fn) => {
      receive = fn;
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
  const scope = rendererEventRecovery.attach(session);
  const values: unknown[][] = [];
  const stop = createDeltaSubscription({
    channel: {
      subscribeMethod: 'note.subscribe',
      unsubscribeMethod: 'note.unsubscribe',
      params: { workspaceId: 'ws' },
      ...(dynamic
        ? {
            dynamic: {
              subscribeIds: (handler: typeof ids) => {
                ids = handler;
                handler(['ws']);
                return () => {};
              },
              paramsForId: (workspaceId: string) => ({ workspaceId }),
            },
          }
        : {}),
    },
    recovery: {
      eventTypes: ['note:*'],
      read: async (
        { request }: { request: <T>(method: string, params?: unknown) => Promise<T> },
        params: Record<string, unknown>,
      ) => (await request<{ notes: unknown[] }>('note.list', params)).notes,
    },
    getId: (row) => String(row.id),
    normalize: (row) => row,
    handler: (rows) => values.push(rows),
  });
  stops.push(stop);
  return {
    scope,
    ids: (values: readonly string[]) => ids(values),
    values,
    read,
    request,
    loss: (generation = '1') =>
      receive({
        method: 'events.lost',
        params: { subscriptionId: 'generic', generation, scope: { workspaceId: 'ws' } },
      }),
    push: (value: string, seq = 0, kind = 'snapshot', id = `typed-${transport.next}`) =>
      transport.notify?.({
        method: 'subscription.push',
        params: {
          subscriptionId: id,
          seq,
          kind,
          snapshot: [{ id: 'a', value }],
          delta: { updated: [{ id: 'a', value }] },
        },
      }),
    retire: () => {
      current = false;
      retired();
    },
    stop,
  };
}
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  rendererEventRecovery.dispose();
  transport.request.mockReset();
  transport.next = 0;
  vi.useRealTimers();
});

describe('typed collections after observed generic loss', () => {
  it('replaces the collection after a lost final event and ignores delayed old typed data', async () => {
    const h = harness();
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['note:*'] }, { recover: true });
    await settle();
    h.push('old');
    h.loss();
    await settle();
    expect(h.values.at(-1)).toEqual([{ id: 'a', value: 'new' }]);
    expect(h.read).toHaveBeenCalledTimes(1);
    h.push('delayed-old', 1, 'delta');
    expect(h.values.at(-1)).toEqual([{ id: 'a', value: 'new' }]);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.request.mock.calls.filter(([method]) => method === 'events.fence')).toHaveLength(4);
  });
  it('coalesces loss while a snapshot is held and rejects that obsolete snapshot', async () => {
    const h = harness();
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['note:*'] }, { recover: true });
    await settle();
    h.push('old');
    let resolve!: (value: { notes: { id: string; value: string }[] }) => void;
    h.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    h.loss();
    await settle();
    h.loss('2');
    h.loss('2');
    h.loss('3');
    resolve({ notes: [{ id: 'a', value: 'obsolete' }] });
    await settle();
    expect(h.values.at(-1)).toEqual([{ id: 'a', value: 'old' }]);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.values.at(-1)).toEqual([{ id: 'a', value: 'new' }]);
    expect(h.read).toHaveBeenCalledTimes(2);
  });
  it('clears protected rows and rejects a held snapshot on session retirement', async () => {
    const h = harness();
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['note:*'] }, { recover: true });
    await settle();
    h.push('old');
    let resolve!: (value: { notes: { id: string; value: string }[] }) => void;
    h.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    h.loss();
    await settle();
    h.retire();
    expect(h.values.at(-1)).toEqual([]);
    resolve({ notes: [{ id: 'a', value: 'private-old' }] });
    await settle();
    h.push('private-push', 1, 'delta');
    expect(h.values.at(-1)).toEqual([]);
  });
  it('preserves legacy typed delivery and reconnect without claiming loss recovery', async () => {
    const h = harness(false);
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['note:*'] }, { recover: true });
    await settle();
    h.push('old');
    h.loss();
    await settle();
    expect(h.read).not.toHaveBeenCalled();
    transport.reconnect?.();
    await settle();
    h.push('reconnected');
    expect(h.values.at(-1)).toEqual([{ id: 'a', value: 'reconnected' }]);
  });
  it('shares one authoritative read across two demanded views', async () => {
    const h = harness();
    const other: unknown[][] = [];
    const owner = ownTypedCollectionRecovery(
      'note.subscribe',
      { workspaceId: 'ws' },
      {
        eventTypes: ['note:*'],
        read: async ({ request }, params) =>
          (await request<{ notes: unknown[] }>('note.list', params)).notes,
      },
      { apply: (rows) => other.push(rows), retire: () => other.push([]), resume: () => {} },
    );
    stops.push(owner.dispose);
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['note:*'] }, { recover: true });
    h.loss();
    await settle();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.values.at(-1)).toEqual(other.at(-1));
    expect(other.at(-1)).toEqual([{ id: 'a', value: 'new' }]);
  });
  it('retires denied resources without repeated reads or stale rows', async () => {
    const h = harness();
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['note:*'] }, { recover: true });
    await settle();
    h.push('protected');
    h.read.mockRejectedValue(Object.assign(new Error('denied'), { rpcCode: -32003 }));
    h.loss();
    await settle();
    expect(h.values.at(-1)).toEqual([]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.read).toHaveBeenCalledTimes(1);
    h.push('late private', 1, 'delta');
    expect(h.values.at(-1)).toEqual([]);
  });
  it('disposes a held read without applying its result', async () => {
    const h = harness();
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['note:*'] }, { recover: true });
    await settle();
    h.push('old');
    let finish!: (value: any) => void;
    h.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    h.loss();
    await settle();
    h.stop();
    const count = h.values.length;
    finish({ notes: [{ id: 'a', value: 'disposed' }] });
    await settle();
    expect(h.values).toHaveLength(count);
  });
  it('drops a removed workspace snapshot after same-id reattachment', async () => {
    const h = harness(true, true);
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['note:*'] }, { recover: true });
    await settle();
    h.push('old');
    let finish!: (value: any) => void;
    h.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    h.loss();
    await settle();
    h.ids([]);
    expect(h.values.at(-1)).toEqual([]);
    h.ids(['ws']);
    await settle();
    h.push('reattached');
    finish({ notes: [{ id: 'a', value: 'retired' }] });
    await settle();
    expect(h.values.at(-1)).toEqual([{ id: 'a', value: 'reattached' }]);
  });
  it('rejects callbacks from a replaced backend even when subscription IDs are reused', async () => {
    const first = harness();
    await first.scope.subscribe({ workspaceId: 'ws', eventTypes: ['note:*'] }, { recover: true });
    await settle();
    first.push('private old');
    const oldCallback = transport.notify!;
    const second = harness();
    await second.scope.subscribe({ workspaceId: 'ws', eventTypes: ['note:*'] }, { recover: true });
    await settle();
    second.loss();
    await settle();
    expect(first.values.at(-1)).toEqual([{ id: 'a', value: 'new' }]);
    oldCallback({
      method: 'subscription.push',
      params: {
        subscriptionId: `typed-${transport.next}`,
        seq: 0,
        kind: 'snapshot',
        snapshot: [{ id: 'a', value: 'old authority' }],
      },
    });
    expect(first.values.at(-1)).toEqual([{ id: 'a', value: 'new' }]);
    expect(second.values.at(-1)).toEqual([{ id: 'a', value: 'new' }]);
  });
  it('bounds a failed snapshot cycle and keeps the last collection stale', async () => {
    const h = harness();
    await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['note:*'] }, { recover: true });
    await settle();
    h.push('old');
    h.read.mockRejectedValue(new Error('offline'));
    h.loss();
    await settle();
    await vi.advanceTimersByTimeAsync(100000);
    expect(h.read).toHaveBeenCalledTimes(3);
    expect(h.values.at(-1)).toEqual([{ id: 'a', value: 'old' }]);
    h.push('unverified', 1, 'delta');
    expect(h.values.at(-1)).toEqual([{ id: 'a', value: 'old' }]);
  });
});
