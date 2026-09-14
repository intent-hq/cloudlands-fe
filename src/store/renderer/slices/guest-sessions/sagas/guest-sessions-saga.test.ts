import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(),
  closeAndNavigate: vi.fn<(workspaceId: string) => Promise<void>>(async () => {}),
}));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));
vi.mock('$features/workspace/navigate-away-if-viewing', () => ({
  closeWorkspaceTabAndNavigateAway: mocks.closeAndNavigate,
  navigateAwayIfViewing: vi.fn(async () => {}),
}));

import { BackendError } from '$lib/client/live/backend-transport-types';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { Workspace, WorkspaceRole } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { GUEST_SESSIONS_CHANGED_EVENT } from '$shared/types/guest-sessions';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import {
  authRejectedReceived,
  connectionsReducer,
  initialState as connectionsInitialState,
} from '../../connections/connections-slice';
import type { ConnectionsState } from '../../connections/connections-types';
import { openWorkspaceTab, tabStateReducer } from '../../tab-state/tab-state-slice';
import {
  removeWorkspaceEntity,
  replaceWorkspaceList,
  resetWorkspaceState,
  workspaceReducer,
  initialState as workspaceInitialState,
} from '../../workspace/workspace-slice';
import { workspaceDeleted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  guestSessionsReducer,
  initialState,
  leaveGuestSessionRequested,
  loadHostedRosterRequested,
  removeHostedMemberRequested,
} from '../guest-sessions-slice';
import { HostedRosterOperationError, type WorkspaceMember } from '../guest-sessions-types';
import { guestSessionsSaga } from './guest-sessions-saga';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';

const GUEST_SESSIONS = IPC_CHANNELS.GUEST_SESSIONS;

const GUEST: GuestSessionRecord = {
  id: 'guest-1',
  label: 'studio.local',
  host: '10.0.0.7',
  hosts: ['10.0.0.7'],
  port: 8443,
  fingerprint: 'AB:CD',
  tcAddress: null,
  hostname: 'studio.local',
  principalId: 'principal-1',
  login: 'octocat',
  tokenEncrypted: true,
  updatedAt: 1,
};

const MEMBER: WorkspaceMember = {
  principalId: 'principal-2',
  login: 'hubot',
  displayName: 'Hubot',
  avatarUrl: null,
  role: 'collaborator',
  addedAt: '2026-09-14T00:00:00Z',
};

function makeWorkspace(
  id: string,
  memberCount: number,
  myRole: WorkspaceRole = 'owner',
): Workspace {
  return {
    id: WorkspaceId(id),
    title: id,
    branch: 'main',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    myRole,
    memberCount,
  } as Workspace;
}

/** A daemon-issued JSON-RPC refusal as the live transport surfaces it. */
function daemonError(rpcCode: number, message: string): BackendError {
  return new BackendError({ code: String(rpcCode), message, rpcCode });
}

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

let callbacks: Record<string, (payload: unknown) => void>;
let invoke: ReturnType<typeof vi.fn>;
let offById: ReturnType<typeof vi.fn>;

function start(options: { windowBackendId?: string } = {}) {
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const connections: ConnectionsState = {
    ...connectionsInitialState,
    windowBackendId: options.windowBackendId ?? connectionsInitialState.windowBackendId,
  };
  let state = {
    guestSessions: initialState,
    workspace: workspaceInitialState,
    connections,
    tabState: tabStateReducer(undefined, { type: '@@INIT' }),
  };
  const dispatch = (action: any) => {
    state = {
      guestSessions: guestSessionsReducer(state.guestSessions, action),
      workspace: workspaceReducer(state.workspace, action),
      connections: connectionsReducer(state.connections, action),
      tabState: tabStateReducer(state.tabState, action),
    };
    channel.put(action);
    for (const listener of listeners) listener();
    return action;
  };
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    guestSessionsSaga,
  );
  return { dispatch, getState: () => state, task };
}

async function stop(task: Task): Promise<void> {
  task.cancel();
  await task.toPromise();
}

describe('guestSessionsSaga', () => {
  beforeEach(() => {
    callbacks = {};
    mocks.request.mockReset();
    mocks.closeAndNavigate.mockClear();
    mocks.request.mockImplementation(async (method) => {
      if (method === 'workspace.members.list') return { members: [MEMBER] };
      if (method === 'workspace.members.remove') return { removed: true };
      throw new Error(`unexpected method ${method}`);
    });
    invoke = vi.fn(async (channel: string, params?: unknown) => {
      if (channel === GUEST_SESSIONS.LIST)
        return { sessions: [GUEST], openIds: [], connectedIds: [] };
      if (channel === GUEST_SESSIONS.LEAVE)
        return { id: (params as { id: string }).id, revoked: true };
      throw new Error(`unexpected channel ${channel}`);
    });
    offById = vi.fn();
    vi.stubGlobal('electronAPI', {
      invoke,
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        callbacks[channel] = handler;
        return `listener-${channel}`;
      }),
      offById,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('hydrates the token-free list on boot and mirrors guest-sessions:changed pushes', async () => {
    const run = start();
    await settle();

    expect(invoke).toHaveBeenCalledWith(GUEST_SESSIONS.LIST);
    expect(getItems(run.getState().guestSessions.sessions)).toEqual([GUEST]);
    expect(run.getState().guestSessions.hasReceivedList).toBe(true);
    expect(run.getState().guestSessions.openIds).toEqual([]);
    expect(run.getState().guestSessions.connectedIds).toEqual([]);

    callbacks[GUEST_SESSIONS_CHANGED_EVENT]({
      sessions: [GUEST],
      openIds: [GUEST.id],
      connectedIds: [GUEST.id],
    });
    await settle();
    expect(run.getState().guestSessions.openIds).toEqual([GUEST.id]);
    expect(run.getState().guestSessions.connectedIds).toEqual([GUEST.id]);

    callbacks[GUEST_SESSIONS_CHANGED_EVENT]({ sessions: [], openIds: [], connectedIds: [] });
    await settle();
    expect(getItems(run.getState().guestSessions.sessions)).toEqual([]);

    await stop(run.task);
    expect(offById).toHaveBeenCalledWith(
      GUEST_SESSIONS_CHANGED_EVENT,
      `listener-${GUEST_SESSIONS_CHANGED_EVENT}`,
    );
  });

  it('leave sends the exact guest-sessions:leave request and tracks the in-flight id', async () => {
    const run = start();
    await settle();

    const action = leaveGuestSessionRequested(GUEST.id);
    run.dispatch(action);
    expect(run.getState().guestSessions.leavingIds).toEqual([GUEST.id]);
    await expect(action.promise).resolves.toEqual({ id: GUEST.id, revoked: true });
    expect(invoke).toHaveBeenCalledWith(GUEST_SESSIONS.LEAVE, { id: GUEST.id });
    expect(run.getState().guestSessions.leavingIds).toEqual([]);

    await stop(run.task);
  });

  it('leave rejects and clears the in-flight id when main throws', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === GUEST_SESSIONS.LIST)
        return { sessions: [GUEST], openIds: [], connectedIds: [] };
      throw new Error('unknown guest session');
    });
    const run = start();
    await settle();

    const action = leaveGuestSessionRequested(GUEST.id);
    run.dispatch(action);
    await expect(action.promise).rejects.toThrow('unknown guest session');
    expect(run.getState().guestSessions.leavingIds).toEqual([]);

    await stop(run.task);
  });

  it('loads a hosted roster through workspace.members.list with the exact params', async () => {
    const run = start();
    await settle();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2)]));

    const action = loadHostedRosterRequested('ws-1');
    run.dispatch(action);
    expect(run.getState().guestSessions.hostedRosters['ws-1']).toEqual({
      status: 'loading',
      members: [],
    });
    await expect(action.promise).resolves.toEqual({ members: [MEMBER] });
    expect(mocks.request).toHaveBeenCalledWith('workspace.members.list', { workspaceId: 'ws-1' });
    expect(run.getState().guestSessions.hostedRosters['ws-1']).toEqual({
      status: 'loaded',
      members: [MEMBER],
    });
    await settle();
    // The roster's first read registers its memberCount entry; that must not refetch.
    expect(mocks.request).toHaveBeenCalledTimes(1);

    await stop(run.task);
  });

  it('marks the roster errored with a bounded failure when the read fails in transport', async () => {
    const sentinel = 'SENTINEL-host-detail-2c1f';
    mocks.request.mockRejectedValue(new Error(`socket closed by ${sentinel}`));
    const run = start();
    await settle();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2)]));

    const action = loadHostedRosterRequested('ws-1');
    run.dispatch(action);
    const failure = await action.promise.then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(HostedRosterOperationError);
    expect((failure as HostedRosterOperationError).code).toBe('transport');
    expect(
      JSON.stringify({ ...(failure as Error), message: (failure as Error).message }),
    ).not.toContain(sentinel);
    expect(run.getState().guestSessions.hostedRosters['ws-1']?.status).toBe('error');

    await stop(run.task);
  });

  it('withholds the roster on the daemon -32003 Forbidden, dropping cached rows and controls', async () => {
    const run = start();
    await settle();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2)]));
    const first = loadHostedRosterRequested('ws-1');
    run.dispatch(first);
    await first.promise;
    expect(run.getState().guestSessions.hostedRosters['ws-1']).toEqual({
      status: 'loaded',
      members: [MEMBER],
    });

    const sentinel = 'SENTINEL-forbidden-9a2e';
    mocks.request.mockRejectedValue(daemonError(-32003, `Forbidden ${sentinel}`));
    const again = loadHostedRosterRequested('ws-1');
    run.dispatch(again);
    const failure = (await again.promise.catch((e: unknown) => e)) as HostedRosterOperationError;
    expect(failure.code).toBe('forbidden');
    expect(failure.message).not.toContain(sentinel);
    expect(run.getState().guestSessions.hostedRosters['ws-1']).toEqual({
      status: 'withheld',
      members: [],
    });

    // Terminal: a later memberCount move does not refetch a withheld roster.
    mocks.request.mockClear();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 5)]));
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();

    await stop(run.task);
  });

  it('never sends the owner RPCs for a workspace the caller only collaborates on', async () => {
    const run = start();
    await settle();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2, 'collaborator')]));

    const load = loadHostedRosterRequested('ws-1');
    run.dispatch(load);
    const loadFailure = (await load.promise.catch((e: unknown) => e)) as HostedRosterOperationError;
    expect(loadFailure.code).toBe('forbidden');
    expect(run.getState().guestSessions.hostedRosters['ws-1']?.status).toBe('withheld');

    const remove = removeHostedMemberRequested('ws-1', MEMBER.principalId);
    run.dispatch(remove);
    const removeFailure = (await remove.promise.catch(
      (e: unknown) => e,
    )) as HostedRosterOperationError;
    expect(removeFailure.code).toBe('forbidden');
    expect(run.getState().guestSessions.removingMemberKeys).toEqual([]);
    expect(mocks.request).not.toHaveBeenCalled();

    await stop(run.task);
  });

  it('withholds a loaded roster when the caller stops being the owner mid-read', async () => {
    let release!: () => void;
    mocks.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ members: [MEMBER] });
        }),
    );
    const run = start();
    await settle();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2)]));
    const action = loadHostedRosterRequested('ws-1');
    run.dispatch(action);
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(1);

    // Ownership moved while the read was in flight: the stale result must
    // not populate a roster the caller can no longer manage.
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2, 'collaborator')]));
    release();
    const failure = (await action.promise.catch((e: unknown) => e)) as HostedRosterOperationError;
    expect(failure.code).toBe('forbidden');
    expect(run.getState().guestSessions.hostedRosters['ws-1']).toEqual({
      status: 'withheld',
      members: [],
    });

    await stop(run.task);
  });

  it('coalesces roster requests during a read into a single trailing refetch', async () => {
    const releases: Array<(members: WorkspaceMember[]) => void> = [];
    mocks.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push((members) => resolve({ members }));
        }),
    );
    const run = start();
    await settle();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2)]));

    const leading = loadHostedRosterRequested('ws-1');
    run.dispatch(leading);
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(1);

    const midFlight = Array.from({ length: 11 }, () => loadHostedRosterRequested('ws-1'));
    for (const request of midFlight) run.dispatch(request);
    await settle();
    // Single-flight: nothing new while the leading read is in flight.
    expect(mocks.request).toHaveBeenCalledTimes(1);

    releases[0]!([]);
    await expect(leading.promise).resolves.toEqual({ members: [] });
    await settle();
    // Trailing coalesce: eleven mid-flight requests → exactly one follow-up.
    expect(mocks.request).toHaveBeenCalledTimes(2);
    releases[1]!([MEMBER]);
    await expect(Promise.all(midFlight.map((r) => r.promise))).resolves.toEqual(
      midFlight.map(() => ({ members: [MEMBER] })),
    );
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(run.getState().guestSessions.hostedRosters['ws-1']).toEqual({
      status: 'loaded',
      members: [MEMBER],
    });

    await stop(run.task);
  });

  it('a roster read that outlives the workspace deletion is cancelled and cannot repopulate the purged entry', async () => {
    let release!: () => void;
    mocks.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ members: [MEMBER] });
        }),
    );
    const run = start();
    await settle();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2)]));
    const action = loadHostedRosterRequested('ws-1');
    run.dispatch(action);
    const queued = loadHostedRosterRequested('ws-1');
    run.dispatch(queued);
    await settle();
    expect(run.getState().guestSessions.hostedRosters['ws-1']?.status).toBe('loading');

    run.dispatch(workspaceDeleted('ws-1', []));
    const [failure, queuedFailure] = (await Promise.all([
      action.promise.catch((e: unknown) => e),
      queued.promise.catch((e: unknown) => e),
    ])) as HostedRosterOperationError[];
    expect(failure.code).toBe('cancelled');
    expect(queuedFailure.code).toBe('cancelled');
    release();
    await settle();
    expect(run.getState().guestSessions.hostedRosters['ws-1']).toBeUndefined();
    // The later entity removal of an untracked workspace is a no-op.
    run.dispatch(removeWorkspaceEntity('ws-1'));
    await settle();
    expect(run.getState().guestSessions.hostedRosters).toEqual({});
    expect(mocks.request).toHaveBeenCalledTimes(1);

    await stop(run.task);
  });

  it('a workspace-list reset cancels every in-flight roster read and the loader keeps working after it', async () => {
    const releases: Array<() => void> = [];
    mocks.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => resolve({ members: [MEMBER] }));
        }),
    );
    const run = start();
    await settle();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2), makeWorkspace('ws-2', 2)]));
    const first = loadHostedRosterRequested('ws-1');
    const second = loadHostedRosterRequested('ws-2');
    run.dispatch(first);
    run.dispatch(second);
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(2);

    run.dispatch(resetWorkspaceState());
    const failures = (await Promise.all([
      first.promise.catch((e: unknown) => e),
      second.promise.catch((e: unknown) => e),
    ])) as HostedRosterOperationError[];
    expect(failures.map((f) => f.code)).toEqual(['cancelled', 'cancelled']);
    for (const release of releases) release();
    await settle();
    expect(run.getState().guestSessions.hostedRosters).toEqual({});

    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2)]));
    const again = loadHostedRosterRequested('ws-1');
    run.dispatch(again);
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(3);
    releases[2]!();
    await expect(again.promise).resolves.toEqual({ members: [MEMBER] });
    expect(run.getState().guestSessions.hostedRosters['ws-1']).toEqual({
      status: 'loaded',
      members: [MEMBER],
    });

    await stop(run.task);
  });

  it('a remove refused with -32003 withholds the roster and rejects with the bounded code', async () => {
    const sentinel = 'SENTINEL-remove-detail-51bd';
    mocks.request.mockImplementation(async (method) => {
      if (method === 'workspace.members.list') return { members: [MEMBER] };
      throw daemonError(-32003, `Forbidden ${sentinel}`);
    });
    const run = start();
    await settle();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2)]));
    const load = loadHostedRosterRequested('ws-1');
    run.dispatch(load);
    await load.promise;

    const remove = removeHostedMemberRequested('ws-1', MEMBER.principalId);
    run.dispatch(remove);
    const failure = (await remove.promise.catch((e: unknown) => e)) as HostedRosterOperationError;
    expect(failure.code).toBe('forbidden');
    expect(failure.message).not.toContain(sentinel);
    expect(run.getState().guestSessions.hostedRosters['ws-1']).toEqual({
      status: 'withheld',
      members: [],
    });
    expect(run.getState().guestSessions.removingMemberKeys).toEqual([]);
    // No roster refetch after a refused remove.
    expect(mocks.request.mock.calls.filter(([m]) => m === 'workspace.members.list')).toHaveLength(
      1,
    );

    await stop(run.task);
  });

  it('a remove that fails in the daemon for another reason keeps the roster and rejects bounded', async () => {
    mocks.request.mockImplementation(async (method) => {
      if (method === 'workspace.members.list') return { members: [MEMBER] };
      throw daemonError(-32602, 'Invalid params: SENTINEL-1');
    });
    const run = start();
    await settle();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2)]));
    const load = loadHostedRosterRequested('ws-1');
    run.dispatch(load);
    await load.promise;

    const remove = removeHostedMemberRequested('ws-1', MEMBER.principalId);
    run.dispatch(remove);
    const failure = (await remove.promise.catch((e: unknown) => e)) as HostedRosterOperationError;
    expect(failure.code).toBe('daemon');
    expect(failure.message).not.toContain('SENTINEL-1');
    expect(run.getState().guestSessions.hostedRosters['ws-1']).toEqual({
      status: 'loaded',
      members: [MEMBER],
    });

    await stop(run.task);
  });

  describe('host rejected the guest credential (connections/authRejectedReceived)', () => {
    const rejection = (id: string) =>
      authRejectedReceived({ id, host: GUEST.host, port: GUEST.port, statusCode: 401 });

    it('tears down every host workspace of the guest window and keeps the guest session', async () => {
      const run = start({ windowBackendId: GUEST.id });
      await settle();
      run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2), makeWorkspace('ws-2', 3)]));
      run.dispatch(openWorkspaceTab('ws-1'));
      run.dispatch(openWorkspaceTab('ws-2'));
      // A tab persisted from an earlier session whose workspace never made it
      // into the (now failing) list read.
      run.dispatch(openWorkspaceTab('ws-stale'));

      run.dispatch(rejection(GUEST.id));
      await settle();

      expect(getItems(run.getState().workspace.workspaces)).toEqual([]);
      expect(mocks.closeAndNavigate.mock.calls.map(([id]) => id).sort()).toEqual([
        'ws-1',
        'ws-2',
        'ws-stale',
      ]);
      expect(getItems(run.getState().guestSessions.sessions)).toEqual([GUEST]);
      expect(run.getState().connections.authRejected?.id).toBe(GUEST.id);

      await stop(run.task);
    });

    it('waits for the guest list when the boot replay lands before hydration', async () => {
      let releaseList!: () => void;
      invoke.mockImplementation(async (channel: string, params?: unknown) => {
        if (channel === GUEST_SESSIONS.LIST)
          return new Promise((resolve) => {
            releaseList = () => resolve({ sessions: [GUEST], openIds: [], connectedIds: [] });
          });
        return { id: (params as { id: string }).id, revoked: true };
      });
      const run = start({ windowBackendId: GUEST.id });
      run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2)]));
      run.dispatch(rejection(GUEST.id));
      await settle();
      expect(getItems(run.getState().workspace.workspaces)).toHaveLength(1);

      releaseList();
      await settle();
      expect(getItems(run.getState().workspace.workspaces)).toEqual([]);
      expect(mocks.closeAndNavigate).toHaveBeenCalledWith('ws-1');

      await stop(run.task);
    });

    it('ignores a rejection for another backend or for a window that is not a guest', async () => {
      // Owner window bound to a paired device: a pooled guest client's
      // rejection elsewhere is not this window's.
      const owner = start({ windowBackendId: 'remote-1' });
      await settle();
      owner.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2)]));
      owner.dispatch(rejection(GUEST.id));
      owner.dispatch(rejection('remote-1'));
      await settle();
      expect(getItems(owner.getState().workspace.workspaces)).toHaveLength(1);
      expect(mocks.closeAndNavigate).not.toHaveBeenCalled();
      await stop(owner.task);
    });
  });

  it('refetches a loaded roster when the workspace memberCount moves', async () => {
    const run = start();
    await settle();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 3), makeWorkspace('ws-2', 2)]));
    const first = loadHostedRosterRequested('ws-1');
    run.dispatch(first);
    await first.promise;
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(1);

    // Unrelated workspace change: no refetch.
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 3), makeWorkspace('ws-2', 5)]));
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(1);

    // The tracked workspace lost a member: one refetch, for that workspace only.
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2), makeWorkspace('ws-2', 5)]));
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request).toHaveBeenLastCalledWith('workspace.members.list', {
      workspaceId: 'ws-1',
    });

    await stop(run.task);
  });

  it('remove sends workspace.members.remove, tracks the key, then refetches the roster', async () => {
    const run = start();
    await settle();
    run.dispatch(replaceWorkspaceList([makeWorkspace('ws-1', 2)]));

    const action = removeHostedMemberRequested('ws-1', MEMBER.principalId);
    run.dispatch(action);
    expect(run.getState().guestSessions.removingMemberKeys).toEqual([`ws-1:${MEMBER.principalId}`]);
    await expect(action.promise).resolves.toEqual({ removed: true });
    expect(mocks.request).toHaveBeenCalledWith('workspace.members.remove', {
      workspaceId: 'ws-1',
      principalId: MEMBER.principalId,
    });
    await settle();
    expect(mocks.request).toHaveBeenCalledWith('workspace.members.list', { workspaceId: 'ws-1' });
    expect(run.getState().guestSessions.removingMemberKeys).toEqual([]);

    await stop(run.task);
  });

  it('does nothing outside Electron', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('electronAPI', undefined);
    const run = start();
    await run.task.toPromise();
    expect(run.getState().guestSessions.hasReceivedList).toBe(false);
  });
});
