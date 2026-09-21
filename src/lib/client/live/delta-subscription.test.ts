import { afterEach, describe, expect, it, vi } from 'vitest';

// FAKE transport: capture the notification handler so tests can drive
// `subscription.push` envelopes deterministically; no real socket is touched.
let notifyHandler: ((n: { method: string; params?: unknown }) => void) | null = null;
let reconnectHandler: (() => void) | null = null;
// Typed §6.9 channel traffic goes through plain `backendRequest` (the
// `chat.subscribe` precedent) — the only registration surface now that the
// legacy `events.subscribe` firehose is gone (intent-hq/monorepo#1697).
const requestCalls: Array<{ method: string; params?: unknown }> = [];
let channelIdSeq = 0;
// When true, channel `.subscribe` replies are held pending so tests can
// resolve them out of order (registration-generation race coverage). Each
// resolver settles its request with the id assigned at request time.
let deferChannelSubscribe = false;
const channelSubscribeResolvers: Array<() => void> = [];
// When set, the next N `.subscribe` calls reject instead of resolving — used
// to exercise the registration-retry backoff.
let failNextSubscribes = 0;
// When set, the next N `.subscribe` calls resolve WITHOUT a subscriptionId —
// used to exercise the registration-retry backoff on a malformed-but-settled
// reply, distinct from an outright rejection.
let emptyNextSubscribes = 0;

vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn((method: string, params?: unknown) => {
    requestCalls.push({ method, params });
    if (method.endsWith('.subscribe')) {
      if (failNextSubscribes > 0) {
        failNextSubscribes -= 1;
        return Promise.reject(new Error('registration failed'));
      }
      if (emptyNextSubscribes > 0) {
        emptyNextSubscribes -= 1;
        return Promise.resolve({});
      }
      channelIdSeq += 1;
      const subscriptionId = `chan-${channelIdSeq}`;
      if (deferChannelSubscribe) {
        return new Promise((resolve) => {
          channelSubscribeResolvers.push(() => resolve({ subscriptionId }));
        });
      }
      return Promise.resolve({ subscriptionId });
    }
    return Promise.resolve({ success: true });
  }),
  onBackendNotification: vi.fn((handler: (n: { method: string; params?: unknown }) => void) => {
    notifyHandler = handler;
    return () => {
      notifyHandler = null;
    };
  }),
  // RESUB-1: capture the reconnect listener so tests can simulate a daemon
  // restart deterministically.
  onBackendReconnected: vi.fn((handler: () => void) => {
    reconnectHandler = handler;
    return () => {
      reconnectHandler = null;
    };
  }),
}));

import {
  createDeltaSubscription,
  DeltaReconciler,
  parseSubscriptionPush,
} from './delta-subscription';

interface Row {
  id: string;
  v?: number;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const getId = (raw: Record<string, unknown>) => String(raw.id ?? '');
const normalize = (raw: Record<string, unknown>): Row => ({
  id: String(raw.id ?? ''),
  ...(typeof raw.v === 'number' ? { v: raw.v } : {}),
});

function push(method: string, params: unknown) {
  notifyHandler?.({ method, params });
}

afterEach(() => {
  notifyHandler = null;
  reconnectHandler = null;
  requestCalls.length = 0;
  channelIdSeq = 0;
  deferChannelSubscribe = false;
  channelSubscribeResolvers.length = 0;
  failNextSubscribes = 0;
  vi.clearAllMocks();
});

describe('parseSubscriptionPush', () => {
  it('returns null for non-push notifications', () => {
    expect(parseSubscriptionPush('events.event', { type: 'note:updated' })).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseSubscriptionPush('subscription.push', { kind: 'snapshot', seq: 0 })).toBeNull();
    expect(
      parseSubscriptionPush('subscription.push', { subscriptionId: 's', kind: 'x' }),
    ).toBeNull();
  });

  it('parses a snapshot envelope (defaults snapshot to [])', () => {
    const parsed = parseSubscriptionPush('subscription.push', {
      subscriptionId: 's',
      kind: 'snapshot',
      seq: 0,
      snapshot: [{ id: 'a' }],
    });
    expect(parsed).toEqual({
      subscriptionId: 's',
      kind: 'snapshot',
      seq: 0,
      snapshot: [{ id: 'a' }],
    });
  });

  it('parses a delta envelope (normalizing missing arrays + removedIds to strings)', () => {
    const parsed = parseSubscriptionPush('subscription.push', {
      subscriptionId: 's',
      kind: 'delta',
      seq: 1,
      delta: { added: [{ id: 'a' }], removedIds: [7] },
    });
    expect(parsed).toEqual({
      subscriptionId: 's',
      kind: 'delta',
      seq: 1,
      delta: { added: [{ id: 'a' }], updated: [], removedIds: ['7'] },
    });
  });
});

describe('DeltaReconciler', () => {
  it('snapshot replaces and delta upserts/removes by id', () => {
    const r = new DeltaReconciler<Row>(getId, normalize);
    r.applySnapshot(0, [{ id: 'a' }, { id: 'b', v: 1 }]);
    expect(r.values()).toEqual([{ id: 'a' }, { id: 'b', v: 1 }]);

    expect(r.applyDelta(1, { added: [{ id: 'c' }] })).toBe(true);
    expect(r.applyDelta(2, { updated: [{ id: 'b', v: 9 }] })).toBe(true);
    expect(r.applyDelta(3, { removedIds: ['a'] })).toBe(true);
    expect(r.values()).toEqual([{ id: 'b', v: 9 }, { id: 'c' }]);
  });

  it('rejects an unseeded delta and an out-of-sequence delta', () => {
    const r = new DeltaReconciler<Row>(getId, normalize);
    expect(r.applyDelta(1, { added: [{ id: 'a' }] })).toBe(false);
    r.applySnapshot(0, [{ id: 'a' }]);
    expect(r.applyDelta(3, { added: [{ id: 'b' }] })).toBe(false);
  });

  it('reset forces the next snapshot to rebuild from scratch', () => {
    const r = new DeltaReconciler<Row>(getId, normalize);
    r.applySnapshot(0, [{ id: 'a' }]);
    r.reset();
    expect(r.values()).toEqual([]);
    expect(r.applyDelta(1, { added: [{ id: 'x' }] })).toBe(false);
    r.applySnapshot(0, [{ id: 'z' }]);
    expect(r.values()).toEqual([{ id: 'z' }]);
  });
});

describe('createDeltaSubscription', () => {
  describe('static channel (single subscription id, e.g. workspace.subscribe)', () => {
    const CHANNEL = {
      subscribeMethod: 'ws.subscribe',
      unsubscribeMethod: 'ws.unsubscribe',
    };

    function setupChannel(handler = vi.fn()) {
      const dispose = createDeltaSubscription<Row>({
        channel: CHANNEL,
        getId,
        normalize,
        handler,
      });
      return { handler, dispose };
    }

    const channelSubscribes = () => requestCalls.filter((c) => c.method === 'ws.subscribe');
    const channelUnsubscribes = () => requestCalls.filter((c) => c.method === 'ws.unsubscribe');
    const chanSnapshot = (id: string, seq: number, snap: Row[]) =>
      push('subscription.push', { subscriptionId: id, kind: 'snapshot', seq, snapshot: snap });
    const chanDelta = (id: string, seq: number, d: Record<string, unknown>) =>
      push('subscription.push', { subscriptionId: id, kind: 'delta', seq, delta: d });

    it('registers the channel unconditionally via backendRequest', async () => {
      const { dispose } = setupChannel();
      await flush();
      expect(channelSubscribes()).toEqual([{ method: 'ws.subscribe', params: {} }]);
      dispose();
    });

    it('registers a static channel with its descriptor params verbatim (§6.9 scoped channels)', async () => {
      const dispose = createDeltaSubscription<Row>({
        channel: {
          subscribeMethod: 'ws.subscribe',
          unsubscribeMethod: 'ws.unsubscribe',
          params: { workspaceId: 'w1', noteId: 'n1' },
        },
        getId,
        normalize,
        handler: vi.fn(),
      });
      await flush();
      expect(channelSubscribes()).toEqual([
        { method: 'ws.subscribe', params: { workspaceId: 'w1', noteId: 'n1' } },
      ]);
      dispose();
    });

    it('reconciles seq-0 snapshot + deltas from the channel id', async () => {
      const { handler, dispose } = setupChannel();
      await flush();
      expect(handler).not.toHaveBeenCalled();

      chanSnapshot('chan-1', 0, [{ id: 'a' }, { id: 'b' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);

      chanDelta('chan-1', 1, { added: [{ id: 'c' }] });
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

      chanDelta('chan-1', 2, { updated: [{ id: 'b', v: 7 }], removedIds: ['a'] });
      expect(handler).toHaveBeenLastCalledWith([{ id: 'b', v: 7 }, { id: 'c' }]);
      dispose();
    });

    it('unsubscribes the channel on dispose', async () => {
      const { dispose } = setupChannel();
      await flush();
      dispose();
      expect(channelUnsubscribes()).toEqual([
        { method: 'ws.unsubscribe', params: { subscriptionId: 'chan-1' } },
      ]);
    });

    it('re-registers the channel on reconnect without unsubscribing the dead id', async () => {
      const { handler, dispose } = setupChannel();
      await flush();
      chanSnapshot('chan-1', 0, [{ id: 'a' }]);

      reconnectHandler?.();
      await flush();
      // The restarted daemon dropped its registry: no unsubscribe frame, one
      // fresh registration.
      expect(channelUnsubscribes()).toEqual([]);
      expect(channelSubscribes().length).toBe(2);

      // The recovery seq-0 snapshot on the NEW id re-populates the collection.
      chanSnapshot('chan-2', 0, [{ id: 'a' }, { id: 'b' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);
      dispose();
    });

    it('resnapshots on a seq gap: unsubscribes, re-registers, and rebuilds from the fresh snapshot', async () => {
      const { handler, dispose } = setupChannel();
      await flush();
      chanSnapshot('chan-1', 0, [{ id: 'a' }]);

      // Gap: seq 5 while 1 is expected → resnapshot re-registers the channel.
      chanDelta('chan-1', 5, { added: [{ id: 'b' }] });
      await flush();
      expect(channelUnsubscribes()).toEqual([
        { method: 'ws.unsubscribe', params: { subscriptionId: 'chan-1' } },
      ]);
      expect(channelSubscribes().length).toBe(2);

      chanSnapshot('chan-2', 0, [{ id: 'a' }, { id: 'b' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);
      dispose();
    });

    it('ignores pushes for unrelated subscription ids', async () => {
      const { handler, dispose } = setupChannel();
      await flush();
      chanSnapshot('chan-1', 0, [{ id: 'a' }]);
      const calls = handler.mock.calls.length;

      chanSnapshot('someone-else', 0, [{ id: 'z' }]);
      expect(handler.mock.calls.length).toBe(calls);
      dispose();
    });

    it("a stale slow registration resolve cannot overwrite a newer registration's id", async () => {
      // Registration-generation regression: the first `ws.subscribe` reply is
      // held pending, a reconnect re-registers, and the NEWER reply resolves
      // first. When the stale first reply finally lands it must not overwrite
      // the newer id — pushes for the newer id stay honored — and the stale
      // daemon-side subscription is best-effort unsubscribed.
      deferChannelSubscribe = true;
      const { handler, dispose } = setupChannel();
      await flush();
      expect(channelSubscribes().length).toBe(1); // chan-1 pending

      reconnectHandler?.();
      await flush();
      expect(channelSubscribes().length).toBe(2); // chan-2 pending

      // Newer registration resolves first.
      channelSubscribeResolvers[1]!();
      await flush();
      // Stale first reply lands late: dropped + unsubscribed, not stored.
      channelSubscribeResolvers[0]!();
      await flush();
      expect(channelUnsubscribes()).toEqual([
        { method: 'ws.unsubscribe', params: { subscriptionId: 'chan-1' } },
      ]);

      // Pushes for the newer id are honored...
      chanSnapshot('chan-2', 0, [{ id: 'a' }, { id: 'b' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);
      const calls = handler.mock.calls.length;

      // ...while pushes for the stale id stay ignored.
      chanSnapshot('chan-1', 0, [{ id: 'stale' }]);
      expect(handler.mock.calls.length).toBe(calls);
      dispose();
    });

    it('buffers a pre-ack push that races the subscribe reply and replays it on resolve', async () => {
      // PR #397 carry-over: the daemon may emit the seq-0 snapshot before the
      // `ws.subscribe` reply (carrying the subscriptionId) is processed. The
      // push must be buffered and replayed — not dropped.
      deferChannelSubscribe = true;
      const { handler, dispose } = setupChannel();
      await flush();
      expect(channelSubscribes().length).toBe(1); // chan-1 reply held pending

      // The push races ahead of its subscribe reply.
      chanSnapshot('chan-1', 0, [{ id: 'a' }, { id: 'b' }]);
      expect(handler).not.toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);

      // The reply lands: the buffered push replays.
      channelSubscribeResolvers[0]!();
      await flush();
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);
      dispose();
    });

    it('retries channel registration with backoff on failure, and eventually seeds', async () => {
      vi.useFakeTimers();
      try {
        failNextSubscribes = 2;
        const { handler, dispose } = setupChannel();
        await vi.advanceTimersByTimeAsync(0);
        expect(channelSubscribes().length).toBe(1); // first attempt (rejected)

        // First retry after 1s (RETRY_BASE_MS).
        await vi.advanceTimersByTimeAsync(1000);
        expect(channelSubscribes().length).toBe(2); // second attempt (rejected too)

        // Second retry after 2s (exponential backoff).
        await vi.advanceTimersByTimeAsync(2000);
        expect(channelSubscribes().length).toBe(3); // third attempt succeeds

        chanSnapshot('chan-1', 0, [{ id: 'a' }]);
        expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }]);
        dispose();
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears a pending retry timer on dispose', async () => {
      vi.useFakeTimers();
      try {
        failNextSubscribes = 1;
        const { dispose } = setupChannel();
        await vi.advanceTimersByTimeAsync(0);
        expect(channelSubscribes().length).toBe(1); // first attempt (rejected)
        dispose();
        await vi.advanceTimersByTimeAsync(5000);
        expect(channelSubscribes().length).toBe(1); // no retry after dispose
      } finally {
        vi.useRealTimers();
      }
    });

    it('retries when a subscribe reply resolves without a subscriptionId', async () => {
      // A resolved-but-empty reply must be treated as retryable, same as an
      // outright rejection — otherwise the channel is silently stranded with
      // no id and no retry, permanently unable to receive pushes.
      vi.useFakeTimers();
      try {
        emptyNextSubscribes = 1;
        const { handler, dispose } = setupChannel();
        await vi.advanceTimersByTimeAsync(0);
        expect(channelSubscribes().length).toBe(1); // first attempt (empty reply)

        await vi.advanceTimersByTimeAsync(1000); // RETRY_BASE_MS
        expect(channelSubscribes().length).toBe(2); // retried, this one seeds

        chanSnapshot('chan-1', 0, [{ id: 'a' }]);
        expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }]);
        dispose();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('dynamic per-id channels (per-workspace note/task/agent.subscribe)', () => {
    function makeIdSource(initial: readonly string[]) {
      let listener: ((ids: readonly string[]) => void) | null = null;
      return {
        scope: {
          subscribeIds: (l: (ids: readonly string[]) => void) => {
            listener = l;
            l(initial);
            return () => {
              listener = null;
            };
          },
          paramsForId: (id: string) => ({ workspaceId: id }),
        },
        emit(ids: readonly string[]) {
          listener?.(ids);
        },
      };
    }

    function setupDynamic(ids: readonly string[], handler = vi.fn()) {
      const source = makeIdSource(ids);
      const dispose = createDeltaSubscription<Row>({
        channel: {
          subscribeMethod: 'ws.subscribe',
          unsubscribeMethod: 'ws.unsubscribe',
          dynamic: source.scope,
        },
        getId,
        normalize,
        handler,
      });
      return { source, handler, dispose };
    }

    const channelSubscribes = () => requestCalls.filter((c) => c.method === 'ws.subscribe');
    const channelUnsubscribes = () => requestCalls.filter((c) => c.method === 'ws.unsubscribe');
    const chanSnapshot = (id: string, seq: number, snap: Row[]) =>
      push('subscription.push', { subscriptionId: id, kind: 'snapshot', seq, snapshot: snap });
    const chanDelta = (id: string, seq: number, d: Record<string, unknown>) =>
      push('subscription.push', { subscriptionId: id, kind: 'delta', seq, delta: d });

    it('registers one channel per id with per-id params', async () => {
      const { dispose } = setupDynamic(['w1', 'w2']);
      await flush();
      expect(channelSubscribes()).toEqual([
        { method: 'ws.subscribe', params: { workspaceId: 'w1' } },
        { method: 'ws.subscribe', params: { workspaceId: 'w2' } },
      ]);
      dispose();
    });

    it('each channel emits independently — confirmed siblings are not gated on an unconfirmed one', async () => {
      const { handler, dispose } = setupDynamic(['w1', 'w2']);
      await flush(); // chan-1 = w1, chan-2 = w2
      // Registering the initial (unseeded) channel set emits an empty collection.
      expect(handler).toHaveBeenLastCalledWith([]);

      // First channel confirms: emits immediately with just its entities.
      chanSnapshot('chan-1', 0, [{ id: 'a' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }]);

      // Second channel confirms: merged collection.
      chanSnapshot('chan-2', 0, [{ id: 'b' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);

      // Deltas reconcile per channel into the merged collection.
      chanDelta('chan-1', 1, { added: [{ id: 'c' }] });
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'c' }, { id: 'b' }]);
      chanDelta('chan-2', 1, { removedIds: ['b'] });
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'c' }]);
      dispose();
    });

    it('an added id registers a new channel; its entities merge in once its snapshot lands', async () => {
      const { source, handler, dispose } = setupDynamic(['w1']);
      await flush();
      chanSnapshot('chan-1', 0, [{ id: 'a' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }]);

      source.emit(['w1', 'w2']);
      await flush(); // chan-2 = w2 registered
      expect(channelSubscribes().length).toBe(2);
      // Not yet seeded: merged collection still only carries w1's entity.
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }]);

      chanSnapshot('chan-2', 0, [{ id: 'b' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);
      dispose();
    });

    it('a removed id unsubscribes its channel and evicts its entities immediately', async () => {
      const { source, handler, dispose } = setupDynamic(['w1', 'w2']);
      await flush(); // chan-1 = w1, chan-2 = w2
      chanSnapshot('chan-1', 0, [{ id: 'a' }]);
      chanSnapshot('chan-2', 0, [{ id: 'b' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);

      source.emit(['w1']);
      await flush();
      expect(channelUnsubscribes()).toEqual([
        { method: 'ws.unsubscribe', params: { subscriptionId: 'chan-2' } },
      ]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }]);
      dispose();
    });

    it('an empty desired id set registers no channels and emits nothing', async () => {
      const { dispose } = setupDynamic([]);
      await flush();
      expect(channelSubscribes()).toEqual([]);
      dispose();
    });

    it('a seq gap resnapshots only the affected channel; siblings keep their state', async () => {
      const { handler, dispose } = setupDynamic(['w1', 'w2']);
      await flush(); // chan-1, chan-2
      chanSnapshot('chan-1', 0, [{ id: 'a' }]);
      chanSnapshot('chan-2', 0, [{ id: 'b' }]);

      // Gap on w2 only: its channel re-registers; w1 is untouched.
      chanDelta('chan-2', 5, { added: [{ id: 'x' }] });
      await flush(); // chan-3 = w2 re-registration
      expect(channelUnsubscribes()).toEqual([
        { method: 'ws.unsubscribe', params: { subscriptionId: 'chan-2' } },
      ]);
      expect(channelSubscribes().length).toBe(3);
      // w2's stale values drop out of the merged collection while unseeded.
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }]);

      // Recovery snapshot restores it with w1's state intact.
      chanSnapshot('chan-3', 0, [{ id: 'b' }, { id: 'c' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      dispose();
    });

    it('reconnect re-registers every channel without unsubscribing dead ids', async () => {
      const { handler, dispose } = setupDynamic(['w1', 'w2']);
      await flush(); // chan-1, chan-2
      chanSnapshot('chan-1', 0, [{ id: 'a' }]);
      chanSnapshot('chan-2', 0, [{ id: 'b' }]);

      reconnectHandler?.();
      await flush(); // chan-3, chan-4
      expect(channelUnsubscribes()).toEqual([]);
      expect(channelSubscribes().length).toBe(4);

      // Fresh seq-0 snapshots on the NEW ids re-populate the collection.
      chanSnapshot('chan-3', 0, [{ id: 'a' }]);
      chanSnapshot('chan-4', 0, [{ id: 'b' }, { id: 'c' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      dispose();
    });

    it('buffers a pre-ack push that races its subscribe reply and replays it on resolve', async () => {
      deferChannelSubscribe = true;
      const { handler, dispose } = setupDynamic(['w1']);
      await flush();
      expect(channelSubscribes().length).toBe(1); // chan-1 reply held pending

      // The seq-0 snapshot races ahead of the subscribe reply.
      chanSnapshot('chan-1', 0, [{ id: 'a' }, { id: 'b' }]);
      expect(handler).not.toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);

      channelSubscribeResolvers[0]!();
      await flush();
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);
      dispose();
    });

    it('drops a foreign buffered push once no registration is pending (no stale replay)', async () => {
      // PR #400 review: a foreign push buffered during a pending window must
      // be cleared as soon as every subscribe reply has resolved — otherwise
      // a later registration that reuses its subscriptionId would drain the
      // stale foreign snapshot as its own seed.
      deferChannelSubscribe = true;
      const { source, handler, dispose } = setupDynamic(['w1']);
      await flush();
      expect(channelSubscribes().length).toBe(1); // chan-1 reply held pending

      // A FOREIGN push (id "chan-2" belongs to no channel of ours) arrives
      // inside the buffering window → buffered, not dropped outright.
      chanSnapshot('chan-2', 0, [{ id: 'foreign' }]);

      // chan-1's reply lands: nothing pending remains, so the foreign entry
      // is pruned. chan-1 then confirms normally.
      channelSubscribeResolvers[0]!();
      await flush();
      chanSnapshot('chan-1', 0, [{ id: 'a' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }]);

      // A new id registers and REUSES "chan-2" (mock id sequence). Without
      // the prune, the stale foreign snapshot would replay into it.
      source.emit(['w1', 'w2']);
      await flush();
      channelSubscribeResolvers[1]!();
      await flush();
      expect(handler).not.toHaveBeenCalledWith([{ id: 'a' }, { id: 'foreign' }]);

      // Its REAL seq-0 snapshot then merges genuine data.
      chanSnapshot('chan-2', 0, [{ id: 'b' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);
      dispose();
    });

    it('a subscribe reply for an id removed while in flight is dropped and unsubscribed', async () => {
      deferChannelSubscribe = true;
      const { source, handler, dispose } = setupDynamic(['w1', 'w2']);
      await flush();
      expect(channelSubscribes().length).toBe(2); // chan-1 (w1), chan-2 (w2) pending

      // w2 disappears while its registration is in flight.
      source.emit(['w1']);
      channelSubscribeResolvers[0]!();
      channelSubscribeResolvers[1]!();
      await flush();
      // The stale w2 reply releases its daemon-side subscription.
      expect(channelUnsubscribes()).toEqual([
        { method: 'ws.unsubscribe', params: { subscriptionId: 'chan-2' } },
      ]);

      // w1 alone confirms → its entities only.
      chanSnapshot('chan-1', 0, [{ id: 'a' }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }]);
      // Pushes for the dead w2 id stay ignored.
      const calls = handler.mock.calls.length;
      chanSnapshot('chan-2', 0, [{ id: 'stale' }]);
      expect(handler.mock.calls.length).toBe(calls);
      dispose();
    });

    it('unsubscribes every channel on dispose', async () => {
      const { dispose } = setupDynamic(['w1', 'w2']);
      await flush();
      dispose();
      expect(channelUnsubscribes()).toEqual([
        { method: 'ws.unsubscribe', params: { subscriptionId: 'chan-1' } },
        { method: 'ws.unsubscribe', params: { subscriptionId: 'chan-2' } },
      ]);
    });

    it('retries a channel whose subscribe reply resolves without a subscriptionId', async () => {
      // Same malformed-but-settled-reply regression as the static form: a
      // resolved response missing subscriptionId must retry with backoff,
      // not strand the channel permanently unconfirmed.
      vi.useFakeTimers();
      try {
        emptyNextSubscribes = 1;
        const { handler, dispose } = setupDynamic(['w1']);
        await vi.advanceTimersByTimeAsync(0);
        expect(channelSubscribes().length).toBe(1); // first attempt (empty reply)

        await vi.advanceTimersByTimeAsync(1000); // RETRY_BASE_MS
        expect(channelSubscribes().length).toBe(2); // retried, this one seeds

        chanSnapshot('chan-1', 0, [{ id: 'a' }]);
        expect(handler).toHaveBeenLastCalledWith([{ id: 'a' }]);
        dispose();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
