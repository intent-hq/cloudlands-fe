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
let taskListImpl: () => Promise<unknown> = () => Promise.resolve({ tasks: [] });

vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn((method: string, params?: unknown) => {
    if (method === 'workspace.list') {
      listWorkspaceIdsCalls.push(method);
      return listWorkspaceIdsImpl();
    }
    if (method === 'task.list') return taskListImpl();
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
  rememberNoteWorkspace,
  captureNoteWorkspaceCacheLifetime,
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

  it('a failed resync never clobbers a previously good set', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    received.length = 0;

    listWorkspaceIdsImpl = () => Promise.reject(new Error('transport down'));
    reconnect();
    await flush();

    // The good set survives and listeners are not renotified with [].
    expect(received).toEqual([]);
    expect(await listWorkspaceIds()).toEqual(['ws-1']);
    unsub();
  });

  it('a seed joining an ALREADY-in-flight RPC arms a trailing follow-up to reconcile', async () => {
    vi.useFakeTimers();
    let resolveResolver: ((v: unknown) => void) | undefined;
    listWorkspaceIdsImpl = () =>
      new Promise((resolve) => {
        resolveResolver = resolve;
      });
    // A resolver-tagged fetch is in flight before any subscriber exists.
    const resolverCall = listWorkspaceIds('resolver');
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    // The seed joins that in-flight RPC (single-flight) — its response may
    // predate the seed trigger, so a trailing follow-up must reconcile.
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    expect(listWorkspaceIdsCalls).toHaveLength(1);

    resolveResolver?.(workspaceListResult(['ws-1']));
    await flush();
    expect(await resolverCall).toEqual(['ws-1']);
    expect(received).toEqual([['ws-1']]);

    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1', 'ws-2']));
    await advance(250);

    expect(listWorkspaceIdsCalls).toHaveLength(2);
    expect(received).toEqual([['ws-1'], ['ws-1', 'ws-2']]);
    unsub();
  });

  it('a set-changing event invalidates the TTL cache so a post-teardown caller is not served a pre-event list', async () => {
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    // Populate the TTL cache, then seed the shared set.
    expect(await listWorkspaceIds()).toEqual(['ws-1']);
    const unsub = subscribeWorkspaceIds(() => {});
    await flush();
    expect(listWorkspaceIdsCalls).toHaveLength(2);

    emit('events.event', {
      event: { type: 'workspace:created', data: { workspaceId: 'ws-2', workspace: {} } },
    });
    await flush();
    unsub();

    // Set torn down AND TTL cache invalidated by the event: the next caller
    // re-fetches instead of serving the pre-event cached ['ws-1'].
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1', 'ws-2']));
    expect(await listWorkspaceIds()).toEqual(['ws-1', 'ws-2']);
    expect(listWorkspaceIdsCalls).toHaveLength(3);
  });

  it('a transient seed failure leaves the set unseeded — a later event re-seeds instead of locking in an empty set', async () => {
    listWorkspaceIdsImpl = () => Promise.reject(new Error('transport down'));
    const received: (readonly string[])[] = [];
    const unsub = subscribeWorkspaceIds((ids) => received.push(ids));
    await flush();
    expect(listWorkspaceIdsCalls).toHaveLength(1);
    // Listeners get a best-effort empty list, but no empty set is installed…
    expect(received).toEqual([[]]);

    // …so once the transport recovers, a workspace event re-seeds via a
    // defensive resync instead of being absorbed by an empty seeded set.
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1', 'ws-new']));
    emit('events.event', {
      event: { type: 'workspace:created', data: { workspaceId: 'ws-new', workspace: {} } },
    });
    await flush();

    expect(listWorkspaceIdsCalls).toHaveLength(2);
    expect(received).toEqual([[], ['ws-1', 'ws-new']]);
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

  it('concurrent resolutions of the same unknown note coalesce onto ONE in-flight scan', async () => {
    let resolveScan: ((v: unknown) => void) | undefined;
    noteListImpl = () =>
      new Promise((resolve) => {
        resolveScan = resolve;
      });

    const first = resolveNoteWorkspaceId('note-burst');
    const second = resolveNoteWorkspaceId('note-burst');
    const third = resolveNoteWorkspaceId('note-burst');
    await flush();
    expect(noteListCalls).toHaveLength(1);

    resolveScan?.({ notes: [] });
    expect(await Promise.all([first, second, third])).toEqual([null, null, null]);
    expect(noteListCalls).toHaveLength(1);
  });

  it('a miss from an INCOMPLETE scan (failed note.list) is not negative-cached — the next attempt retries', async () => {
    // A transport failure is NOT a projection rejection (-32602): no
    // projection-less retry is attempted — one call, propagated.
    noteListImpl = () => Promise.reject(new Error('transport down'));
    expect(await resolveNoteWorkspaceId('note-flaky')).toBeNull();
    expect(noteListCalls).toHaveLength(1);

    // The owning workspace recovers within the negative TTL: the retry scans
    // again (no stale negative entry) and finds the note.
    noteListImpl = () => Promise.resolve({ notes: [{ id: 'note-flaky' }] });
    expect(await resolveNoteWorkspaceId('note-flaky')).toBe('ws-1');
    expect(noteListCalls).toHaveLength(2);
  });

  it('does not retry a resolver read after its workspace authority is disposed', async () => {
    const off = subscribeWorkspaceIds(() => {});
    await flush();
    let reject!: (error: unknown) => void;
    noteListImpl = () =>
      new Promise((_done, fail) => {
        reject = fail;
      });
    const resolving = resolveNoteWorkspaceId('retired-note');
    await flush();
    expect(noteListCalls).toHaveLength(1);
    off();
    reject(Object.assign(new Error('Invalid params'), { rpcCode: -32602 }));
    await flush();
    const count = noteListCalls.length;
    if (count > 1) reject(new Error('finish unexpected retry'));
    expect(await resolving).toBeNull();
    expect(count).toBe(1);
  });

  it('a daemon that rejects the projection param (-32602) gets ONE projection-less retry', async () => {
    noteListImpl = (params) => {
      if ((params as { projection?: string }).projection === 'slim') {
        return Promise.reject(Object.assign(new Error('Invalid params'), { rpcCode: -32602 }));
      }
      return Promise.resolve({ notes: [{ id: 'note-old-daemon' }] });
    };
    expect(await resolveNoteWorkspaceId('note-old-daemon')).toBe('ws-1');
    expect(noteListCalls).toHaveLength(2);
    expect(noteListCalls[0]).toMatchObject({ projection: 'slim' });
    expect(noteListCalls[1]).not.toHaveProperty('projection');
  });

  it('a VACUOUS scan (failed workspace.list) is not negative-cached — the retry scans once the transport recovers', async () => {
    listWorkspaceIdsImpl = () => Promise.reject(new Error('transport down'));
    noteListImpl = () => Promise.resolve({ notes: [{ id: 'note-real' }] });
    expect(await resolveNoteWorkspaceId('note-real')).toBeNull();
    expect(noteListCalls).toHaveLength(0);

    // Transport recovers within what would have been the negative TTL: the
    // retry performs a real scan and finds the note.
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    expect(await resolveNoteWorkspaceId('note-real')).toBe('ws-1');
    expect(noteListCalls).toHaveLength(1);
  });

  it('an EMPTY workspace list is not negative-cached — nothing was scanned', async () => {
    vi.useFakeTimers();
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult([]));
    expect(await resolveNoteWorkspaceId('note-early')).toBeNull();
    expect(noteListCalls).toHaveLength(0);

    // Past the 2s workspace-list TTL but well within the 5s negative TTL: a
    // (wrongly) cached miss would still be served here. A workspace appears —
    // the retry scans it instead of serving a cached null.
    vi.advanceTimersByTime(2_500);
    listWorkspaceIdsImpl = () => Promise.resolve(workspaceListResult(['ws-1']));
    noteListImpl = () => Promise.resolve({ notes: [{ id: 'note-early' }] });
    expect(await resolveNoteWorkspaceId('note-early')).toBe('ws-1');
    expect(noteListCalls).toHaveLength(1);
  });

  it('rememberNoteWorkspace clears the negative entry so a newly discovered note resolves immediately', async () => {
    vi.useFakeTimers();
    expect(await resolveNoteWorkspaceId('note-arrives')).toBeNull();
    expect(noteListCalls).toHaveLength(1);

    // The note is discovered (e.g. via LiveNotesClient.list) while its
    // negative entry is still within the TTL.
    rememberNoteWorkspace('note-arrives', 'ws-1');
    expect(await resolveNoteWorkspaceId('note-arrives')).toBe('ws-1');
    expect(noteListCalls).toHaveLength(1);
  });
});

it('waits for a disposed physical read before a new workspace scope seed', async () => {
  let finish!: (value: any) => void;
  listWorkspaceIdsImpl = () =>
    new Promise((done) => {
      finish = done;
    });
  const oldOff = subscribeWorkspaceIds(() => {});
  oldOff();
  listWorkspaceIdsImpl = async () => workspaceListResult(['ws-new']);
  const snapshots: string[][] = [];
  const off = subscribeWorkspaceIds((ids) => snapshots.push([...ids]));
  try {
    await flush();
    expect(snapshots).toEqual([]);
    finish(workspaceListResult(['ws-old']));
    await flush();
    expect(snapshots.at(-1)).toEqual(['ws-new']);
  } finally {
    off();
  }
});

describe('workspace scope recovery after generic loss', () => {
  it('evicts a lost final deletion and rejects a delayed older workspace event', async () => {
    const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
    const { createEventRecoverySession } = await import('$shared/event-recovery/session');
    let receive!: (n: { method: string; params?: unknown }) => void;
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === 'events.subscribe') return { subscriptionId: 'loss', lossRecovery: 1 };
      if (method === 'workspace.list') return { workspaces: [{ id: 'remaining' }] };
      return params;
    });
    const scope = rendererEventRecovery.attach(
      createEventRecoverySession({
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
      }),
    );
    listWorkspaceIdsImpl = async () => ({ workspaces: [{ id: 'deleted' }, { id: 'remaining' }] });
    const snapshots: string[][] = [];
    const off = subscribeWorkspaceIds((ids) => snapshots.push([...ids]));
    try {
      await scope.subscribe({ eventTypes: ['workspace:*'] }, { recover: true });
      await flush();
      expect(snapshots.at(-1)).toEqual(['deleted', 'remaining']);
      rememberNoteWorkspace('deleted-note', 'deleted');
      expect(await resolveNoteWorkspaceId('deleted-note')).toBe('deleted');
      const cacheLifetime = captureNoteWorkspaceCacheLifetime();
      receive({
        method: 'events.lost',
        params: { subscriptionId: 'loss', generation: '1', scope: { workspaceId: null } },
      });
      await flush();
      expect(snapshots.at(-1)).toEqual(['remaining']);
      expect(await resolveNoteWorkspaceId('deleted-note')).toBeNull();
      rememberNoteWorkspace('deleted-note', 'deleted');
      expect(await resolveNoteWorkspaceId('deleted-note')).toBeNull();
      rememberNoteWorkspace('removed-note', 'remaining', cacheLifetime);
      expect(await resolveNoteWorkspaceId('removed-note')).toBeNull();
      emit('events.event', {
        event: { type: 'workspace:created', data: { workspace: { id: 'deleted' } } },
      });
      expect(snapshots.at(-1)).toEqual(['remaining']);
      expect(request.mock.calls.filter(([method]) => method === 'workspace.list')).toHaveLength(1);
    } finally {
      off();
      rendererEventRecovery.dispose();
    }
  });
});

it('serializes workspace scope recovery behind a held ordinary seed', async () => {
  const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
  const { createEventRecoverySession } = await import('$shared/event-recovery/session');
  let receive!: (n: any) => void, finish!: (value: any) => void;
  let active = 0,
    peak = 0;
  const snapshot = vi.fn(async () => {
    peak = Math.max(peak, ++active);
    active--;
    return workspaceListResult(['ws-new']);
  });
  const scope = rendererEventRecovery.attach(
    createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      onRetired: () => () => {},
      onNotification: (fn) => {
        receive = fn;
        return () => {};
      },
      request: async (method, params, observe) => {
        const value =
          method === 'events.subscribe'
            ? { subscriptionId: 'loss', lossRecovery: 1 }
            : method === 'workspace.list'
              ? await snapshot()
              : params;
        observe?.(value);
        return value;
      },
      dispose: () => {},
    }),
  );
  await scope.subscribe({ eventTypes: ['workspace:*'] }, { recover: true });
  listWorkspaceIdsImpl = () => {
    peak = Math.max(peak, ++active);
    return new Promise((done) => {
      finish = (value) => {
        active--;
        done(value);
      };
    });
  };
  const values: string[][] = [];
  const off = subscribeWorkspaceIds((ids) => values.push([...ids]));
  try {
    receive({
      method: 'events.lost',
      params: { subscriptionId: 'loss', generation: '1', scope: { workspaceId: null } },
    });
    await flush();
    expect(snapshot).not.toHaveBeenCalled();
    finish(workspaceListResult(['ws-old']));
    await flush();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(peak).toBe(1);
    expect(values.at(-1)).toEqual(['ws-new']);
  } finally {
    off();
    rendererEventRecovery.dispose();
  }
});

describe('all workspace cache writers', () => {
  it('rejects task-list cache writes captured before generic loss', async () => {
    __resetLiveSupportCachesForTests();
    const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
    const { createEventRecoverySession } = await import('$shared/event-recovery/session');
    const { LiveTasksClient } = await import('$lib/client/live/live-tasks-client');
    let receive!: (n: { method: string; params?: unknown }) => void;
    const scope = rendererEventRecovery.attach(
      createEventRecoverySession({
        supported: true,
        isCurrent: () => true,
        onRetired: () => () => {},
        onNotification: (fn) => {
          receive = fn;
          return () => {};
        },
        request: async (method, params, observe) => {
          const result =
            method === 'events.subscribe'
              ? { subscriptionId: 'cache-loss', lossRecovery: 1 }
              : method === 'workspace.list'
                ? { workspaces: [{ id: 'ws' }] }
                : params;
          observe?.(result);
          return result;
        },
        dispose: () => {},
      }),
    );
    listWorkspaceIdsImpl = async () => ({ workspaces: [{ id: 'ws' }] });
    noteListImpl = async () => ({ notes: [] });
    const off = subscribeWorkspaceIds(() => {});
    let finish!: (value: unknown) => void;
    taskListImpl = () =>
      new Promise((done) => {
        finish = done;
      });
    try {
      await scope.subscribe({ eventTypes: ['workspace:*'] }, { recover: true });
      await flush();
      const pending = new LiveTasksClient().list('ws');
      receive({
        method: 'events.lost',
        params: { subscriptionId: 'cache-loss', generation: '1', scope: { workspaceId: null } },
      });
      await flush();
      finish({ tasks: [{ id: 'removed-task', title: 'old task', status: 'not_started' }] });
      await pending;
      expect(await resolveNoteWorkspaceId('removed-task')).toBeNull();
    } finally {
      off();
      rendererEventRecovery.dispose();
      __resetLiveSupportCachesForTests();
    }
  });
});

describe('inactive resolver cache recovery', () => {
  it('invalidates ordinary-client caches on loss without a typed subscriber', async () => {
    __resetLiveSupportCachesForTests();
    const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
    const { createEventRecoverySession } = await import('$shared/event-recovery/session');
    const { LiveTasksClient } = await import('$lib/client/live/live-tasks-client');
    let receive!: (n: { method: string; params?: unknown }) => void;
    let recoveryReads = 0;
    const scope = rendererEventRecovery.attach(
      createEventRecoverySession({
        supported: true,
        isCurrent: () => true,
        onRetired: () => () => {},
        onNotification: (fn) => {
          receive = fn;
          return () => {};
        },
        request: async (method, params, observe) => {
          if (method === 'workspace.list') recoveryReads++;
          const result =
            method === 'events.subscribe'
              ? { subscriptionId: 'inactive-loss', lossRecovery: 1 }
              : method === 'workspace.list'
                ? { workspaces: [] }
                : params;
          observe?.(result);
          return result;
        },
        dispose: () => {},
      }),
    );
    listWorkspaceIdsImpl = async () => ({ workspaces: [{ id: 'idle-ws' }] });
    taskListImpl = async () => ({
      tasks: [{ id: 'inactive-deleted', title: 'Old', status: 'not_started' }],
    });
    noteListImpl = async () => ({ notes: [] });
    try {
      await scope.subscribe({ eventTypes: ['workspace:*', 'note:*', 'task:*'] }, { recover: true });
      await new LiveTasksClient().list('idle-ws');
      expect(await resolveNoteWorkspaceId('inactive-deleted')).toBe('idle-ws');
      let finishScope!: (value: unknown) => void;
      listWorkspaceIdsImpl = () =>
        new Promise((done) => {
          finishScope = done;
        });
      const oldScope = listWorkspaceIds();
      listWorkspaceIdsImpl = async () => ({ workspaces: [] });
      receive({
        method: 'events.lost',
        params: { subscriptionId: 'inactive-loss', generation: '1', scope: { workspaceId: null } },
      });
      await flush();
      finishScope({ workspaces: [{ id: 'idle-ws' }] });
      expect(await oldScope).toEqual([]);
      expect(await listWorkspaceIds()).toEqual([]);
      expect(await resolveNoteWorkspaceId('inactive-deleted')).toBeNull();
      expect(recoveryReads).toBe(0);
    } finally {
      rendererEventRecovery.dispose();
      __resetLiveSupportCachesForTests();
    }
  });
});

describe('task mutation dispatch after workspace resolution', () => {
  const mutations = [
    [
      'task.updateStatus',
      (client: import('./live-tasks-client').LiveTasksClient) =>
        client.updateStatus('t1', 'Task', 'done'),
    ],
    [
      'task.update',
      (client: import('./live-tasks-client').LiveTasksClient) =>
        client.update('t1', 1, { text: 'new' }),
    ],
    [
      'task.updateNoteStatus',
      (client: import('./live-tasks-client').LiveTasksClient) =>
        client.updateNoteStatus('t1', 'complete'),
    ],
    [
      'task.markAsTask',
      (client: import('./live-tasks-client').LiveTasksClient) =>
        client.markAsTask('t1', 'complete'),
    ],
    [
      'task.setRelations',
      (client: import('./live-tasks-client').LiveTasksClient) =>
        client.setRelations('t1', { dependsOn: [] }),
    ],
    [
      'task.assignAgent',
      (client: import('./live-tasks-client').LiveTasksClient) => client.assignAgent('t1', 'agent'),
    ],
    [
      'task.createPrerequisite',
      (client: import('./live-tasks-client').LiveTasksClient) =>
        client.createPrerequisite('t1', 'First'),
    ],
  ] as const;
  for (const [method, mutate] of mutations) {
    it.each(['retained', 'retired', 'replaced', 'notes', 'tasks'] as const)(
      `${method} keeps original authority across resolver await: %s`,
      async (change) => {
        __resetLiveSupportCachesForTests();
        const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
        const { createEventRecoverySession } = await import('$shared/event-recovery/session');
        const { LiveTasksClient } = await import('./live-tasks-client');
        const { backendRequest } = await import('./backend-transport');
        const session = () =>
          createEventRecoverySession({
            supported: true,
            isCurrent: () => true,
            onRetired: () => () => {},
            onNotification: () => () => {},
            request: async () => ({}),
            dispose: () => {},
          });
        const scope = rendererEventRecovery.attach(session());
        const owner = {
          key: `${change}:${JSON.stringify(['ws'])}`,
          workspaceId: 'ws',
          eventTypes: ['task:*'],
          isCurrent: () => true,
          read: async () => null,
          apply: () => undefined,
          invalidate: () => undefined,
          retire: () => undefined,
        };
        const handle =
          change === 'notes' || change === 'tasks' ? scope.registerResource(owner) : undefined;
        rememberNoteWorkspace('t1', 'ws');
        vi.mocked(backendRequest).mockClear();
        try {
          const pending = mutate(new LiveTasksClient());
          if (change === 'retired') rendererEventRecovery.dispose();
          if (change === 'replaced') rendererEventRecovery.attach(session());
          if (handle) {
            handle.dispose();
            scope.registerResource(owner);
          }
          const result = await pending;
          expect(
            vi.mocked(backendRequest).mock.calls.filter(([name]) => name === method),
          ).toHaveLength(change === 'retained' ? 1 : 0);
          expect(result.success).toBe(change === 'retained');
        } finally {
          rendererEventRecovery.dispose();
          __resetLiveSupportCachesForTests();
          vi.clearAllMocks();
        }
      },
    );
  }
});

describe('uncached task mutation dispatch ownership', () => {
  it('rejects workspace owner replacement while resolving an uncached note', async () => {
    __resetLiveSupportCachesForTests();
    const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
    const { createEventRecoverySession } = await import('$shared/event-recovery/session');
    const { LiveTasksClient } = await import('./live-tasks-client');
    const { backendRequest } = await import('./backend-transport');
    const scope = rendererEventRecovery.attach(
      createEventRecoverySession({
        supported: true,
        isCurrent: () => true,
        onRetired: () => () => {},
        onNotification: () => () => {},
        request: async () => ({}),
        dispose: () => {},
      }),
    );
    const owner = {
      key: `tasks:${JSON.stringify(['ws'])}`,
      workspaceId: 'ws',
      eventTypes: ['task:*'],
      isCurrent: () => true,
      read: async () => null,
      apply: () => undefined,
      invalidate: () => undefined,
      retire: () => undefined,
    };
    const old = scope.registerResource(owner);
    listWorkspaceIdsImpl = async () => ({ workspaces: [{ id: 'ws' }] });
    let finish!: (value: unknown) => void;
    noteListImpl = () =>
      new Promise((done) => {
        finish = done;
      });
    vi.mocked(backendRequest).mockClear();
    try {
      const pending = new LiveTasksClient().updateNoteStatus('uncached', 'complete');
      await flush();
      old.dispose();
      scope.registerResource(owner);
      finish({ notes: [{ id: 'uncached' }] });
      expect((await pending).success).toBe(false);
      expect(
        vi
          .mocked(backendRequest)
          .mock.calls.filter(([method]) => method === 'task.updateNoteStatus'),
      ).toHaveLength(0);
    } finally {
      rendererEventRecovery.dispose();
      __resetLiveSupportCachesForTests();
      vi.clearAllMocks();
      listWorkspaceIdsImpl = async () => ({ workspaces: [] });
      noteListImpl = async () => ({ notes: [] });
    }
  });
});
