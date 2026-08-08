import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: `subscribeWorkspaceIds` regression tests below drive
// deterministic notification/reconnect/request traffic — no real socket is
// touched. Other suites in this file (isEventInFamily/isEventOneOf) don't
// need the mock but importing it eagerly is harmless (no side effects until
// a handler fires).
let notifyHandler: ((n: { method: string; params?: unknown }) => void) | null = null;
let reconnectHandler: (() => void) | null = null;
const listWorkspaceIdsCalls: unknown[] = [];
let listWorkspaceIdsImpl: () => Promise<unknown> = () => Promise.resolve({ workspaces: [] });

vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn((method: string) => {
    if (method === "workspace.list") {
      listWorkspaceIdsCalls.push(method);
      return listWorkspaceIdsImpl();
    }
    return Promise.resolve({});
  }),
  onBackendNotification: vi.fn((handler: (n: { method: string; params?: unknown }) => void) => {
    notifyHandler = handler;
    return () => {
      notifyHandler = null;
    };
  }),
  onBackendReconnected: vi.fn((handler: () => void) => {
    reconnectHandler = handler;
    return () => {
      reconnectHandler = null;
    };
  }),
}));

import { isEventInFamily, isEventOneOf, subscribeWorkspaceIds } from "./live-support";

// Real-timer flush: resolves after pending microtasks AND one macrotask tick,
// safe to call whether or not fake timers are active (uses the real
// setTimeout captured before any vi.useFakeTimers() swap).
const realSetTimeout = setTimeout;
const flush = () => new Promise((resolve) => realSetTimeout(resolve, 0));
const advance = async (ms: number) => {
  vi.advanceTimersByTime(ms);
  await flush();
};

function emit(method: string, params: unknown) {
  notifyHandler?.({ method, params });
}

function reconnect() {
  reconnectHandler?.();
}

function workspaceListResult(ids: readonly string[]) {
  return { workspaces: ids.map((id) => ({ id })) };
}

// The daemon wraps each domain event as `{ event: { type, … } }` (PROTOCOL §7
// notification envelope; mirrors extractEvent in daemon-events-bridge.ts).
// These tests pin the family/type matchers to that envelope so an unrelated
// notification (e.g. terminal:data from PTY traffic) does NOT match the git /
// changes / file families. Flat legacy payloads keep working, and a truly
// typeless payload still defensively matches.

describe("isEventInFamily (wrapped envelope)", () => {
  it("does NOT match git/changes/file for a wrapped terminal:data event", () => {
    const params = { event: { type: "terminal:data", data: { chunk: "x" } } };
    expect(isEventInFamily("events.event", params, "git")).toBe(false);
    expect(isEventInFamily("events.event", params, "changes")).toBe(false);
    expect(isEventInFamily("events.event", params, "file")).toBe(false);
  });

  it("matches the git family for a wrapped git:commit event", () => {
    const params = { event: { type: "git:commit", data: {} }, subscriptionId: "s-1" };
    expect(isEventInFamily("events.event", params, "git")).toBe(true);
    expect(isEventInFamily("events.event", params, "changes")).toBe(false);
  });

  it("matches the changes family for a wrapped changes:git-status event", () => {
    const params = { event: { type: "changes:git-status" } };
    expect(isEventInFamily("events.event", params, "changes")).toBe(true);
    expect(isEventInFamily("events.event", params, "git")).toBe(false);
  });

  it("matches the file family for a wrapped file:changed event", () => {
    const params = { event: { type: "file:changed" } };
    expect(isEventInFamily("events.event", params, "file")).toBe(true);
    expect(isEventInFamily("events.event", params, "git")).toBe(false);
  });
});

describe("isEventInFamily (flat legacy payload)", () => {
  it("still matches a flat {type:'git:commit'}", () => {
    expect(isEventInFamily("events.event", { type: "git:commit" }, "git")).toBe(true);
    expect(isEventInFamily("events.event", { type: "git:commit" }, "changes")).toBe(false);
  });

  it("does NOT match unrelated flat types", () => {
    expect(isEventInFamily("events.event", { type: "terminal:data" }, "git")).toBe(false);
  });
});

describe("isEventInFamily (typeless / non-events methods)", () => {
  it("returns false for non-'events.event' methods", () => {
    expect(isEventInFamily("notes.subscribe", { event: { type: "git:commit" } }, "git")).toBe(false);
  });

  it("defensively matches truly typeless payloads (no event, no type)", () => {
    expect(isEventInFamily("events.event", {}, "git")).toBe(true);
    expect(isEventInFamily("events.event", { event: {} }, "git")).toBe(true);
    expect(isEventInFamily("events.event", undefined, "git")).toBe(true);
  });
});

describe("isEventOneOf (wrapped envelope)", () => {
  const AGENT_TYPES = ["agent:created", "agent:status"] as const;

  it("matches only the listed types from a wrapped envelope", () => {
    expect(
      isEventOneOf("events.event", { event: { type: "agent:created" } }, AGENT_TYPES),
    ).toBe(true);
    expect(
      isEventOneOf("events.event", { event: { type: "agent:status" } }, AGENT_TYPES),
    ).toBe(true);
  });

  it("does NOT match a wrapped terminal:data event", () => {
    expect(
      isEventOneOf("events.event", { event: { type: "terminal:data" } }, AGENT_TYPES),
    ).toBe(false);
  });

  it("still matches flat legacy {type:…} payloads", () => {
    expect(isEventOneOf("events.event", { type: "agent:created" }, AGENT_TYPES)).toBe(true);
    expect(isEventOneOf("events.event", { type: "terminal:data" }, AGENT_TYPES)).toBe(false);
  });

  it("defensively matches truly typeless payloads", () => {
    expect(isEventOneOf("events.event", {}, AGENT_TYPES)).toBe(true);
    expect(isEventOneOf("events.event", { event: {} }, AGENT_TYPES)).toBe(true);
  });

  it("returns false for non-'events.event' methods", () => {
    expect(
      isEventOneOf("notes.subscribe", { event: { type: "agent:created" } }, AGENT_TYPES),
    ).toBe(false);
  });
});

// `subscribeWorkspaceIds` is a shared, ref-counted, push-driven id source
// (intent-hq/monorepo#1691): `workspace.list` must be called only to seed the
// first subscriber, to recover after a reconnect, or defensively on a
// malformed payload — never on every workspace event.
describe("subscribeWorkspaceIds (push-driven, shared source)", () => {
  beforeEach(() => {
    listWorkspaceIdsCalls.length = 0;
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult([]));
  });

  afterEach(() => {
    notifyHandler = null;
    reconnectHandler = null;
    vi.clearAllMocks();
    if (vi.isFakeTimers()) vi.useRealTimers();
  });

  it("seeds once via workspace.list on first subscribe and delivers the set", async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1", "ws-2"]));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(1);
    expect(received).toEqual([["ws-1", "ws-2"]]);
    unsub();
  });

  it("a lastActivity-only burst produces ZERO workspace.list calls and ZERO notifications", async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1"]));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    expect(listWorkspaceIdsCalls).toHaveLength(1);
    received.length = 0;

    for (let i = 0; i < 10; i++) {
      emit("events.event", {
        event: {
          type: "workspace:updated",
          data: { workspaceId: "ws-1", changes: { lastActivity: `t${i}` } },
        },
      });
    }
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(1);
    expect(received).toEqual([]);
    unsub();
  });

  it("workspace:created adds the id from the payload with zero fetches", async () => {
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    emit("events.event", {
      event: { type: "workspace:created", data: { workspaceId: "ws-new", workspace: {} } },
    });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(received).toEqual([["ws-new"]]);
    unsub();
  });

  it("workspace:created skips an (unexpected) already-archived embedded workspace", async () => {
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    emit("events.event", {
      event: {
        type: "workspace:created",
        data: { workspaceId: "ws-archived", workspace: { archived: true } },
      },
    });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(received).toEqual([]);
    unsub();
  });

  it("workspace:deleted removes the id from the payload with zero fetches", async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1", "ws-2"]));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    emit("events.event", { event: { type: "workspace:deleted", data: { workspaceId: "ws-1" } } });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(received).toEqual([["ws-2"]]);
    unsub();
  });

  it("workspace:updated { changes: { archived: true } } removes the id with zero fetches", async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1"]));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    emit("events.event", {
      event: { type: "workspace:updated", data: { workspaceId: "ws-1", changes: { archived: true } } },
    });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(received).toEqual([[]]);
    unsub();
  });

  it("workspace:updated { changes: { archived: false } } adds the id back with zero fetches", async () => {
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    emit("events.event", {
      event: {
        type: "workspace:updated",
        data: { workspaceId: "ws-1", changes: { archived: false } },
      },
    });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(received).toEqual([["ws-1"]]);
    unsub();
  });

  it("a no-op add/remove (already present/absent) does not notify listeners", async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1"]));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    received.length = 0;

    // ws-1 already present: created is a no-op.
    emit("events.event", {
      event: { type: "workspace:created", data: { workspaceId: "ws-1", workspace: {} } },
    });
    // ws-missing already absent: deleted is a no-op.
    emit("events.event", {
      event: { type: "workspace:deleted", data: { workspaceId: "ws-missing" } },
    });
    await flush();

    expect(received).toEqual([]);
    unsub();
  });

  it("M concurrent subscribers share one pipeline: 1 seed fetch total, all receive the set", async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1"]));
    const receivedA: (readonly string[])[] = [];
    const receivedB: (readonly string[])[] = [];
    const receivedC: (readonly string[])[] = [];
    const unsubA = subscribeWorkspaceIds((ids) => receivedA.push(ids));
    const unsubB = subscribeWorkspaceIds((ids) => receivedB.push(ids));
    const unsubC = subscribeWorkspaceIds((ids) => receivedC.push(ids));
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(1);
    expect(receivedA).toEqual([["ws-1"]]);
    expect(receivedB).toEqual([["ws-1"]]);
    expect(receivedC).toEqual([["ws-1"]]);

    unsubA();
    unsubB();
    unsubC();
  });

  it("a late subscriber (after seed) is delivered the current set immediately, no new fetch", async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1"]));
    const unsubFirst = subscribeWorkspaceIds(() => {});
    await flush();
    listWorkspaceIdsCalls.length = 0;

    const received: (readonly string[])[] = [];
    const unsubSecond = subscribeWorkspaceIds((ids) => received.push(ids));

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(received).toEqual([["ws-1"]]);
    unsubFirst();
    unsubSecond();
  });

  it("reconnect triggers exactly one resync fetch and notifies with the fresh set", async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1"]));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1", "ws-2"]));
    reconnect();
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(1);
    expect(received).toEqual([["ws-1", "ws-2"]]);
    unsub();
  });

  it("concurrent resync triggers (e.g. rapid reconnects) single-flight with one trailing coalesced follow-up", async () => {
    vi.useFakeTimers();
    let resolveFirst: ((v: unknown) => void) | undefined;
    listWorkspaceIdsImpl = () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      });
    const unsub = subscribeWorkspaceIds(() => {});
    // Seed fetch is now in flight.
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    // Two more triggers race in while the seed fetch is in flight — they
    // must collapse into a single trailing follow-up, not two more fetches.
    reconnect();
    reconnect();
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1"]));
    resolveFirst?.(workspaceListResult([]));
    await flush();
    // Trailing follow-up is scheduled after the coalesce window, not fired yet.
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    await advance(250);

    expect(listWorkspaceIdsCalls).toHaveLength(2);
    unsub();
  });

  it("an id-less workspace:created payload falls back to a defensive resync fetch", async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1"]));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1", "ws-2"]));
    emit("events.event", { event: { type: "workspace:created", data: {} } });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(1);
    expect(received).toEqual([["ws-1", "ws-2"]]);
    unsub();
  });

  it("a workspace:updated payload missing changes falls back to a defensive resync fetch", async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1"]));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1"]));
    emit("events.event", { event: { type: "workspace:updated", data: { workspaceId: "ws-1" } } });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(1);
    expect(received).toEqual([["ws-1"]]);
    unsub();
  });

  it("teardown at refcount 0 removes listeners; the next subscribe re-seeds fresh", async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1"]));
    const unsub = subscribeWorkspaceIds(() => {});
    await flush();
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    unsub();
    expect(notifyHandler).toBeNull();
    expect(reconnectHandler).toBeNull();

    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-2"]));
    const received: (readonly string[])[] = [];
    const unsubSecond = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(2);
    expect(received).toEqual([["ws-2"]]);
    unsubSecond();
  });

  it("unsubscribing one of several subscribers keeps the shared source alive for the rest", async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(["ws-1"]));
    const receivedA: (readonly string[])[] = [];
    const receivedB: (readonly string[])[] = [];
    const unsubA = subscribeWorkspaceIds((ids) => receivedA.push(ids));
    const unsubB = subscribeWorkspaceIds((ids) => receivedB.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    receivedA.length = 0;
    receivedB.length = 0;

    unsubA();
    // The source must still be live for B — a create event still updates it.
    emit("events.event", {
      event: { type: "workspace:created", data: { workspaceId: "ws-2", workspace: {} } },
    });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(receivedA).toEqual([]);
    expect(receivedB).toEqual([["ws-1", "ws-2"]]);
    unsubB();
  });
});
