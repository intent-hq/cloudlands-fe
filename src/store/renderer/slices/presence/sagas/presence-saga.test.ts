import {
  discussionContextChanged,
  discussionWorkspacesChanged,
  discussionRequested,
  discussionCapabilityReceived,
  discussionLoadStarted,
  discussionPageReceived,
  discussionMembershipInvalidated,
} from '../../workspace-discussion/workspace-discussion-slice';
import {
  selectDiscussionContext,
  selectDiscussionOwner,
  selectDiscussionTarget,
} from '../../workspace-discussion/workspace-discussion-selectors';
import { selectDiscussionTypingPeople } from '../presence-selectors';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { principalContextChanged, principalReceived } from '../../principal/principal-slice';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { setLabsMultiplayerEnabled } from '../../user-preferences/user-preferences-slice';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { PresenceMember, PresenceRoster } from '$shared/types/presence';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  invoke: vi.fn(),
  capabilities: vi.fn(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  observeBackendNodeCapabilities: mocks.capabilities,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));

import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '../../connections/connections-slice';
import type { WorkspaceMember } from '../../guest-sessions/guest-sessions-types';
import { openWorkspaceTab } from '../../tab-state/tab-state-slice';
import { replaceWorkspaceList } from '../../workspace/workspace-slice';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import {
  presenceRosterReceived,
  presenceTypingPulse,
  presenceDiscussionComposerFocused,
  presenceDiscussionTypingPulse,
  presenceDiscussionTypingStopped,
  presenceWindowVisibilityChanged,
} from '../presence-slice';
import {
  selectAgentPresencePeople,
  selectWorkspacePresencePeople,
  selectDiscussionTypingPeople,
} from '../presence-selectors';
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

function admit(id = 'me') {
  const current = store.state.connections;
  if (!current.hasReceivedList)
    store.dispatch(
      connectionsListReceived({
        connections: [],
        activeId: current.activeId,
        windowBackendId: current.windowBackendId,
      }),
    );
  store.dispatch(connectionStatusChanged('connected'));
  if (!store.state.workspaceEvents.subscriptionGeneration) store.dispatch(daemonEventsSubscribed());
  const context = selectPrincipalConnectionContext.select(store.state)!;
  if (store.state.principal.context !== context) store.dispatch(principalContextChanged(context));
  const p = store.state.principal;
  store.dispatch(
    principalReceived(
      { context, invalidation: p.invalidation, presentationVersion: p.presentationVersion },
      {
        principal: { id, login: null, displayName: null, avatarUrl: null, isAdministrator: true },
        capabilities: {
          hostMembership: false,
          collaborationIdentity: false,
          personalPairing: false,
          authenticatedDevices: false,
        },
      },
    ),
  );
}

describe('presenceSaga lifecycle', () => {
  let dispose: (() => void) | undefined;
  let cancel: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.capabilities
      .mockReset()
      .mockResolvedValue({ server: { capabilities: { workspaceMembershipEvents: 1 } } });
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
    if (!dispose) dispose = store.init();
    store.dispatch(setLabsMultiplayerEnabled(true));
    if (!getItems(store.state.workspace.workspaces).length)
      store.dispatch(
        replaceWorkspaceList(
          ['ws-1', 'ws-2'].map((id) => ({ id: WorkspaceId(id), memberCount: 1 }) as Workspace),
        ),
      );
    store.dispatch(openWorkspaceTab('ws-1'));
    cancel = store.runSaga(presenceSaga);
    if (subscribed) admit();
  }

  async function startDiscussion() {
    start();
    store.dispatch(
      replaceWorkspaceList(
        ['ws-1', 'ws-2'].map((id) => ({ id: WorkspaceId(id), memberCount: 2 }) as Workspace),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    mocks.invoke.mockClear();
  }
  function typeDiscussion() {
    store.dispatch(presenceDiscussionComposerFocused('ws-1', true));
    store.dispatch(presenceDiscussionTypingPulse('ws-1'));
  }
  it('reports and expires private typing per conversation, then clears it on access invalidation', async () => {
    await startDiscussion();
    const context = selectDiscussionContext.select(store.state)!;
    store.dispatch(discussionContextChanged(context, selectDiscussionOwner.select(store.state)));
    store.dispatch(discussionWorkspacesChanged(['ws-1']));
    store.dispatch(discussionCapabilityReceived(context, true));
    for (const id of ['c1', 'c2']) {
      store.dispatch(discussionRequested('ws-1', id));
      const target = selectDiscussionTarget.select(store.state, 'ws-1', id)!;
      store.dispatch(discussionLoadStarted(target, id, false));
      store.dispatch(
        discussionPageReceived(target, id, { messages: [], hasMore: false }, 'initial'),
      );
    }
    store.dispatch(presenceDiscussionComposerFocused('ws-1', true, 'c1'));
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.invoke).not.toHaveBeenCalled();
    store.dispatch(presenceDiscussionTypingPulse('ws-1', 'c1'));
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.invoke.mock.calls.at(-1)?.[1].discussionTyping).toEqual({
      workspaceId: 'ws-1',
      conversationId: 'c1',
    });
    const pulse = (source: string, conversationId: string) => ({
      source,
      conversationId,
      pulse: 1,
      since: '2099-01-01T00:00:00Z',
    });
    const ownId = store.state.presence.ownPrincipalId!;
    const member = (principalId: string, entries: ReturnType<typeof pulse>[]) => ({
      principalId,
      login: null,
      displayName: null,
      avatarUrl: null,
      focus: [],
      typing: [],
      discussionTyping: entries,
    });
    const roster = {
      workspaceId: 'ws-1',
      members: [
        member(ownId, [pulse('self', 'c1')]),
        member('a', [pulse('a1', 'c1'), pulse('a2', 'c1')]),
        member('b', [pulse('b', 'c2')]),
      ],
    };
    store.dispatch(presenceRosterReceived(roster));
    expect(
      selectDiscussionTypingPeople.select(store.state, 'ws-1', 'c1').map((p) => p.principalId),
    ).toEqual(['a']);
    expect(
      selectDiscussionTypingPeople.select(store.state, 'ws-1', 'c2').map((p) => p.principalId),
    ).toEqual(['b']);
    expect(selectDiscussionTypingPeople.select(store.state, 'ws-1')).toEqual([]);
    store.dispatch(presenceDiscussionComposerFocused('ws-1', true, 'c2'));
    store.dispatch(presenceDiscussionTypingPulse('ws-1', 'c2'));
    store.dispatch(presenceDiscussionTypingStopped('ws-1', 'c1'));
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.invoke.mock.calls.at(-1)?.[1].discussionTyping).toEqual({
      workspaceId: 'ws-1',
      conversationId: 'c2',
    });
    store.dispatch(discussionMembershipInvalidated('ws-1'));
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.invoke.mock.calls.at(-1)?.[1].discussionTyping).toBeUndefined();
    expect(selectDiscussionTypingPeople.select(store.state, 'ws-1', 'c1')).toEqual([]);
    await vi.advanceTimersByTimeAsync(3000);
    store.dispatch(presenceRosterReceived(roster));
    expect(store.state.presence.liveDiscussionTyping['ws-1'].a1.expired).toBe(true);
  });
  it('reports only fresh discussion input, throttles pulses, and clears after idle', async () => {
    await startDiscussion();
    store.dispatch(presenceDiscussionComposerFocused('ws-1', true));
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.invoke).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) {
      store.dispatch(presenceDiscussionTypingPulse('ws-1'));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    for (const [method, params] of mocks.invoke.mock.calls) {
      expect(method).toBe('presence:report');
      expect(params).toEqual({
        focus: [{ workspaceId: 'ws-1' }],
        typing: null,
        discussionTyping: { workspaceId: 'ws-1' },
      });
    }
    await vi.advanceTimersByTimeAsync(2250);
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(mocks.invoke).toHaveBeenLastCalledWith('presence:report', {
      focus: [{ workspaceId: 'ws-1' }],
      typing: null,
    });
  });
  it.each([
    'blur',
    'window-blur',
    'hidden',
    'navigation',
    'unshared',
    'disconnect',
    'identity',
    'send/empty',
  ] as const)(
    'clears discussion typing on %s and never revives it without input',
    async (change) => {
      await startDiscussion();
      typeDiscussion();
      await vi.advanceTimersByTimeAsync(250);
      expect(store.state.presence.ownDiscussionTyping).toEqual({ workspaceId: 'ws-1' });
      if (change === 'blur') store.dispatch(presenceDiscussionComposerFocused('ws-1', false));
      if (change === 'window-blur') window.dispatchEvent(new Event('blur'));
      if (change === 'hidden') store.dispatch(presenceWindowVisibilityChanged(false));
      if (change === 'navigation') store.dispatch(openWorkspaceTab('ws-2'));
      if (change === 'unshared')
        store.dispatch(
          replaceWorkspaceList([{ id: WorkspaceId('ws-1'), memberCount: 1 } as Workspace]),
        );
      if (change === 'disconnect') store.dispatch(connectionStatusChanged('disconnected'));
      if (change === 'identity') admit('new-person');
      if (change === 'send/empty') store.dispatch(presenceDiscussionTypingStopped('ws-1'));
      await vi.advanceTimersByTimeAsync(250);
      expect(store.state.presence.ownDiscussionTyping).toBeNull();
      expect(mocks.invoke.mock.calls.at(-1)?.[1].discussionTyping).toBeUndefined();
      store.dispatch(presenceWindowVisibilityChanged(true));
      store.dispatch(openWorkspaceTab('ws-1'));
      store.dispatch(presenceDiscussionComposerFocused('ws-1', true));
      await vi.advanceTimersByTimeAsync(250);
      expect(mocks.invoke.mock.calls.at(-1)?.[1].discussionTyping).toBeUndefined();
    },
  );
  it('expires new discussion pulses locally without reviving unchanged snapshots or affecting agent typing', async () => {
    await startDiscussion();
    const roster = (pulse: number): PresenceRoster => ({
      workspaceId: 'ws-1',
      members: [
        {
          ...member('other'),
          discussionTyping: [{ source: 'remote', since: '2099-01-01T00:00:00Z', pulse }],
          typing: [
            { source: 'agent-source', agentId: 'agent', since: '2000-01-01T00:00:00Z', pulse: 1 },
          ],
        },
      ],
    });
    store.dispatch(presenceRosterReceived(roster(1)));
    await vi.advanceTimersByTimeAsync(2000);
    store.dispatch(presenceRosterReceived(roster(1)));
    await vi.advanceTimersByTimeAsync(1000);
    expect(selectDiscussionTypingPeople.select(store.state, 'ws-1')).toEqual([]);
    store.dispatch(presenceRosterReceived(roster(1)));
    expect(selectDiscussionTypingPeople.select(store.state, 'ws-1')).toEqual([]);
    store.dispatch(presenceRosterReceived(roster(2)));
    expect(
      selectDiscussionTypingPeople.select(store.state, 'ws-1').map((p) => p.principalId),
    ).toEqual(['other']);
    expect(store.state.presence.liveTyping['ws-1']['agent-source'].expired).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(selectDiscussionTypingPeople.select(store.state, 'ws-1')).toEqual([]);
  });

  it('waits for the daemon-events firehose before reading identity or any roster', async () => {
    start(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls('principal.me')).toEqual([]);
    expect(calls('presence.snapshot')).toEqual([]);

    store.dispatch(daemonEventsSubscribed());
    admit();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls('principal.me')).toEqual([]);
    expect(calls('presence.snapshot')).toEqual([{ workspaceId: 'ws-1' }]);
    expect(principals('ws-1')).toEqual(['me', 'other']);
  });

  it('reuses the admitted local owner without a second identity read and leaves self out', async () => {
    if (!dispose) dispose = store.init();
    store.dispatch(
      replaceWorkspaceList([
        {
          id: WorkspaceId('ws-1'),
          title: 'ws-1',
          ownerPrincipalId: 'me',
          memberCount: 2,
        } as Workspace,
      ]),
    );
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls('principal.me')).toEqual([]);
    expect(store.state.presence.ownPrincipalId).toBe('me');
    expect(selectAgentPresencePeople.select(store.state, 'ws-1', 'agent-1')).toEqual([]);
    store.dispatch(
      presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [
          member('me', [{ workspaceId: 'ws-1', agentId: 'agent-1' }]),
          member('other', [{ workspaceId: 'ws-1', agentId: 'agent-1' }]),
        ],
      }),
    );
    expect(selectAgentPresencePeople.select(store.state, 'ws-1', 'agent-1')).toMatchObject([
      { principalId: 'other', self: false },
    ]);
  });

  describe('accepted membership of the open shared tabs', () => {
    const owner: WorkspaceMember = {
      principalId: 'me',
      login: 'me',
      displayName: null,
      avatarUrl: null,
      role: 'owner',
      addedAt: '2026-09-14T12:00:00Z',
    };
    const away: WorkspaceMember = {
      ...owner,
      principalId: 'away',
      login: 'away',
      role: 'collaborator',
    };
    const other: WorkspaceMember = { ...away, principalId: 'other', login: 'other' };

    function listWorkspaces(...rows: Array<Pick<Workspace, 'id' | 'memberCount'>>) {
      store.dispatch(
        replaceWorkspaceList(
          rows.map(
            (row) => ({ ...row, title: String(row.id), ownerPrincipalId: 'me' }) as Workspace,
          ),
        ),
      );
    }

    beforeEach(() => {
      dispose = store.init();
      mocks.request.mockImplementation(async (method: string, params: unknown) => {
        const { workspaceId } = params as { workspaceId: string };
        if (method === 'principal.me') return { id: 'me' };
        if (method === 'presence.snapshot') return snapshotOf(workspaceId);
        if (method === 'workspace.members.list') return { members: [owner, other, away] };
        throw new Error(`unexpected request ${method}`);
      });
    });

    it('reads workspace.members.list for a shared open tab on attach and never for an unshared one', async () => {
      listWorkspaces(
        { id: WorkspaceId('ws-1'), memberCount: 3 },
        { id: WorkspaceId('ws-2'), memberCount: 1 },
      );
      store.dispatch(openWorkspaceTab('ws-2'));
      start();
      await vi.advanceTimersByTimeAsync(0);
      expect(calls('workspace.members.list')).toEqual([{ workspaceId: 'ws-1' }]);
      expect(selectWorkspacePresencePeople.select(store.state, 'ws-1')).toMatchObject([
        { principalId: 'other', owner: false, online: true, self: false },
        { principalId: 'away', owner: false, online: false, self: false },
      ]);
      expect(selectWorkspacePresencePeople.select(store.state, 'ws-2')).toEqual([]);
    });

    it('reads the membership when a shared tab opens and again when its memberCount moves', async () => {
      listWorkspaces({ id: WorkspaceId('ws-1'), memberCount: 1 });
      start();
      await vi.advanceTimersByTimeAsync(0);
      expect(calls('workspace.members.list')).toEqual([]);

      listWorkspaces({ id: WorkspaceId('ws-1'), memberCount: 3 });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls('workspace.members.list')).toEqual([{ workspaceId: 'ws-1' }]);

      listWorkspaces({ id: WorkspaceId('ws-1'), memberCount: 2 });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls('workspace.members.list')).toEqual([
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-1' },
      ]);
    });

    describe('mixed owner/collaborator/manager membership (intent-hq/intent#7736)', () => {
      const manager: WorkspaceMember = {
        ...away,
        principalId: 'manager',
        login: 'manager',
        role: 'manager',
      };
      const peopleIds = () =>
        selectWorkspacePresencePeople.select(store.state, 'ws-1').map((p) => p.principalId);

      it('hydrates every accepted member, manager included, on a fresh read', async () => {
        mocks.request.mockImplementation(async (method: string, params: unknown) => {
          const { workspaceId } = params as { workspaceId: string };
          if (method === 'principal.me') return { id: 'me' };
          if (method === 'presence.snapshot') return snapshotOf(workspaceId);
          if (method === 'workspace.members.list')
            return { members: [owner, other, manager, away] };
          throw new Error(`unexpected request ${method}`);
        });
        listWorkspaces({ id: WorkspaceId('ws-1'), memberCount: 4 });
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(getItems(store.state.presence.members['ws-1']).map((m) => m.principalId)).toEqual([
          'me',
          'other',
          'manager',
          'away',
        ]);
        expect(peopleIds()).toEqual(['other', 'manager', 'away']);
      });

      it('refreshes an existing cache when the new read adds a manager row', async () => {
        const wire = deferRequests();
        listWorkspaces({ id: WorkspaceId('ws-1'), memberCount: 2 });
        start();
        await vi.advanceTimersByTimeAsync(0);
        admit();
        await vi.advanceTimersByTimeAsync(0);
        wire.settle('workspace.members.list:ws-1', 0, { members: [owner, other] });
        await vi.advanceTimersByTimeAsync(0);
        expect(getItems(store.state.presence.members['ws-1']).map((m) => m.principalId)).toEqual([
          'me',
          'other',
        ]);

        listWorkspaces({ id: WorkspaceId('ws-1'), memberCount: 3 });
        await vi.advanceTimersByTimeAsync(0);
        expect(wire.count('workspace.members.list:ws-1')).toBe(2);
        wire.settle('workspace.members.list:ws-1', 1, { members: [owner, other, manager] });
        await vi.advanceTimersByTimeAsync(0);
        expect(getItems(store.state.presence.members['ws-1']).map((m) => m.principalId)).toEqual([
          'me',
          'other',
          'manager',
        ]);
      });

      it('still rejects a response carrying an unknown role', async () => {
        mocks.request.mockImplementation(async (method: string, params: unknown) => {
          const { workspaceId } = params as { workspaceId: string };
          if (method === 'principal.me') return { id: 'me' };
          if (method === 'presence.snapshot') return snapshotOf(workspaceId);
          if (method === 'workspace.members.list')
            return { members: [owner, other, { ...manager, role: 'admin' }] };
          throw new Error(`unexpected request ${method}`);
        });
        listWorkspaces({ id: WorkspaceId('ws-1'), memberCount: 3 });
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(calls('workspace.members.list')).toEqual([{ workspaceId: 'ws-1' }]);
        expect(store.state.presence.members['ws-1']).toBeUndefined();
      });
    });

    it('keeps the newest of two overlapping membership reads and drops one overtaken by a backend switch', async () => {
      const wire = deferRequests();
      listWorkspaces({ id: WorkspaceId('ws-1'), memberCount: 2 });
      start();
      await vi.advanceTimersByTimeAsync(0);
      admit();
      await vi.advanceTimersByTimeAsync(0);
      expect(wire.count('workspace.members.list:ws-1')).toBe(1);

      listWorkspaces({ id: WorkspaceId('ws-1'), memberCount: 3 });
      await vi.advanceTimersByTimeAsync(0);
      expect(wire.count('workspace.members.list:ws-1')).toBe(2);
      wire.settle('workspace.members.list:ws-1', 1, { members: [owner, other, away] });
      await vi.advanceTimersByTimeAsync(0);
      wire.settle('workspace.members.list:ws-1', 0, { members: [owner, other] });
      await vi.advanceTimersByTimeAsync(0);
      expect(getItems(store.state.presence.members['ws-1']).map((m) => m.principalId)).toEqual([
        'me',
        'other',
        'away',
      ]);

      store.dispatch(
        connectionsListReceived({ connections: [], activeId: 'remote', windowBackendId: 'remote' }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(store.state.presence.members).toEqual({});
      admit();
      await vi.advanceTimersByTimeAsync(0);
      expect(wire.count('workspace.members.list:ws-1')).toBe(3);
      wire.settle('workspace.members.list:ws-1', 2, { members: [owner] });
      await vi.advanceTimersByTimeAsync(0);
      expect(getItems(store.state.presence.members['ws-1']).map((m) => m.principalId)).toEqual([
        'me',
      ]);
    });
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

  it.each([false, true])(
    'fences snapshots across removed/rejoined workspaces (old first: %s)',
    async (oldFirst) => {
      const wire = deferRequests();
      start();
      await vi.advanceTimersByTimeAsync(0);
      expect(wire.count('presence.snapshot:ws-1')).toBe(1);
      store.dispatch(replaceWorkspaceList([]));
      await vi.advanceTimersByTimeAsync(0);
      store.dispatch(
        replaceWorkspaceList([{ id: WorkspaceId('ws-1'), memberCount: 1 } as Workspace]),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(wire.count('presence.snapshot:ws-1')).toBe(2);
      const old = () =>
        wire.settle('presence.snapshot:ws-1', 0, {
          workspaceId: 'ws-1',
          members: [member('departed')],
        });
      const fresh = () =>
        wire.settle('presence.snapshot:ws-1', 1, {
          workspaceId: 'ws-1',
          members: [member('current')],
        });
      if (oldFirst) {
        old();
        await vi.advanceTimersByTimeAsync(0);
        expect(principals('ws-1')).toEqual([]);
        fresh();
      } else {
        fresh();
        await vi.advanceTimersByTimeAsync(0);
        old();
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(principals('ws-1')).toEqual(['current']);
    },
  );

  it('drops old admission snapshots when a new backend uses the same workspace ID', async () => {
    const wire = deferRequests();
    start();
    await vi.advanceTimersByTimeAsync(0);
    store.dispatch(daemonEventsSubscribed());
    admit();
    await vi.advanceTimersByTimeAsync(0);
    expect(wire.count('presence.snapshot:ws-1')).toBe(2);
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'remote', windowBackendId: 'remote' }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.presence.ownPrincipalId).toBeNull();
    wire.settle('presence.snapshot:ws-1', 1, { workspaceId: 'ws-1', members: [member('old')] });
    await vi.advanceTimersByTimeAsync(0);
    expect(principals('ws-1')).toEqual([]);
    admit('remote-me');
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state.presence.ownPrincipalId).toBe('remote-me');
    wire.settle('presence.snapshot:ws-1', 2, { workspaceId: 'ws-1', members: [member('new')] });
    wire.settle('presence.snapshot:ws-1', 0, { workspaceId: 'ws-1', members: [member('older')] });
    await vi.advanceTimersByTimeAsync(0);
    expect(principals('ws-1')).toEqual(['new']);
  });

  it('reports the focus settled before boot once the first attach completes', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith('presence:report', {
      focus: [{ workspaceId: 'ws-1' }],
      typing: null,
    });
    expect(store.state.presence.ownTypingSource).toBe('ts-own');
  });

  // Visibility is tracked for the whole session, not only while admitted:
  // a window hidden during an admission gap (boot, reconnect) must not be
  // published as visible when presence admits.
  it('records a window hidden before admission and reports it hidden once admitted', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      start(false);
      await vi.advanceTimersByTimeAsync(0);
      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(store.state.presence.windowVisible).toBe(false);

      store.dispatch(daemonEventsSubscribed());
      admit();
      await vi.advanceTimersByTimeAsync(500);
      expect(mocks.invoke).toHaveBeenCalledWith('presence:report', { focus: [], typing: null });
      expect(mocks.invoke).not.toHaveBeenCalledWith(
        'presence:report',
        expect.objectContaining({ focus: [{ workspaceId: 'ws-1' }] }),
      );
    } finally {
      visibility.mockRestore();
      store.dispatch(presenceWindowVisibilityChanged(true));
    }
  });

  it('stays silent at idle and while hidden input continues pulsing', async () => {
    start();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    store.dispatch(presenceWindowVisibilityChanged(false));
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.invoke).toHaveBeenLastCalledWith('presence:report', { focus: [], typing: null });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 6; i++) {
      store.dispatch(presenceTypingPulse('agent'));
      await vi.advanceTimersByTimeAsync(1500);
    }
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    store.dispatch(presenceWindowVisibilityChanged(true));
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.invoke).toHaveBeenLastCalledWith('presence:report', {
      focus: [{ workspaceId: 'ws-1' }],
      typing: { agentId: 'agent' },
    });
  });

  it.each(['rejected', 'null-source'])(
    'retries the same hidden report after a %s send',
    async (failure) => {
      start();
      await vi.advanceTimersByTimeAsync(500);
      mocks.invoke.mockClear();
      if (failure === 'rejected') mocks.invoke.mockRejectedValueOnce(new Error('connection lost'));
      else mocks.invoke.mockResolvedValueOnce({ typingSource: null });
      store.dispatch(presenceWindowVisibilityChanged(false));
      await vi.advanceTimersByTimeAsync(250);
      store.dispatch(presenceTypingPulse('agent'));
      await vi.advanceTimersByTimeAsync(1500);
      store.dispatch(presenceTypingPulse('agent'));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.invoke).toHaveBeenCalledTimes(2);
      expect(mocks.invoke).toHaveBeenLastCalledWith('presence:report', { focus: [], typing: null });
      expect(store.state.presence.ownTypingSource).toBe('ts-own');
    },
  );

  it('preserves continuous typing pulses and sends one clear after typing stops', async () => {
    start();
    await vi.advanceTimersByTimeAsync(500);
    mocks.invoke.mockClear();
    for (let i = 0; i < 4; i++) {
      store.dispatch(presenceTypingPulse('agent'));
      await vi.advanceTimersByTimeAsync(1500);
    }
    expect(mocks.invoke).toHaveBeenCalledTimes(4);
    for (const [, params] of mocks.invoke.mock.calls)
      expect(params.typing).toEqual({ agentId: 'agent' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.invoke).toHaveBeenCalledTimes(5);
    expect(mocks.invoke).toHaveBeenLastCalledWith('presence:report', {
      focus: [{ workspaceId: 'ws-1' }],
      typing: null,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.invoke).toHaveBeenCalledTimes(5);
  });

  it('refreshes displayed rosters after fresh admission on resubscribe and clears the old report', async () => {
    start();
    await vi.advanceTimersByTimeAsync(500);
    mocks.request.mockClear();
    mocks.invoke.mockClear();

    store.dispatch(daemonEventsSubscribed());
    admit();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls('principal.me')).toEqual([]);
    expect(calls('presence.snapshot')).toEqual([{ workspaceId: 'ws-1' }]);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenCalledWith('presence:report', {
      focus: [{ workspaceId: 'ws-1' }],
      typing: null,
    });
  });
});
