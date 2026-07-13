import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport: capture the notification handler so tests can drive
// `subscription.push` envelopes deterministically; no real socket is touched.
let notifyHandler: ((n: { method: string; params?: unknown }) => void) | null = null;
const subscribeCalls: unknown[] = [];
const unsubscribeCalls: string[] = [];
// Drives the simulated `client.hello` `server.capabilities.liveState` result.
let liveStateCapability = false;

vi.mock("./backend-transport", () => ({
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
  // RESUB-1: the delta subscription installs a reconnect listener; tests
  // here do not exercise reconnect so the mock is a no-op disposer.
  onBackendReconnected: vi.fn(() => () => {}),
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
  subscribeCalls.length = 0;
  unsubscribeCalls.length = 0;
  liveStateCapability = false;
  vi.clearAllMocks();
});

describe("parseSubscriptionPush", () => {
  it("returns null for non-push notifications", () => {
    expect(parseSubscriptionPush("events.event", { type: "note:updated" })).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseSubscriptionPush("subscription.push", { kind: "snapshot", seq: 0 })).toBeNull();
    expect(parseSubscriptionPush("subscription.push", { subscriptionId: "s", kind: "x" })).toBeNull();
  });

  it("parses a snapshot envelope (defaults snapshot to [])", () => {
    const parsed = parseSubscriptionPush("subscription.push", {
      subscriptionId: "s",
      kind: "snapshot",
      seq: 0,
      snapshot: [{ id: "a" }],
    });
    expect(parsed).toEqual({ subscriptionId: "s", kind: "snapshot", seq: 0, snapshot: [{ id: "a" }] });
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
    push("subscription.push", { subscriptionId: "other", kind: "snapshot", seq: 0, snapshot: [{ id: "z" }] });
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

  it("unsubscribes on dispose", async () => {
    const { dispose } = setup([]);
    await flush();
    dispose();
    expect(unsubscribeCalls).toContain("sub-1");
  });

  describe("client.hello capabilities.liveState (explicit up-front detection)", () => {
    it("enters live mode up-front when hello advertises liveState — no first push needed", async () => {
      liveStateCapability = true;
      const { fetchAll } = setup([{ id: "a" }]);
      await flush();
      // Only the initial bridge refetch; live mode is already chosen.
      expect(fetchAll).toHaveBeenCalledTimes(1);

      // A legacy firehose event must NOT trigger a refetch once live up-front.
      push("events.event", { type: "x:changed" });
      await flush();
      expect(fetchAll).toHaveBeenCalledTimes(1);
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
});
