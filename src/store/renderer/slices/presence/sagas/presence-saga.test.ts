import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { PresenceMember, PresenceRoster } from '$shared/types/presence';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));

import { store } from '$store/renderer/store';
import { connectionsListReceived } from '../../connections/connections-slice';
import { openWorkspaceTab } from '../../tab-state/tab-state-slice';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import { presenceRosterReceived } from '../presence-slice';
import { selectWorkspacePresencePeople } from '../presence-selectors';
import { presenceSaga } from './presence-saga';

function member(principalId: string, focus: PresenceMember['focus'] = []): PresenceMember {
  return { principalId, login: principalId, displayName: null, avatarUrl: null, focus, typing: [] };
}

const snapshotOf = (workspaceId: string): PresenceRoster => ({
  workspaceId,
  members: [member('me', [{ workspaceId }]), member('other', [{ workspaceId }])],
});

function calls(method: string): unknown[] {
  return mocks.request.mock.calls.filter(([m]) => m === method).map(([, params]) => params);
}

function principals(workspaceId: string): string[] {
  const roster = store.state.presence.rosters[workspaceId];
  return roster ? getItems(roster).map((m) => m.principalId) : [];
}

type Deferred<T> = { resolve: (value: T) => void };

/** Every wire read parks until the test settles it, in the order it was issued. */
function deferRequests() {
  const pending = new Map<string, Array<Deferred<unknown>>>();
  mocks.request.mockImplementation(
    (method: string, params: { workspaceId?: string }) =>
      new Promise((resolve) => {
        const key = params?.workspaceId ? `${method}:${params.workspaceId}` : method;
        pending.set(key, [...(pending.get(key) ?? []), { resolve }]);
      }),
  );
  return {
    count: (key: string) => pending.get(key)?.length ?? 0,
    settle: (key: string, index: number, value: unknown) => pending.get(key)![index].resolve(value),
  };
}

describe('presenceSaga lifecycle', () => {
  let dispose: (() => void) | undefined;
  let cancel: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.invoke.mockReset().mockResolvedValue({ typingSource: 'ts-own' });
    mocks.request.mockReset().mockImplementation(async (method: string, params: unknown) => {
      if (method === 'principal.me') return { id: 'me' };
      if (method === 'presence.snapshot')
        return snapshotOf((params as { workspaceId: string }).workspaceId);
      throw new Error(`unexpected request ${method}`);
    });
  });

  afterEach(() => {
    cancel?.();
    dispose?.();
    cancel = undefined;
    dispose = undefined;
    vi.useRealTimers();
  });

  /** Boots the saga with `ws-1` open; `subscribed` false leaves the firehose not yet live. */
  function start(subscribed = true) {
    dispose = store.init();
    store.dispatch(openWorkspaceTab('ws-1'));
    cancel = store.runSaga(presenceSaga);
    if (subscribed) store.dispatch(daemonEventsSubscribed());
  }

  it('waits for the daemon-events firehose before reading identity or any roster', async () => {
    start(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls('principal.me')).toEqual([]);
    expect(calls('presence.snapshot')).toEqual([]);

    store.dispatch(daemonEventsSubscribed());
    await vi.advanceTimersByTimeAsync(0);
    expect(calls('principal.me')).toEqual([{}]);
    expect(calls('presence.snapshot')).toEqual([{ workspaceId: 'ws-1' }]);
    expect(principals('ws-1')).toEqual(['me', 'other']);
  });

  it('reads the local owner principal on start without a backend change and hides self', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls('principal.me')).toEqual([{}]);
    expect(store.state.presence.ownPrincipalId).toBe('me');
    expect(selectWorkspacePresencePeople.select(store.state, 'ws-1')).toMatchObject([
      { principalId: 'other' },
    ]);
  });

  it('hydrates the open workspace tabs from presence.snapshot on start and on tab open', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls('presence.snapshot')).toEqual([{ workspaceId: 'ws-1' }]);
    expect(principals('ws-1')).toEqual(['me', 'other']);

    store.dispatch(openWorkspaceTab('ws-2'));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls('presence.snapshot')).toEqual([{ workspaceId: 'ws-1' }, { workspaceId: 'ws-2' }]);
    expect(principals('ws-2')).toEqual(['me', 'other']);
  });

  it('drops a snapshot overtaken by a presence:changed roster for the same workspace', async () => {
    let resolveSnapshot: ((roster: PresenceRoster) => void) | undefined;
    mocks.request.mockImplementation(async (method: string) => {
      if (method === 'principal.me') return { id: 'me' };
      return new Promise<PresenceRoster>((resolve) => {
        resolveSnapshot = resolve;
      });
    });
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveSnapshot).toBeDefined();

    store.dispatch(presenceRosterReceived({ workspaceId: 'ws-1', members: [member('newest')] }));
    resolveSnapshot?.({ workspaceId: 'ws-1', members: [member('stale')] });
    await vi.advanceTimersByTimeAsync(0);
    expect(principals('ws-1')).toEqual(['newest']);
  });

  it('keeps the newest of two overlapping snapshot reads for one workspace, whichever settles first', async () => {
    const wire = deferRequests();
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(wire.count('principal.me')).toBe(1);

    // A tab opens while identity is pending: read A for ws-2 is issued first…
    store.dispatch(openWorkspaceTab('ws-2'));
    await vi.advanceTimersByTimeAsync(0);
    expect(wire.count('presence.snapshot:ws-2')).toBe(1);
    // …then the attach issues read B for ws-2 (and ws-1).
    wire.settle('principal.me', 0, { id: 'me' });
    await vi.advanceTimersByTimeAsync(0);
    expect(wire.count('presence.snapshot:ws-2')).toBe(2);

    // A (older) settles first with a member who has since left; B carries the current roster.
    wire.settle('presence.snapshot:ws-2', 0, {
      workspaceId: 'ws-2',
      members: [member('departed'), member('other')],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(principals('ws-2')).toEqual([]);
    wire.settle('presence.snapshot:ws-2', 1, { workspaceId: 'ws-2', members: [member('other')] });
    await vi.advanceTimersByTimeAsync(0);
    expect(principals('ws-2')).toEqual(['other']);

    // Reverse order for ws-1: only one read exists there (the tab was open at boot).
    wire.settle('presence.snapshot:ws-1', 0, { workspaceId: 'ws-1', members: [member('other')] });
    await vi.advanceTimersByTimeAsync(0);
    expect(principals('ws-1')).toEqual(['other']);
  });

  it('lets a newer read apply after an older read of the same workspace settled first', async () => {
    const wire = deferRequests();
    start();
    await vi.advanceTimersByTimeAsync(0);
    store.dispatch(openWorkspaceTab('ws-2'));
    await vi.advanceTimersByTimeAsync(0);
    wire.settle('principal.me', 0, { id: 'me' });
    await vi.advanceTimersByTimeAsync(0);
    expect(wire.count('presence.snapshot:ws-2')).toBe(2);

    // B (newer) settles first and must not be cancelled by A's later result.
    wire.settle('presence.snapshot:ws-2', 1, { workspaceId: 'ws-2', members: [member('other')] });
    await vi.advanceTimersByTimeAsync(0);
    expect(principals('ws-2')).toEqual(['other']);
    wire.settle('presence.snapshot:ws-2', 0, {
      workspaceId: 'ws-2',
      members: [member('departed'), member('other')],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(principals('ws-2')).toEqual(['other']);
  });

  it('drops a resubscribe attach still in flight when the window moves to another backend', async () => {
    const wire = deferRequests();
    start();
    await vi.advanceTimersByTimeAsync(0);
    wire.settle('principal.me', 0, { id: 'me' });
    await vi.advanceTimersByTimeAsync(0);
    wire.settle('presence.snapshot:ws-1', 0, snapshotOf('ws-1'));
    await vi.advanceTimersByTimeAsync(500);
    expect(store.state.presence.ownPrincipalId).toBe('me');
    expect(principals('ws-1')).toEqual(['me', 'other']);

    // Resubscribe attach A parks on `principal.me`; the backend then changes.
    store.dispatch(daemonEventsSubscribed());
    await vi.advanceTimersByTimeAsync(0);
    expect(wire.count('principal.me')).toBe(2);
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'remote', windowBackendId: 'remote' }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.presence.ownPrincipalId).toBeNull();
    expect(principals('ws-1')).toEqual([]);
    expect(wire.count('principal.me')).toBe(3);

    // A's late identity is ignored; B's applies.
    wire.settle('principal.me', 1, { id: 'me' });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.presence.ownPrincipalId).toBeNull();
    wire.settle('principal.me', 2, { id: 'me-remote' });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.presence.ownPrincipalId).toBe('me-remote');
    expect(wire.count('presence.snapshot:ws-1')).toBe(2);
  });

  it('re-reads identity and the displayed rosters once the firehose is resubscribed, then reports once', async () => {
    start();
    await vi.advanceTimersByTimeAsync(500);
    mocks.request.mockClear();
    mocks.invoke.mockClear();

    store.dispatch(daemonEventsSubscribed());
    await vi.advanceTimersByTimeAsync(0);
    expect(calls('principal.me')).toEqual([{}]);
    expect(calls('presence.snapshot')).toEqual([{ workspaceId: 'ws-1' }]);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith('presence:report', {
      focus: [{ workspaceId: 'ws-1' }],
      typing: null,
    });
  });
});
