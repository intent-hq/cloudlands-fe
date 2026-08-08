import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// FAKE transport only: `subscribeWorkspaceIds` regression tests below drive
// deterministic notification/reconnect/request traffic — no real socket is
// touched. Other suites in this file (isEventInFamily/isEventOneOf) don't
// need the mock but importing it eagerly is harmless (no side effects until
// a handler fires).
let notifyHandler: ((n: { method: string; params?: unknown }) => void) | null = null;
let reconnectHandler: (() => void) | null = null;
const listWorkspaceIdsCalls: unknown[] = [];
let listWorkspaceIdsImpl: () => Promise<unknown> = () => Promise.resolve({ workspaces: [] });
const noteListCalls: unknown[] = [];
let noteListImpl: (params: unknown) => Promise<unknown> = () => Promise.resolve({ notes: [] });

vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn((method: string, params?: unknown) => {
    if (method === 'workspace.list') {
      listWorkspaceIdsCalls.push(method);
      return listWorkspaceIdsImpl();
    }
    if (method === 'note.list') {
      noteListCalls.push(params);
      return noteListImpl(params);
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

import {
  __resetLiveSupportCachesForTests,
  isEventInFamily,
  isEventOneOf,
  listWorkspaceIds,
  resolveNoteWorkspaceId,
  subscribeWorkspaceIds,
} from './live-support';

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

describe('isEventInFamily (wrapped envelope)', () => {
  it('does NOT match git/changes/file for a wrapped terminal:data event', () => {
    const params = { event: { type: 'terminal:data', data: { chunk: 'x' } } };
    expect(isEventInFamily('events.event', params, 'git')).toBe(false);
    expect(isEventInFamily('events.event', params, 'changes')).toBe(false);
    expect(isEventInFamily('events.event', params, 'file')).toBe(false);
  });

  it('matches the git family for a wrapped git:commit event', () => {
    const params = { event: { type: 'git:commit', data: {} }, subscriptionId: 's-1' };
    expect(isEventInFamily('events.event', params, 'git')).toBe(true);
    expect(isEventInFamily('events.event', params, 'changes')).toBe(false);
  });

  it('matches the changes family for a wrapped changes:git-status event', () => {
    const params = { event: { type: 'changes:git-status' } };
    expect(isEventInFamily('events.event', params, 'changes')).toBe(true);
    expect(isEventInFamily('events.event', params, 'git')).toBe(false);
  });

  it('matches the file family for a wrapped file:changed event', () => {
    const params = { event: { type: 'file:changed' } };
    expect(isEventInFamily('events.event', params, 'file')).toBe(true);
    expect(isEventInFamily('events.event', params, 'git')).toBe(false);
  });
});

describe('isEventInFamily (flat legacy payload)', () => {
  it("still matches a flat {type:'git:commit'}", () => {
    expect(isEventInFamily('events.event', { type: 'git:commit' }, 'git')).toBe(true);
    expect(isEventInFamily('events.event', { type: 'git:commit' }, 'changes')).toBe(false);
  });

  it('does NOT match unrelated flat types', () => {
    expect(isEventInFamily('events.event', { type: 'terminal:data' }, 'git')).toBe(false);
  });
});

describe('isEventInFamily (typeless / non-events methods)', () => {
  it("returns false for non-'events.event' methods", () => {
    expect(isEventInFamily('notes.subscribe', { event: { type: 'git:commit' } }, 'git')).toBe(
      false,
    );
  });

  it('defensively matches truly typeless payloads (no event, no type)', () => {
    expect(isEventInFamily('events.event', {}, 'git')).toBe(true);
    expect(isEventInFamily('events.event', { event: {} }, 'git')).toBe(true);
    expect(isEventInFamily('events.event', undefined, 'git')).toBe(true);
  });
});

describe('isEventOneOf (wrapped envelope)', () => {
  const AGENT_TYPES = ['agent:created', 'agent:status'] as const;

  it('matches only the listed types from a wrapped envelope', () => {
    expect(isEventOneOf('events.event', { event: { type: 'agent:created' } }, AGENT_TYPES)).toBe(
      true,
    );
    expect(isEventOneOf('events.event', { event: { type: 'agent:status' } }, AGENT_TYPES)).toBe(
      true,
    );
  });

  it('does NOT match a wrapped terminal:data event', () => {
    expect(isEventOneOf('events.event', { event: { type: 'terminal:data' } }, AGENT_TYPES)).toBe(
      false,
    );
  });

  it('still matches flat legacy {type:…} payloads', () => {
    expect(isEventOneOf('events.event', { type: 'agent:created' }, AGENT_TYPES)).toBe(true);
    expect(isEventOneOf('events.event', { type: 'terminal:data' }, AGENT_TYPES)).toBe(false);
  });

  it('defensively matches truly typeless payloads', () => {
    expect(isEventOneOf('events.event', {}, AGENT_TYPES)).toBe(true);
    expect(isEventOneOf('events.event', { event: {} }, AGENT_TYPES)).toBe(true);
  });

  it("returns false for non-'events.event' methods", () => {
    expect(isEventOneOf('notes.subscribe', { event: { type: 'agent:created' } }, AGENT_TYPES)).toBe(
      false,
    );
  });
});

// `subscribeWorkspaceIds` is a shared, ref-counted, push-driven id source
// (intent-hq/monorepo#1691): `workspace.list` must be called only to seed the
// first subscriber, to recover after a reconnect, or defensively on a
// malformed payload — never on every workspace event.
describe('subscribeWorkspaceIds (push-driven, shared source)', () => {
  beforeEach(() => {
    listWorkspaceIdsCalls.length = 0;
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult([]));
    __resetLiveSupportCachesForTests();
  });

  afterEach(() => {
    notifyHandler = null;
    reconnectHandler = null;
    vi.clearAllMocks();
    if (vi.isFakeTimers()) vi.useRealTimers();
  });

  it('seeds once via workspace.list on first subscribe and delivers the set', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1', 'ws-2']));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(1);
    expect(received).toEqual([['ws-1', 'ws-2']]);
    unsub();
  });

  it('a lastActivity-only burst produces ZERO workspace.list calls and ZERO notifications', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    expect(listWorkspaceIdsCalls).toHaveLength(1);
    received.length = 0;

    for (let i = 0; i < 10; i++) {
      emit('events.event', {
        event: {
          type: 'workspace:updated',
          data: { workspaceId: 'ws-1', changes: { lastActivity: `t${i}` } },
        },
      });
    }
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(1);
    expect(received).toEqual([]);
    unsub();
  });

  it('workspace:created adds the id from the payload with zero fetches', async () => {
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    emit('events.event', {
      event: { type: 'workspace:created', data: { workspaceId: 'ws-new', workspace: {} } },
    });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(received).toEqual([['ws-new']]);
    unsub();
  });

  it('workspace:created skips an (unexpected) already-archived embedded workspace', async () => {
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    emit('events.event', {
      event: {
        type: 'workspace:created',
        data: { workspaceId: 'ws-archived', workspace: { archived: true } },
      },
    });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(received).toEqual([]);
    unsub();
  });

  it('workspace:deleted removes the id from the payload with zero fetches', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1', 'ws-2']));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    emit('events.event', { event: { type: 'workspace:deleted', data: { workspaceId: 'ws-1' } } });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(received).toEqual([['ws-2']]);
    unsub();
  });

  it('workspace:updated { changes: { archived: true } } removes the id with zero fetches', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    emit('events.event', {
      event: {
        type: 'workspace:updated',
        data: { workspaceId: 'ws-1', changes: { archived: true } },
      },
    });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(received).toEqual([[]]);
    unsub();
  });

  it('workspace:updated { changes: { archived: false } } adds the id back with zero fetches', async () => {
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    emit('events.event', {
      event: {
        type: 'workspace:updated',
        data: { workspaceId: 'ws-1', changes: { archived: false } },
      },
    });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(received).toEqual([['ws-1']]);
    unsub();
  });

  it('a no-op add/remove (already present/absent) does not notify listeners', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    received.length = 0;

    // ws-1 already present: created is a no-op.
    emit('events.event', {
      event: { type: 'workspace:created', data: { workspaceId: 'ws-1', workspace: {} } },
    });
    // ws-missing already absent: deleted is a no-op.
    emit('events.event', {
      event: { type: 'workspace:deleted', data: { workspaceId: 'ws-missing' } },
    });
    await flush();

    expect(received).toEqual([]);
    unsub();
  });

  it('M concurrent subscribers share one pipeline: 1 seed fetch total, all receive the set', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    const receivedA: (readonly string[])[] = [];
    const receivedB: (readonly string[])[] = [];
    const receivedC: (readonly string[])[] = [];
    const unsubA = subscribeWorkspaceIds((ids) => receivedA.push(ids));
    const unsubB = subscribeWorkspaceIds((ids) => receivedB.push(ids));
    const unsubC = subscribeWorkspaceIds((ids) => receivedC.push(ids));
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(1);
    expect(receivedA).toEqual([['ws-1']]);
    expect(receivedB).toEqual([['ws-1']]);
    expect(receivedC).toEqual([['ws-1']]);

    unsubA();
    unsubB();
    unsubC();
  });

  it('a late subscriber (after seed) is delivered the current set immediately, no new fetch', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    const unsubFirst = subscribeWorkspaceIds(() => {});
    await flush();
    listWorkspaceIdsCalls.length = 0;

    const received: (readonly string[])[] = [];
    const unsubSecond = subscribeWorkspaceIds((ids) => received.push(ids));

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(received).toEqual([['ws-1']]);
    unsubFirst();
    unsubSecond();
  });

  it('reconnect triggers exactly one resync fetch and notifies with the fresh set', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1', 'ws-2']));
    reconnect();
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(1);
    expect(received).toEqual([['ws-1', 'ws-2']]);
    unsub();
  });

  it('concurrent resync triggers (e.g. rapid reconnects) single-flight with one trailing coalesced follow-up', async () => {
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

    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    resolveFirst?.(workspaceListResult([]));
    await flush();
    // Trailing follow-up is scheduled after the coalesce window, not fired yet.
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    await advance(250);

    expect(listWorkspaceIdsCalls).toHaveLength(2);
    unsub();
  });

  it('an id-less workspace:created payload falls back to a defensive resync fetch', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1', 'ws-2']));
    emit('events.event', { event: { type: 'workspace:created', data: {} } });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(1);
    expect(received).toEqual([['ws-1', 'ws-2']]);
    unsub();
  });

  it('a workspace:updated payload missing changes falls back to a defensive resync fetch', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    listWorkspaceIdsCalls.length = 0;
    received.length = 0;

    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    emit('events.event', { event: { type: 'workspace:updated', data: { workspaceId: 'ws-1' } } });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(1);
    expect(received).toEqual([['ws-1']]);
    unsub();
  });

  it('an event arriving during the in-flight seed fetch is not dropped: the raced seed result is applied as the BASE set and a trailing resync reconciles it', async () => {
    vi.useFakeTimers();
    let resolveSeed: ((v: unknown) => void) | undefined;
    listWorkspaceIdsImpl = () =>
      new Promise((resolve) => {
        resolveSeed = resolve;
      });
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    // Seed fetch is in flight; sharedWorkspaceIds is still null.
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    // A create event races the in-flight seed — the snapshot below was
    // effectively taken before this event, so it is stale, but it must still
    // be applied as the base set (never leave the set null; #1716 seed race).
    emit('events.event', {
      event: { type: 'workspace:created', data: { workspaceId: 'ws-new', workspace: {} } },
    });
    await flush();
    // Still null: the event can't be applied incrementally before the seed
    // has produced a base set, but it must not be silently dropped either.
    expect(received).toEqual([]);

    // The seed resolves with a snapshot that does NOT include ws-new (stale
    // relative to the event that raced it).
    resolveSeed?.(workspaceListResult(['ws-1']));
    await flush();
    // The raced seed result is applied as the BASE set (the set must never
    // stay null after a successful fetch) and delivered to listeners…
    expect(received).toEqual([['ws-1']]);
    // …with a trailing resync armed — not fired immediately — to reconcile
    // the raced event.
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    // The trailing resync's fetch reflects the post-event truth.
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1', 'ws-new']));
    await advance(250);

    expect(listWorkspaceIdsCalls).toHaveLength(2);
    expect(received).toEqual([['ws-1'], ['ws-1', 'ws-new']]);
    unsub();
  });

  it('two subscriptions passing the same listener function are tracked independently', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    const received: (readonly string[])[] = [];
    const sharedListener = (ids: readonly string[]) => received.push(ids);
    const unsubA = subscribeWorkspaceIds(sharedListener);
    const unsubB = subscribeWorkspaceIds(sharedListener);
    await flush();
    received.length = 0;

    // Unsubscribing one of the two identical-callback subscriptions must not
    // remove the other's registration.
    unsubA();
    emit('events.event', {
      event: { type: 'workspace:created', data: { workspaceId: 'ws-2', workspace: {} } },
    });
    await flush();

    expect(received).toEqual([['ws-1', 'ws-2']]);
    unsubB();
  });

  it('teardown at refcount 0 removes listeners; the next subscribe re-seeds fresh', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    const unsub = subscribeWorkspaceIds(() => {});
    await flush();
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    unsub();
    expect(notifyHandler).toBeNull();
    expect(reconnectHandler).toBeNull();

    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-2']));
    const received: (readonly string[])[] = [];
    const unsubSecond = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(2);
    expect(received).toEqual([['ws-2']]);
    unsubSecond();
  });

  it('unsubscribing one of several subscribers keeps the shared source alive for the rest', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
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
    emit('events.event', {
      event: { type: 'workspace:created', data: { workspaceId: 'ws-2', workspace: {} } },
    });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(0);
    expect(receivedA).toEqual([]);
    expect(receivedB).toEqual([['ws-1', 'ws-2']]);
    unsubB();
  });
});

// `listWorkspaceIds()` is the shared cached read path for ALL renderer
// callers (intent-hq/monorepo#1716): single-flight + ~2s TTL, with a
// zero-RPC fast path off the push-driven shared set when it is seeded.
describe('listWorkspaceIds (single-flight + TTL cache)', () => {
  beforeEach(() => {
    listWorkspaceIdsCalls.length = 0;
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult([]));
    __resetLiveSupportCachesForTests();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    if (vi.isFakeTimers()) vi.useRealTimers();
  });

  it('concurrent callers coalesce onto ONE in-flight workspace.list RPC', async () => {
    let resolveFetch: ((v: unknown) => void) | undefined;
    listWorkspaceIdsImpl = () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      });

    const [a, b, c] = [listWorkspaceIds(), listWorkspaceIds(), listWorkspaceIds()];
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    resolveFetch?.(workspaceListResult(['ws-1']));
    expect(await a).toEqual(['ws-1']);
    expect(await b).toEqual(['ws-1']);
    expect(await c).toEqual(['ws-1']);
    expect(listWorkspaceIdsCalls).toHaveLength(1);
  });

  it('a caller within the TTL is served from the cache with zero RPCs; TTL expiry re-fetches', async () => {
    vi.useFakeTimers();
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));

    expect(await listWorkspaceIds()).toEqual(['ws-1']);
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    // Within the 2s TTL: cache hit, no RPC.
    vi.advanceTimersByTime(1_000);
    expect(await listWorkspaceIds()).toEqual(['ws-1']);
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    // Past the TTL: the next caller re-fetches.
    vi.advanceTimersByTime(1_500);
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1', 'ws-2']));
    expect(await listWorkspaceIds()).toEqual(['ws-1', 'ws-2']);
    expect(listWorkspaceIdsCalls).toHaveLength(2);
  });

  it('serves directly from the seeded push-driven set with zero RPCs', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    const unsub = subscribeWorkspaceIds(() => {});
    await flush();
    listWorkspaceIdsCalls.length = 0;

    // Seeded set is authoritative: no RPC, and incremental updates are
    // reflected immediately (fresher than any TTL cache entry).
    expect(await listWorkspaceIds()).toEqual(['ws-1']);
    emit('events.event', {
      event: { type: 'workspace:created', data: { workspaceId: 'ws-2', workspace: {} } },
    });
    await flush();
    expect(await listWorkspaceIds()).toEqual(['ws-1', 'ws-2']);
    expect(listWorkspaceIdsCalls).toHaveLength(0);
    unsub();
  });

  it('a failed fetch resolves [] and is NOT cached — the next caller retries', async () => {
    listWorkspaceIdsImpl = () => Promise.reject(new Error('transport down'));
    expect(await listWorkspaceIds()).toEqual([]);
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    expect(await listWorkspaceIds()).toEqual(['ws-1']);
    expect(listWorkspaceIdsCalls).toHaveLength(2);
  });

  it('debug-logs the caller tag when a real RPC is issued', async () => {
    const debugSpy = vi.mocked(console.debug);
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult([]));
    await listWorkspaceIds('resolver');
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('(resolver)'));
  });
});

// `resolveNoteWorkspaceId` negative cache (intent-hq/monorepo#1716): a noteId
// no workspace claims must not trigger a full `note.list` scan on every
// retry — misses are remembered for ~5s.
describe('resolveNoteWorkspaceId (negative cache)', () => {
  beforeEach(() => {
    listWorkspaceIdsCalls.length = 0;
    noteListCalls.length = 0;
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    noteListImpl = () => Promise.resolve({ notes: [] });
    __resetLiveSupportCachesForTests();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    if (vi.isFakeTimers()) vi.useRealTimers();
  });

  it('a repeated miss within the TTL performs ONE scan, not many', async () => {
    vi.useFakeTimers();
    expect(await resolveNoteWorkspaceId('note-unknown')).toBeNull();
    expect(noteListCalls).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    expect(await resolveNoteWorkspaceId('note-unknown')).toBeNull();
    expect(await resolveNoteWorkspaceId('note-unknown')).toBeNull();
    expect(noteListCalls).toHaveLength(1);
  });

  it('the negative entry expires after the TTL and the next attempt rescans', async () => {
    vi.useFakeTimers();
    expect(await resolveNoteWorkspaceId('note-late')).toBeNull();
    expect(noteListCalls).toHaveLength(1);

    // Past the 5s negative TTL: the note now exists — the rescan finds it.
    vi.advanceTimersByTime(5_000);
    noteListImpl = () => Promise.resolve({ notes: [{ id: 'note-late' }] });
    expect(await resolveNoteWorkspaceId('note-late')).toBe('ws-1');
    expect(noteListCalls).toHaveLength(2);
  });

  it('a found note is served from the positive index, bypassing the negative path', async () => {
    noteListImpl = () => Promise.resolve({ notes: [{ id: 'note-found' }] });
    expect(await resolveNoteWorkspaceId('note-found')).toBe('ws-1');
    expect(noteListCalls).toHaveLength(1);

    // Second resolution: positive cache hit, no further scans.
    expect(await resolveNoteWorkspaceId('note-found')).toBe('ws-1');
    expect(noteListCalls).toHaveLength(1);
  });
});
