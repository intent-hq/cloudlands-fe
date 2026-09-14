import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { PresenceMember, PresenceRoster } from '$shared/types/presence';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  invoke: vi.fn(),
  reconnectHandlers: [] as Array<() => void>,
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn((handler: () => void) => {
    mocks.reconnectHandlers.push(handler);
    return () => {};
  }),
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));

import { store } from '$store/renderer/store';
import { openWorkspaceTab } from '../../tab-state/tab-state-slice';
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

describe('presenceSaga lifecycle', () => {
  let dispose: (() => void) | undefined;
  let cancel: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.reconnectHandlers.length = 0;
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

  function start() {
    dispose = store.init();
    store.dispatch(openWorkspaceTab('ws-1'));
    cancel = store.runSaga(presenceSaga);
  }

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

  it('re-reads identity and the displayed rosters on reconnect, then reports once', async () => {
    start();
    await vi.advanceTimersByTimeAsync(500);
    mocks.request.mockClear();
    mocks.invoke.mockClear();
    expect(mocks.reconnectHandlers).toHaveLength(1);

    mocks.reconnectHandlers[0]();
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
