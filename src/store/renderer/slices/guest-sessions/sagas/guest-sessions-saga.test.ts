import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));

import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { GUEST_SESSIONS_CHANGED_EVENT } from '$shared/types/guest-sessions';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import {
  replaceWorkspaceList,
  workspaceReducer,
  initialState as workspaceInitialState,
} from '../../workspace/workspace-slice';
import {
  guestSessionsReducer,
  initialState,
  leaveGuestSessionRequested,
  loadHostedRosterRequested,
  removeHostedMemberRequested,
} from '../guest-sessions-slice';
import type { WorkspaceMember } from '../guest-sessions-types';
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

function makeWorkspace(id: string, memberCount: number): Workspace {
  return {
    id: WorkspaceId(id),
    title: id,
    branch: 'main',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    myRole: 'owner',
    memberCount,
  } as Workspace;
}

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

let callbacks: Record<string, (payload: unknown) => void>;
let invoke: ReturnType<typeof vi.fn>;
let offById: ReturnType<typeof vi.fn>;

function start() {
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  let state = { guestSessions: initialState, workspace: workspaceInitialState };
  const dispatch = (action: any) => {
    state = {
      guestSessions: guestSessionsReducer(state.guestSessions, action),
      workspace: workspaceReducer(state.workspace, action),
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
    mocks.request.mockImplementation(async (method) => {
      if (method === 'workspace.members.list') return { members: [MEMBER] };
      if (method === 'workspace.members.remove') return { removed: true };
      throw new Error(`unexpected method ${method}`);
    });
    invoke = vi.fn(async (channel: string, params?: unknown) => {
      if (channel === GUEST_SESSIONS.LIST) return { sessions: [GUEST], connectedIds: [] };
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
    expect(run.getState().guestSessions.connectedIds).toEqual([]);

    callbacks[GUEST_SESSIONS_CHANGED_EVENT]({ sessions: [GUEST], connectedIds: [GUEST.id] });
    await settle();
    expect(run.getState().guestSessions.connectedIds).toEqual([GUEST.id]);

    callbacks[GUEST_SESSIONS_CHANGED_EVENT]({ sessions: [], connectedIds: [] });
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
      if (channel === GUEST_SESSIONS.LIST) return { sessions: [GUEST], connectedIds: [] };
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

  it('marks the roster errored when the daemon refuses the read', async () => {
    mocks.request.mockRejectedValue(new Error('-32003 forbidden'));
    const run = start();
    await settle();

    const action = loadHostedRosterRequested('ws-1');
    run.dispatch(action);
    await expect(action.promise).rejects.toThrow('-32003 forbidden');
    expect(run.getState().guestSessions.hostedRosters['ws-1']?.status).toBe('error');

    await stop(run.task);
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
