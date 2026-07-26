import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport: capture the notification handler so tests can drive
// `subscription.push` envelopes deterministically; no real socket is touched.
let notifyHandler: ((n: { method: string; params?: unknown }) => void) | null = null;
let reconnectHandler: (() => void) | null = null;
const subscribeCalls: unknown[] = [];
const unsubscribeCalls: string[] = [];
// Typed §6.9 channel traffic goes through plain `backendRequest` (the
// `chat.subscribe` precedent) — recorded separately from the firehose calls.
const requestCalls: Array<{ method: string; params?: unknown }> = [];
let channelIdSeq = 0;
// When true, channel `.subscribe` replies are held pending so tests can
// resolve them out of order (registration-generation race coverage). Each
// resolver settles its request with the id assigned at request time.
let deferChannelSubscribe = false;
const channelSubscribeResolvers: Array<() => void> = [];
// Drives the simulated `client.hello` `server.capabilities.liveState` result.
// The module must NOT consume this to flip live up-front
// (intent-hq/monorepo#775) — it gates typed-channel REGISTRATION only; the
// regression tests below prove it never suppresses legacy refetches.
let liveStateCapability = false;

vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn((method: string, params?: unknown) => {
    requestCalls.push({ method, params });
    if (method.endsWith(".subscribe")) {
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
  backendSubscribe: vi.fn((params: unknown) => {
    subscribeCalls.push(params);
    return Promise.resolve({ subscriptionId: "sub-1" });
  }),
  backendUnsubscribe: vi.fn((id: string) => {
    unsubscribeCalls.push(id);
    return Promise.resolve();
  }),
  detectLiveStateCapability: vi.fn(() => Promise.resolve(liveStateCapability)),
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
} from "./delta-subscription";

interface Row {
  id: string;
  v?: number;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const getId = (raw: Record<string, unknown>) => String(raw.id ?? "");
const normalize = (raw: Record<string, unknown>): Row => ({
  id: String(raw.id ?? ""),
  ...(typeof raw.v === "number" ? { v: raw.v } : {}),
});

function push(method: string, params: unknown) {
  notifyHandler?.({ method, params });
}

afterEach(() => {
  notifyHandler = null;
  reconnectHandler = null;
  subscribeCalls.length = 0;
  unsubscribeCalls.length = 0;
  requestCalls.length = 0;
  channelIdSeq = 0;
  deferChannelSubscribe = false;
  channelSubscribeResolvers.length = 0;
  liveStateCapability = false;
  vi.clearAllMocks();
});

describe("parseSubscriptionPush", () => {
  it("returns null for non-push notifications", () => {
    expect(parseSubscriptionPush("events.event", { type: "note:updated" })).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseSubscriptionPush("subscription.push", { kind: "snapshot", seq: 0 })).toBeNull();
    expect(
      parseSubscriptionPush("subscription.push", { subscriptionId: "s", kind: "x" }),
    ).toBeNull();
  });

  it("parses a snapshot envelope (defaults snapshot to [])", () => {
    const parsed = parseSubscriptionPush("subscription.push", {
      subscriptionId: "s",
      kind: "snapshot",
      seq: 0,
      snapshot: [{ id: "a" }],
    });
    expect(parsed).toEqual({
      subscriptionId: "s",
      kind: "snapshot",
      seq: 0,
      snapshot: [{ id: "a" }],
    });
  });

  it("parses a delta envelope (normalizing missing arrays + removedIds to strings)", () => {
    const parsed = parseSubscriptionPush("subscription.push", {
      subscriptionId: "s",
      kind: "delta",
      seq: 1,
      delta: { added: [{ id: "a" }], removedIds: [7] },
    });
    expect(parsed).toEqual({
      subscriptionId: "s",
      kind: "delta",
      seq: 1,
      delta: { added: [{ id: "a" }], updated: [], removedIds: ["7"] },
    });
  });
});

describe("DeltaReconciler", () => {
  it("snapshot replaces and delta upserts/removes by id", () => {
    const r = new DeltaReconciler<Row>(getId, normalize);
    r.applySnapshot(0, [{ id: "a" }, { id: "b", v: 1 }]);
    expect(r.values()).toEqual([{ id: "a" }, { id: "b", v: 1 }]);

    expect(r.applyDelta(1, { added: [{ id: "c" }] })).toBe(true);
    expect(r.applyDelta(2, { updated: [{ id: "b", v: 9 }] })).toBe(true);
    expect(r.applyDelta(3, { removedIds: ["a"] })).toBe(true);
    expect(r.values()).toEqual([{ id: "b", v: 9 }, { id: "c" }]);
  });

  it("rejects an unseeded delta and an out-of-sequence delta", () => {
    const r = new DeltaReconciler<Row>(getId, normalize);
    expect(r.applyDelta(1, { added: [{ id: "a" }] })).toBe(false);
    r.applySnapshot(0, [{ id: "a" }]);
    expect(r.applyDelta(3, { added: [{ id: "b" }] })).toBe(false);
  });

  it("reset forces the next snapshot to rebuild from scratch", () => {
    const r = new DeltaReconciler<Row>(getId, normalize);
    r.applySnapshot(0, [{ id: "a" }]);
    r.reset();
    expect(r.values()).toEqual([]);
    expect(r.applyDelta(1, { added: [{ id: "x" }] })).toBe(false);
    r.applySnapshot(0, [{ id: "z" }]);
    expect(r.values()).toEqual([{ id: "z" }]);
  });
});

describe("createDeltaSubscription", () => {
  function setup(initial: Row[]) {
    const handler = vi.fn();
    const fetchAll = vi.fn(async () => initial);
    const dispose = createDeltaSubscription<Row>({
      eventTypes: ["x:changed"],
      matchLegacyEvent: (method) => method === "events.event",
      fetchAll,
      getId,
      normalize,
      handler,
    });
    return { handler, fetchAll, dispose };
  }

  const snapshot = (seq: number, snap: Row[]) =>
    push("subscription.push", { subscriptionId: "sub-1", kind: "snapshot", seq, snapshot: snap });
  const delta = (seq: number, d: Record<string, unknown>) =>
    push("subscription.push", { subscriptionId: "sub-1", kind: "delta", seq, delta: d });

  it("serves the initial refetch, then reconciles snapshot+delta (add/update/remove)", async () => {
    const { handler } = setup([{ id: "a" }]);
    await flush();
    expect(handler).toHaveBeenLastCalledWith([{ id: "a" }]);

    snapshot(0, [{ id: "a" }, { id: "b" }]);
    expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);

    delta(1, { added: [{ id: "c" }] });
    expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }, { id: "c" }]);

    delta(2, { updated: [{ id: "b", v: 5 }], removedIds: ["a"] });
    expect(handler).toHaveBeenLastCalledWith([{ id: "b", v: 5 }, { id: "c" }]);
  });

  it("ignores legacy events once live, and ignores pushes for other subscription ids", async () => {
    const { handler } = setup([{ id: "a" }]);
    await flush();
    snapshot(0, [{ id: "a" }]);
    const calls = handler.mock.calls.length;

    push("events.event", { type: "x:changed" });
    push("subscription.push", {
      subscriptionId: "other",
      kind: "snapshot",
      seq: 0,
      snapshot: [{ id: "z" }],
    });
    await flush();
    expect(handler.mock.calls.length).toBe(calls);
  });

  it("falls back to one-shot refetch on legacy events until a push arrives", async () => {
    const { handler, fetchAll } = setup([{ id: "a" }]);
    await flush();
    expect(fetchAll).toHaveBeenCalledTimes(1);

    push("events.event", { type: "x:changed" });
    await flush();
    expect(fetchAll).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith([{ id: "a" }]);
  });

  it("reconnects to resnapshot on a sequence gap, then rebuilds from a fresh snapshot", async () => {
    const { handler } = setup([{ id: "a" }]);
    await flush();
    snapshot(0, [{ id: "a" }]);

    // Gap: seq 2 arrives while seq 1 is expected → reconnect-to-resnapshot.
    delta(2, { added: [{ id: "b" }] });
    await flush();
    expect(unsubscribeCalls).toContain("sub-1");
    expect(subscribeCalls.length).toBe(2);

    // Fresh seq-0 snapshot rebuilds the collection.
    snapshot(0, [{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });

  it("drops a stale in-flight refetch that resolves after a push re-enters live mode", async () => {
    // Epoch guard (PR #391 review): a refetch started while not live must not
    // overwrite newer reconciled state if it resolves after a push flips
    // `live` back on.
    const handler = vi.fn();
    const resolvers: Array<(items: Row[]) => void> = [];
    const fetchAll = vi.fn(() => new Promise<Row[]>((resolve) => resolvers.push(resolve)));
    const dispose = createDeltaSubscription<Row>({
      eventTypes: ["x:changed"],
      matchLegacyEvent: (method) => method === "events.event",
      fetchAll,
      getId,
      normalize,
      handler,
    });
    await flush();
    resolvers[0]!([{ id: "a" }]);
    await flush();
    snapshot(0, [{ id: "a" }]);
    expect(handler).toHaveBeenLastCalledWith([{ id: "a" }]);

    // Daemon restart: `live` drops and the bridge refetch is left pending.
    reconnectHandler?.();
    await flush();
    expect(resolvers.length).toBe(2);

    // A push flips live=true and emits reconciled state...
    snapshot(0, [{ id: "fresh" }]);
    expect(handler).toHaveBeenLastCalledWith([{ id: "fresh" }]);
    const calls = handler.mock.calls.length;

    // ...then the stale bridge refetch resolves late: it must be dropped.
    resolvers[1]!([{ id: "stale" }]);
    await flush();
    expect(handler.mock.calls.length).toBe(calls);
    expect(handler).toHaveBeenLastCalledWith([{ id: "fresh" }]);
    dispose();
  });

  it("seq-gap resnapshot drops live mode so legacy events refetch until the recovery snapshot", async () => {
    const { fetchAll } = setup([{ id: "a" }]);
    await flush();
    snapshot(0, [{ id: "a" }]);

    // Gap → resnapshot: bridge refetch fires and `live` drops, so legacy
    // events keep driving refetches while recovery is pending.
    delta(5, { added: [{ id: "b" }] });
    await flush();
    expect(fetchAll).toHaveBeenCalledTimes(2);

    push("events.event", { type: "x:changed" });
    await flush();
    expect(fetchAll).toHaveBeenCalledTimes(3);

    // The recovery seq-0 snapshot re-enters live mode.
    snapshot(0, [{ id: "a" }, { id: "b" }]);
    push("events.event", { type: "x:changed" });
    await flush();
    expect(fetchAll).toHaveBeenCalledTimes(3);
  });

  it("unsubscribes on dispose", async () => {
    const { dispose } = setup([]);
    await flush();
    dispose();
    expect(unsubscribeCalls).toContain("sub-1");
  });

  it("reconnect resets live mode so legacy events refetch until pushes resume", async () => {
    const { fetchAll } = setup([{ id: "a" }]);
    await flush();
    snapshot(0, [{ id: "a" }]);

    // Live: legacy events are ignored.
    push("events.event", { type: "x:changed" });
    await flush();
    expect(fetchAll).toHaveBeenCalledTimes(1);

    // Daemon restart: the bridge refetch fires and `live` drops, so a
    // restarted daemon that never pushes again cannot suppress refetches.
    reconnectHandler?.();
    await flush();
    expect(fetchAll).toHaveBeenCalledTimes(2);

    push("events.event", { type: "x:changed" });
    await flush();
    expect(fetchAll).toHaveBeenCalledTimes(3);

    // The first push after reconnect re-enters live mode.
    snapshot(0, [{ id: "a" }]);
    push("events.event", { type: "x:changed" });
    await flush();
    expect(fetchAll).toHaveBeenCalledTimes(3);
  });

  describe("client.hello capabilities.liveState (must not gate legacy refetch)", () => {
    it("regression #775: liveState advertised but no push seen — legacy events still refetch", async () => {
      // A hello-time capability flag alone must never silence refetches: when
      // the typed channel is not actually wired, no `subscription.push` ever
      // arrives and the UI would go permanently stale (intent-hq/monorepo#775).
      liveStateCapability = true;
      const { fetchAll } = setup([{ id: "a" }]);
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(1);

      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(2);
    });

    it("without the hello flag, legacy events drive refetch exactly as today", async () => {
      liveStateCapability = false;
      const { fetchAll } = setup([{ id: "a" }]);
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(1);

      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(2);
    });
  });

  describe("typed §6.9 channel (workspace.subscribe pattern, monorepo#775)", () => {
    const CHANNEL = {
      subscribeMethod: "ws.subscribe",
      unsubscribeMethod: "ws.unsubscribe",
    };

    function setupChannel(initial: Row[]) {
      const handler = vi.fn();
      const fetchAll = vi.fn(async () => initial);
      const dispose = createDeltaSubscription<Row>({
        eventTypes: ["x:changed"],
        channel: CHANNEL,
        matchLegacyEvent: (method) => method === "events.event",
        fetchAll,
        getId,
        normalize,
        handler,
      });
      return { handler, fetchAll, dispose };
    }

    const channelSubscribes = () => requestCalls.filter((c) => c.method === "ws.subscribe");
    const channelUnsubscribes = () => requestCalls.filter((c) => c.method === "ws.unsubscribe");
    const chanSnapshot = (id: string, seq: number, snap: Row[]) =>
      push("subscription.push", { subscriptionId: id, kind: "snapshot", seq, snapshot: snap });
    const chanDelta = (id: string, seq: number, d: Record<string, unknown>) =>
      push("subscription.push", { subscriptionId: id, kind: "delta", seq, delta: d });

    it("registers the channel via backendRequest when liveState is advertised", async () => {
      liveStateCapability = true;
      const { dispose } = setupChannel([]);
      await flush();
      expect(channelSubscribes()).toEqual([{ method: "ws.subscribe", params: {} }]);
      dispose();
    });

    it("registers a static channel with its descriptor params verbatim (§6.9 scoped channels)", async () => {
      liveStateCapability = true;
      const dispose = createDeltaSubscription<Row>({
        eventTypes: ["x:changed"],
        channel: {
          subscribeMethod: "ws.subscribe",
          unsubscribeMethod: "ws.unsubscribe",
          params: { workspaceId: "w1", noteId: "n1" },
        },
        matchLegacyEvent: (method) => method === "events.event",
        fetchAll: vi.fn(async () => []),
        getId,
        normalize,
        handler: vi.fn(),
      });
      await flush();
      expect(channelSubscribes()).toEqual([
        { method: "ws.subscribe", params: { workspaceId: "w1", noteId: "n1" } },
      ]);
      dispose();
    });

    it("does not register the channel on a legacy daemon (no liveState)", async () => {
      liveStateCapability = false;
      const { dispose } = setupChannel([]);
      await flush();
      expect(channelSubscribes()).toEqual([]);
      dispose();
    });

    it("does not touch backendRequest when no channel descriptor is configured", async () => {
      liveStateCapability = true;
      const { dispose } = setup([]);
      await flush();
      expect(requestCalls).toEqual([]);
      dispose();
    });

    it("reconciles seq-0 snapshot + deltas from the channel id and goes live", async () => {
      liveStateCapability = true;
      const { handler, fetchAll, dispose } = setupChannel([{ id: "a" }]);
      await flush();
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }]);

      chanSnapshot("chan-1", 0, [{ id: "a" }, { id: "b" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);

      chanDelta("chan-1", 1, { added: [{ id: "c" }] });
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }, { id: "c" }]);

      chanDelta("chan-1", 2, { updated: [{ id: "b", v: 7 }], removedIds: ["a"] });
      expect(handler).toHaveBeenLastCalledWith([{ id: "b", v: 7 }, { id: "c" }]);

      // Live: legacy events no longer refetch.
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(1);
      dispose();
    });

    it("unsubscribes the channel on dispose", async () => {
      liveStateCapability = true;
      const { dispose } = setupChannel([]);
      await flush();
      dispose();
      expect(channelUnsubscribes()).toEqual([
        { method: "ws.unsubscribe", params: { subscriptionId: "chan-1" } },
      ]);
    });

    it("re-registers the channel on reconnect without unsubscribing the dead id", async () => {
      liveStateCapability = true;
      const { handler, fetchAll, dispose } = setupChannel([{ id: "a" }]);
      await flush();
      chanSnapshot("chan-1", 0, [{ id: "a" }]);

      reconnectHandler?.();
      await flush();
      // The restarted daemon dropped its registry: no unsubscribe frame, one
      // fresh registration, and the bridge refetch fired.
      expect(channelUnsubscribes()).toEqual([]);
      expect(channelSubscribes().length).toBe(2);
      expect(fetchAll).toHaveBeenCalledTimes(2);

      // The recovery seq-0 snapshot on the NEW id re-enters live mode.
      chanSnapshot("chan-2", 0, [{ id: "a" }, { id: "b" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(2);
      dispose();
    });

    it("resnapshots on a seq gap: unsubscribes, re-registers, and rebuilds from the fresh snapshot", async () => {
      liveStateCapability = true;
      const { handler, fetchAll, dispose } = setupChannel([{ id: "a" }]);
      await flush();
      chanSnapshot("chan-1", 0, [{ id: "a" }]);

      // Gap: seq 5 while 1 is expected → resnapshot re-registers the channel
      // and bridges with a refetch.
      chanDelta("chan-1", 5, { added: [{ id: "b" }] });
      await flush();
      expect(channelUnsubscribes()).toEqual([
        { method: "ws.unsubscribe", params: { subscriptionId: "chan-1" } },
      ]);
      expect(channelSubscribes().length).toBe(2);
      expect(fetchAll).toHaveBeenCalledTimes(2);

      chanSnapshot("chan-2", 0, [{ id: "a" }, { id: "b" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);
      dispose();
    });

    it("ignores pushes for unrelated subscription ids", async () => {
      liveStateCapability = true;
      const { handler, dispose } = setupChannel([{ id: "a" }]);
      await flush();
      const calls = handler.mock.calls.length;

      chanSnapshot("someone-else", 0, [{ id: "z" }]);
      expect(handler.mock.calls.length).toBe(calls);
      dispose();
    });

    it("a stale slow registration resolve cannot overwrite a newer registration's id", async () => {
      // Registration-generation regression: the first `ws.subscribe` reply is
      // held pending, a reconnect re-registers, and the NEWER reply resolves
      // first. When the stale first reply finally lands it must not overwrite
      // the newer id — pushes for the newer id stay honored — and the stale
      // daemon-side subscription is best-effort unsubscribed.
      liveStateCapability = true;
      deferChannelSubscribe = true;
      const { handler, fetchAll, dispose } = setupChannel([{ id: "a" }]);
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
        { method: "ws.unsubscribe", params: { subscriptionId: "chan-1" } },
      ]);

      // Pushes for the newer id are honored (subscription goes live)...
      chanSnapshot("chan-2", 0, [{ id: "a" }, { id: "b" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);
      const calls = handler.mock.calls.length;
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(2); // initial + reconnect bridge only

      // ...while pushes for the stale id stay ignored.
      chanSnapshot("chan-1", 0, [{ id: "stale" }]);
      expect(handler.mock.calls.length).toBe(calls);
      dispose();
    });

    it("buffers a pre-ack push that races the subscribe reply and replays it on resolve", async () => {
      // PR #397 carry-over: the daemon may emit the seq-0 snapshot before the
      // `ws.subscribe` reply (carrying the subscriptionId) is processed. The
      // push must be buffered and replayed — not dropped.
      liveStateCapability = true;
      deferChannelSubscribe = true;
      const { handler, fetchAll, dispose } = setupChannel([{ id: "a" }]);
      await flush();
      expect(channelSubscribes().length).toBe(1); // chan-1 reply held pending

      // The push races ahead of its subscribe reply.
      chanSnapshot("chan-1", 0, [{ id: "a" }, { id: "b" }]);
      expect(handler).not.toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);

      // The reply lands: the buffered push replays and flips live.
      channelSubscribeResolvers[0]!();
      await flush();
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  describe("dynamic per-id channels (per-workspace note/task/agent.subscribe, monorepo#775)", () => {
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

    function setupDynamic(initial: Row[], ids: readonly string[]) {
      const source = makeIdSource(ids);
      const handler = vi.fn();
      const fetchAll = vi.fn(async () => initial);
      const dispose = createDeltaSubscription<Row>({
        eventTypes: ["x:changed"],
        channel: {
          subscribeMethod: "ws.subscribe",
          unsubscribeMethod: "ws.unsubscribe",
          dynamic: source.scope,
        },
        matchLegacyEvent: (method) => method === "events.event",
        fetchAll,
        getId,
        normalize,
        handler,
      });
      return { source, handler, fetchAll, dispose };
    }

    const channelSubscribes = () => requestCalls.filter((c) => c.method === "ws.subscribe");
    const channelUnsubscribes = () => requestCalls.filter((c) => c.method === "ws.unsubscribe");
    const chanSnapshot = (id: string, seq: number, snap: Row[]) =>
      push("subscription.push", { subscriptionId: id, kind: "snapshot", seq, snapshot: snap });
    const chanDelta = (id: string, seq: number, d: Record<string, unknown>) =>
      push("subscription.push", { subscriptionId: id, kind: "delta", seq, delta: d });

    it("registers one channel per id with per-id params", async () => {
      liveStateCapability = true;
      const { dispose } = setupDynamic([], ["w1", "w2"]);
      await flush();
      expect(channelSubscribes()).toEqual([
        { method: "ws.subscribe", params: { workspaceId: "w1" } },
        { method: "ws.subscribe", params: { workspaceId: "w2" } },
      ]);
      dispose();
    });

    it("does not register channels on a legacy daemon (no liveState)", async () => {
      liveStateCapability = false;
      const { dispose } = setupDynamic([], ["w1"]);
      await flush();
      expect(channelSubscribes()).toEqual([]);
      dispose();
    });

    it("goes live only when EVERY channel is snapshot-confirmed, merging their collections", async () => {
      liveStateCapability = true;
      const { handler, fetchAll, dispose } = setupDynamic([{ id: "a" }], ["w1", "w2"]);
      await flush(); // chan-1 = w1, chan-2 = w2
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }]);

      // One of two channels confirmed: still legacy — no merged emit, and
      // legacy events keep refetching (all-channels live-flip rule).
      chanSnapshot("chan-1", 0, [{ id: "a" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }]);
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(2);

      // Second snapshot: all confirmed → live, merged emit, refetches stop.
      chanSnapshot("chan-2", 0, [{ id: "b" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(2);

      // Deltas reconcile per channel into the merged collection.
      chanDelta("chan-1", 1, { added: [{ id: "c" }] });
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "c" }, { id: "b" }]);
      chanDelta("chan-2", 1, { removedIds: ["b"] });
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "c" }]);
      dispose();
    });

    it("an added id registers a new channel and drops live until its snapshot lands", async () => {
      liveStateCapability = true;
      const { source, handler, fetchAll, dispose } = setupDynamic([{ id: "a" }], ["w1"]);
      await flush();
      chanSnapshot("chan-1", 0, [{ id: "a" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }]);

      source.emit(["w1", "w2"]);
      await flush(); // chan-2 = w2 registered
      expect(channelSubscribes().length).toBe(2);
      // Unconfirmed new channel → back to legacy bridging.
      expect(fetchAll).toHaveBeenCalledTimes(2);
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(3);

      // Its seq-0 snapshot re-enters live with the merged collection.
      chanSnapshot("chan-2", 0, [{ id: "b" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(3);
      dispose();
    });

    it("a removed id unsubscribes its channel and evicts its entities while staying live", async () => {
      liveStateCapability = true;
      const { source, handler, fetchAll, dispose } = setupDynamic([], ["w1", "w2"]);
      await flush(); // chan-1 = w1, chan-2 = w2
      chanSnapshot("chan-1", 0, [{ id: "a" }]);
      chanSnapshot("chan-2", 0, [{ id: "b" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);

      source.emit(["w1"]);
      await flush();
      expect(channelUnsubscribes()).toEqual([
        { method: "ws.unsubscribe", params: { subscriptionId: "chan-2" } },
      ]);
      // Every remaining channel is confirmed: still live — entities evicted
      // via emit, no refetch.
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }]);
      expect(fetchAll).toHaveBeenCalledTimes(1);
      dispose();
    });

    it("an empty desired id set stays in legacy mode (refetches keep serving)", async () => {
      liveStateCapability = true;
      const { fetchAll, dispose } = setupDynamic([{ id: "a" }], []);
      await flush();
      expect(channelSubscribes()).toEqual([]);
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(2);
      dispose();
    });

    it("a seq gap resnapshots only the affected channel; siblings keep their state", async () => {
      liveStateCapability = true;
      const { handler, fetchAll, dispose } = setupDynamic([], ["w1", "w2"]);
      await flush(); // chan-1, chan-2
      chanSnapshot("chan-1", 0, [{ id: "a" }]);
      chanSnapshot("chan-2", 0, [{ id: "b" }]);

      // Gap on w2 only: its channel re-registers; w1 is untouched.
      chanDelta("chan-2", 5, { added: [{ id: "x" }] });
      await flush(); // chan-3 = w2 re-registration
      expect(channelUnsubscribes()).toEqual([
        { method: "ws.unsubscribe", params: { subscriptionId: "chan-2" } },
      ]);
      expect(channelSubscribes().length).toBe(3);
      // One channel unconfirmed → legacy bridging until recovery.
      expect(fetchAll).toHaveBeenCalledTimes(2);

      // Recovery snapshot restores live with w1's state intact.
      chanSnapshot("chan-3", 0, [{ id: "b" }, { id: "c" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }, { id: "c" }]);
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(2);
      dispose();
    });

    it("reconnect re-registers every channel without unsubscribing dead ids", async () => {
      liveStateCapability = true;
      const { handler, fetchAll, dispose } = setupDynamic([{ id: "a" }], ["w1", "w2"]);
      await flush(); // chan-1, chan-2
      chanSnapshot("chan-1", 0, [{ id: "a" }]);
      chanSnapshot("chan-2", 0, [{ id: "b" }]);

      reconnectHandler?.();
      await flush(); // chan-3, chan-4
      expect(channelUnsubscribes()).toEqual([]);
      expect(channelSubscribes().length).toBe(4);
      expect(fetchAll).toHaveBeenCalledTimes(2);

      // Fresh seq-0 snapshots on the NEW ids re-enter live mode.
      chanSnapshot("chan-3", 0, [{ id: "a" }]);
      chanSnapshot("chan-4", 0, [{ id: "b" }, { id: "c" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }, { id: "c" }]);
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(2);
      dispose();
    });

    it("buffers a pre-ack push that races its subscribe reply and replays it on resolve", async () => {
      liveStateCapability = true;
      deferChannelSubscribe = true;
      const { handler, fetchAll, dispose } = setupDynamic([{ id: "a" }], ["w1"]);
      await flush();
      expect(channelSubscribes().length).toBe(1); // chan-1 reply held pending

      // The seq-0 snapshot races ahead of the subscribe reply.
      chanSnapshot("chan-1", 0, [{ id: "a" }, { id: "b" }]);
      expect(handler).not.toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);

      channelSubscribeResolvers[0]!();
      await flush();
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(1);
      dispose();
    });

    it("drops a foreign buffered push once no registration is pending (no stale replay)", async () => {
      // PR #400 review: a foreign push buffered during a pending window must
      // be cleared as soon as every subscribe reply has resolved — otherwise
      // a later registration that reuses its subscriptionId would drain the
      // stale foreign snapshot as its own seed.
      liveStateCapability = true;
      deferChannelSubscribe = true;
      const { source, handler, fetchAll, dispose } = setupDynamic([{ id: "a" }], ["w1"]);
      await flush();
      expect(channelSubscribes().length).toBe(1); // chan-1 reply held pending

      // A FOREIGN push (id "chan-2" belongs to no channel of ours) arrives
      // inside the buffering window → buffered, not dropped outright.
      chanSnapshot("chan-2", 0, [{ id: "foreign" }]);

      // chan-1's reply lands: nothing pending remains, so the foreign entry
      // is pruned. chan-1 then confirms normally.
      channelSubscribeResolvers[0]!();
      await flush();
      chanSnapshot("chan-1", 0, [{ id: "a" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }]);

      // A new id registers and REUSES "chan-2" (mock id sequence). Without
      // the prune, the stale foreign snapshot would replay into it and flip
      // live with foreign data.
      source.emit(["w1", "w2"]);
      await flush();
      channelSubscribeResolvers[1]!();
      await flush();
      expect(handler).not.toHaveBeenCalledWith([{ id: "a" }, { id: "foreign" }]);
      // chan-2 is NOT snapshot-confirmed by the stale entry → still legacy
      // bridging (initial + live-drop on w2 add + this event = 3 fetches).
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(3);

      // Its REAL seq-0 snapshot then flips live with genuine data.
      chanSnapshot("chan-2", 0, [{ id: "b" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }, { id: "b" }]);
      dispose();
    });

    it("a subscribe reply for an id removed while in flight is dropped and unsubscribed", async () => {
      liveStateCapability = true;
      deferChannelSubscribe = true;
      const { source, handler, dispose } = setupDynamic([], ["w1", "w2"]);
      await flush();
      expect(channelSubscribes().length).toBe(2); // chan-1 (w1), chan-2 (w2) pending

      // w2 disappears while its registration is in flight.
      source.emit(["w1"]);
      channelSubscribeResolvers[0]!();
      channelSubscribeResolvers[1]!();
      await flush();
      // The stale w2 reply releases its daemon-side subscription.
      expect(channelUnsubscribes()).toEqual([
        { method: "ws.unsubscribe", params: { subscriptionId: "chan-2" } },
      ]);

      // w1 alone confirms → live with only w1's entities.
      chanSnapshot("chan-1", 0, [{ id: "a" }]);
      expect(handler).toHaveBeenLastCalledWith([{ id: "a" }]);
      // Pushes for the dead w2 id stay ignored.
      const calls = handler.mock.calls.length;
      chanSnapshot("chan-2", 0, [{ id: "stale" }]);
      expect(handler.mock.calls.length).toBe(calls);
      dispose();
    });

    it("unsubscribes every channel on dispose", async () => {
      liveStateCapability = true;
      const { dispose } = setupDynamic([], ["w1", "w2"]);
      await flush();
      dispose();
      expect(channelUnsubscribes()).toEqual([
        { method: "ws.unsubscribe", params: { subscriptionId: "chan-1" } },
        { method: "ws.unsubscribe", params: { subscriptionId: "chan-2" } },
      ]);
    });
  });
});
