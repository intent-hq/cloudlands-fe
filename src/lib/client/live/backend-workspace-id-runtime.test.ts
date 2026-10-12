import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { createWorkspaceIdRuntime } from './backend-workspace-id-runtime';
import { isEventInFamily, isEventOneOf, resolveEventType } from './backend-event-matchers';
import type { BackendNotification, BackendTransport } from './backend-transport-types';

type Request = (...args: Parameters<BackendTransport['request']>) => Promise<unknown>;

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const cleanups: Array<() => Promise<void>> = [];

function attemptCleanup(failures: unknown[], operation: () => void): void {
  try {
    operation();
  } catch (error) {
    failures.push(error);
  }
}

function fixture() {
  const request = vi.fn<Request>().mockRejectedValue(new Error('Unexpected workspace request'));
  const notifications = new Set<(notification: BackendNotification) => void>();
  const reconnects = new Set<() => void>();
  const registrationStops: Mock<() => void>[] = [];
  const subscriberStops: Array<() => void> = [];
  const held: ReturnType<typeof deferred>[] = [];
  const onBackendNotification = vi.fn<BackendTransport['onNotification']>((handler) => {
    notifications.add(handler);
    const stop = vi.fn(() => {
      notifications.delete(handler);
    });
    registrationStops.push(stop);
    return stop;
  });
  const onBackendReconnected = vi.fn<BackendTransport['onReconnected']>((handler) => {
    reconnects.add(handler);
    const stop = vi.fn(() => {
      reconnects.delete(handler);
    });
    registrationStops.push(stop);
    return stop;
  });
  const runtime = createWorkspaceIdRuntime({
    backendRequest: <T>(...args: Parameters<BackendTransport['request']>): Promise<T> =>
      request(...args) as Promise<T>,
    onBackendNotification,
    onBackendReconnected,
  });
  const subscribe = (listener: (ids: readonly string[]) => void) => {
    const stop = runtime.subscribeWorkspaceIds(listener);
    subscriberStops.push(stop);
    return stop;
  };
  const hold = () => {
    const response = deferred();
    held.push(response);
    request.mockReturnValueOnce(response.promise);
    return response;
  };
  const emit = (notification: BackendNotification) => {
    for (const handler of [...notifications]) handler(notification);
  };
  const reconnect = () => {
    for (const handler of [...reconnects]) handler();
  };
  const close = async () => {
    const failures: unknown[] = [];
    for (const stop of subscriberStops) attemptCleanup(failures, stop);
    for (const response of held) {
      attemptCleanup(failures, () => {
        response.resolve({ workspaces: [] });
      });
    }
    try {
      await vi.advanceTimersByTimeAsync(0);
    } catch (error) {
      failures.push(error);
    }
    attemptCleanup(failures, () => {
      expect(notifications.size).toBe(0);
    });
    attemptCleanup(failures, () => {
      expect(reconnects.size).toBe(0);
    });
    for (const stop of registrationStops) {
      attemptCleanup(failures, () => {
        expect(stop).toHaveBeenCalledTimes(1);
      });
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Workspace runtime cleanup failed');
  };
  cleanups.push(close);
  return {
    runtime,
    request,
    onBackendNotification,
    onBackendReconnected,
    notifications,
    reconnects,
    registrationStops,
    subscribe,
    hold,
    emit,
    reconnect,
    close,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(async () => {
  const results = await Promise.allSettled(cleanups.splice(0).map((close) => close()));
  const failures: unknown[] = [];
  for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
  attemptCleanup(failures, () => {
    expect(vi.getTimerCount()).toBe(0);
  });
  attemptCleanup(failures, () => {
    vi.useRealTimers();
  });
  attemptCleanup(failures, () => {
    vi.restoreAllMocks();
  });
  if (failures.length > 0) throw new AggregateError(failures, 'Workspace runtime teardown failed');
});

describe('canonical workspace ID runtime', () => {
  it('constructs without requests or listener registrations', () => {
    const f = fixture();
    expect(f.request).not.toHaveBeenCalled();
    expect(f.onBackendNotification).not.toHaveBeenCalled();
    expect(f.onBackendReconnected).not.toHaveBeenCalled();
  });

  it('shares the raw flight across readers and copies the TTL result until its exact expiry', async () => {
    const f = fixture();
    const response = f.hold();
    const bestEffort = f.runtime.listWorkspaceIds();
    const rejecting = f.runtime.listWorkspaceIdsOrThrow('resolver');
    expect(f.request.mock.calls).toEqual([['workspace.list']]);
    response.resolve({ workspaces: [{ id: 'ws-a' }, { workspaceId: 'ws-b' }] });
    await expect(Promise.all([bestEffort, rejecting])).resolves.toEqual([
      ['ws-a', 'ws-b'],
      ['ws-a', 'ws-b'],
    ]);
    const copy = await f.runtime.listWorkspaceIds();
    copy.push('caller-only');
    await vi.advanceTimersByTimeAsync(1_999);
    await expect(f.runtime.listWorkspaceIds()).resolves.toEqual(['ws-a', 'ws-b']);
    expect(f.request).toHaveBeenCalledTimes(1);
    f.request.mockResolvedValueOnce({ workspaces: [{ id: 'after-expiry' }] });
    await vi.advanceTimersByTimeAsync(1);
    await expect(f.runtime.listWorkspaceIds()).resolves.toEqual(['after-expiry']);
    expect(f.request.mock.calls).toEqual([['workspace.list'], ['workspace.list']]);
  });

  it('keeps rejection identity for discovery while best-effort readers swallow and later retry', async () => {
    const f = fixture();
    const response = f.hold();
    const error = new Error('enumeration denied');
    const bestEffort = f.runtime.listWorkspaceIds();
    const rejected = expect(f.runtime.listWorkspaceIdsOrThrow('resolver')).rejects.toBe(error);
    response.reject(error);
    await rejected;
    await expect(bestEffort).resolves.toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    f.request.mockResolvedValueOnce({ workspaces: [{ id: 'recovered' }] });
    await expect(f.runtime.listWorkspaceIdsOrThrow('resolver')).resolves.toEqual(['recovered']);
    expect(f.request.mock.calls).toEqual([['workspace.list'], ['workspace.list']]);
  });

  it('seeds once then applies membership pushes without enumeration or activity refetches', async () => {
    const f = fixture();
    const listener = vi.fn<(ids: readonly string[]) => void>();
    f.request.mockResolvedValueOnce({ workspaces: [{ id: 'ws-a' }] });
    f.subscribe(listener);
    await vi.advanceTimersByTimeAsync(0);
    f.emit({
      method: 'events.event',
      params: {
        event: {
          type: 'workspace:created',
          data: { workspace: { id: 'ws-b' } },
        },
      },
    });
    f.emit({
      method: 'events.event',
      params: {
        type: 'workspace:updated',
        data: { workspaceId: 'ws-a', changes: { archived: true } },
      },
    });
    f.emit({
      method: 'events.event',
      params: {
        type: 'workspace:updated',
        data: { workspaceId: 'ws-a', changes: { archived: false } },
      },
    });
    f.emit({
      method: 'events.event',
      params: {
        type: 'workspace:deleted',
        data: { workspaceId: 'ws-b' },
      },
    });
    f.emit({
      method: 'events.event',
      params: {
        type: 'workspace:created',
        data: { workspace: { id: 'archived', archived: true } },
      },
    });
    f.emit({
      method: 'events.event',
      params: {
        type: 'workspace:updated',
        data: { workspaceId: 'ws-a', changes: { lastActivity: 42 } },
      },
    });
    f.emit({ method: 'events.event', params: { event: { type: 'workspace:activity-changed' } } });
    f.emit({ method: 'other.method', params: { type: 'workspace:deleted' } });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(f.runtime.listWorkspaceIds()).resolves.toEqual(['ws-a']);
    expect(listener.mock.calls).toEqual([
      [['ws-a']],
      [['ws-a', 'ws-b']],
      [['ws-b']],
      [['ws-b', 'ws-a']],
      [['ws-a']],
    ]);
    expect(f.request.mock.calls).toEqual([['workspace.list']]);
  });

  it('retains two registrations of the same callback until each real disposer runs', async () => {
    const f = fixture();
    const listener = vi.fn<(ids: readonly string[]) => void>();
    f.request.mockResolvedValueOnce({ workspaces: [{ id: 'ws-a' }] });
    const first = f.subscribe(listener);
    const second = f.subscribe(listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(listener.mock.calls).toEqual([[['ws-a']], [['ws-a']]]);
    expect(f.onBackendNotification).toHaveBeenCalledTimes(1);
    expect(f.onBackendReconnected).toHaveBeenCalledTimes(1);
    first();
    first();
    expect(f.notifications.size).toBe(1);
    f.emit({
      method: 'events.event',
      params: {
        type: 'workspace:created',
        data: { workspaceId: 'ws-b' },
      },
    });
    expect(listener.mock.calls).toEqual([[['ws-a']], [['ws-a']], [['ws-a', 'ws-b']]]);
    second();
    expect(f.notifications.size).toBe(0);
    expect(f.reconnects.size).toBe(0);
    for (const stop of f.registrationStops) expect(stop).toHaveBeenCalledTimes(1);
  });

  it('coalesces reconnect bursts and protects an already seeded set from a raced old snapshot', async () => {
    const f = fixture();
    const listener = vi.fn<(ids: readonly string[]) => void>();
    f.request.mockResolvedValueOnce({ workspaces: [{ id: 'ws-a' }] });
    f.subscribe(listener);
    await vi.advanceTimersByTimeAsync(0);
    const old = f.hold();
    f.reconnect();
    f.reconnect();
    f.reconnect();
    f.emit({
      method: 'events.event',
      params: {
        type: 'workspace:created',
        data: { workspaceId: 'ws-b' },
      },
    });
    old.resolve({ workspaces: [{ id: 'old' }] });
    await vi.advanceTimersByTimeAsync(0);
    await expect(f.runtime.listWorkspaceIds()).resolves.toEqual(['ws-a', 'ws-b']);
    expect(listener.mock.calls).toEqual([[['ws-a']], [['ws-a', 'ws-b']]]);
    f.reconnect();
    f.request.mockResolvedValueOnce({ workspaces: [{ id: 'ws-a' }, { id: 'ws-b' }] });
    await vi.advanceTimersByTimeAsync(249);
    expect(f.request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.request.mock.calls).toEqual([
      ['workspace.list'],
      ['workspace.list'],
      ['workspace.list'],
    ]);
    expect(listener).toHaveBeenLastCalledWith(['ws-a', 'ws-b']);
  });

  it('defensively resyncs malformed membership and typeless events but ignores unrelated wrapped types', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({ workspaces: [{ id: 'ws-a' }] });
    f.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    f.emit({ method: 'events.event', params: { event: { type: 'note:updated' } } });
    expect(f.request).toHaveBeenCalledTimes(1);
    const held = f.hold();
    f.emit({ method: 'events.event', params: { event: { type: 'workspace:deleted', data: {} } } });
    f.emit({ method: 'events.event', params: {} });
    f.emit({
      method: 'events.event',
      params: { type: 'workspace:updated', data: { workspaceId: 'ws-a' } },
    });
    expect(f.request).toHaveBeenCalledTimes(2);
    held.resolve({ workspaces: [{ id: 'ws-a' }] });
    await vi.advanceTimersByTimeAsync(0);
    f.request.mockResolvedValueOnce({ workspaces: [] });
    await vi.advanceTimersByTimeAsync(250);
    await expect(f.runtime.listWorkspaceIds()).resolves.toEqual([]);
    expect(f.request).toHaveBeenCalledTimes(3);
  });

  it('characterizes inherited raw TTL publication after the last subscriber leaves', async () => {
    const f = fixture();
    const listener = vi.fn<(ids: readonly string[]) => void>();
    const old = f.hold();
    const stop = f.subscribe(listener);
    stop();
    old.resolve({ workspaces: [{ id: 'old-backend' }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).not.toHaveBeenCalled();
    await expect(f.runtime.listWorkspaceIds()).resolves.toEqual(['old-backend']);
    expect(f.request.mock.calls).toEqual([['workspace.list']]);
    expect(f.notifications.size).toBe(0);
    expect(f.reconnects.size).toBe(0);
  });

  it('characterizes inherited old-generation BASE adoption after immediate reacquisition', async () => {
    const f = fixture();
    const previous = vi.fn<(ids: readonly string[]) => void>();
    const current = vi.fn<(ids: readonly string[]) => void>();
    const old = f.hold();
    const stop = f.subscribe(previous);
    stop();
    f.subscribe(current);
    expect(f.request.mock.calls).toEqual([['workspace.list']]);
    old.resolve({ workspaces: [{ id: 'old-backend' }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(previous).not.toHaveBeenCalled();
    expect(current.mock.calls).toEqual([[['old-backend']]]);
    await expect(f.runtime.listWorkspaceIds()).resolves.toEqual(['old-backend']);
    f.request.mockResolvedValueOnce({ workspaces: [{ id: 'reconciled' }] });
    await vi.advanceTimersByTimeAsync(250);
    expect(current.mock.calls).toEqual([[['old-backend']], [['reconciled']]]);
    expect(f.request.mock.calls).toEqual([['workspace.list'], ['workspace.list']]);
  });

  it('characterizes inherited late failure delivery to a new unseeded subscriber and trailing retry', async () => {
    const f = fixture();
    const previous = vi.fn<(ids: readonly string[]) => void>();
    const current = vi.fn<(ids: readonly string[]) => void>();
    const old = f.hold();
    const stop = f.subscribe(previous);
    stop();
    f.subscribe(current);
    old.reject(new Error('old connection lost'));
    await vi.advanceTimersByTimeAsync(0);
    expect(previous).not.toHaveBeenCalled();
    expect(current.mock.calls).toEqual([[[]]]);
    f.request.mockResolvedValueOnce({ workspaces: [{ id: 'recovered' }] });
    await vi.advanceTimersByTimeAsync(250);
    expect(current.mock.calls).toEqual([[[]], [['recovered']]]);
    expect(f.request.mock.calls).toEqual([['workspace.list'], ['workspace.list']]);
  });

  it('cancels a scheduled follow-up when the last subscriber leaves', async () => {
    const f = fixture();
    const held = f.hold();
    const listener = vi.fn<(ids: readonly string[]) => void>();
    const stop = f.subscribe(listener);
    f.reconnect();
    held.resolve({ workspaces: [{ id: 'ws-a' }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledWith(['ws-a']);
    stop();
    await vi.advanceTimersByTimeAsync(250);
    expect(f.request.mock.calls).toEqual([['workspace.list']]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('isolates flights, cached IDs, push membership and listeners between two factory instances', async () => {
    const a = fixture();
    const b = fixture();
    const heldA = a.hold();
    const seenA = vi.fn<(ids: readonly string[]) => void>();
    const seenB = vi.fn<(ids: readonly string[]) => void>();
    a.subscribe(seenA);
    b.request.mockResolvedValueOnce({ workspaces: [{ id: 'b' }] });
    b.subscribe(seenB);
    await vi.advanceTimersByTimeAsync(0);
    expect(seenA).not.toHaveBeenCalled();
    expect(seenB.mock.calls).toEqual([[['b']]]);
    expect(a.request.mock.calls).toEqual([['workspace.list']]);
    expect(b.request.mock.calls).toEqual([['workspace.list']]);
    heldA.resolve({ workspaces: [{ id: 'a' }] });
    await vi.advanceTimersByTimeAsync(0);
    a.emit({
      method: 'events.event',
      params: {
        type: 'workspace:created',
        data: { workspaceId: 'a-only' },
      },
    });
    await expect(a.runtime.listWorkspaceIds()).resolves.toEqual(['a', 'a-only']);
    await expect(b.runtime.listWorkspaceIds()).resolves.toEqual(['b']);
    expect(seenB.mock.calls).toEqual([[['b']]]);
    await a.close();
    expect(b.notifications.size).toBe(1);
    b.emit({
      method: 'events.event',
      params: {
        type: 'workspace:deleted',
        data: { workspaceId: 'b' },
      },
    });
    expect(seenB.mock.calls).toEqual([[['b']], [[]]]);
    expect(a.request).toHaveBeenCalledTimes(1);
    expect(b.request).toHaveBeenCalledTimes(1);
  });

  it('preserves reset semantics: clear list caches without clearing the seeded set or listeners', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({ workspaces: [{ id: 'seeded' }] });
    const stop = f.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    f.runtime.resetListCachesForTests();
    await expect(f.runtime.listWorkspaceIds()).resolves.toEqual(['seeded']);
    expect(f.notifications.size).toBe(1);
    expect(f.request).toHaveBeenCalledTimes(1);
    stop();
    f.request.mockResolvedValueOnce({ workspaces: [{ id: 'after-reset' }] });
    await expect(f.runtime.listWorkspaceIds()).resolves.toEqual(['after-reset']);
    expect(f.request.mock.calls).toEqual([['workspace.list'], ['workspace.list']]);
  });
});

describe('canonical event matcher envelope contracts', () => {
  it('prefers a wrapped type over a conflicting flat type and rejects unrelated families', () => {
    const params = { type: 'workspace:deleted', event: { type: 'note:updated' } };
    expect(resolveEventType(params)).toBe('note:updated');
    expect(isEventInFamily('events.event', params, 'workspace')).toBe(false);
    expect(isEventOneOf('events.event', params, ['workspace:deleted'])).toBe(false);
    expect(isEventInFamily('events.event', params, 'note')).toBe(true);
  });

  it('retains flat fallback and defensive typeless matching only on events.event', () => {
    expect(resolveEventType({ event: { type: null }, type: 'workspace:created' })).toBe(
      'workspace:created',
    );
    expect(isEventOneOf('events.event', { type: 'workspace:created' }, ['workspace:created'])).toBe(
      true,
    );
    expect(isEventInFamily('events.event', {}, 'git')).toBe(true);
    expect(isEventOneOf('events.event', null, ['workspace:created'])).toBe(true);
    expect(isEventInFamily('subscription.push', {}, 'git')).toBe(false);
    expect(isEventOneOf('subscription.push', {}, ['workspace:created'])).toBe(false);
  });
});
