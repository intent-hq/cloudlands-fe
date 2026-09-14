/**
 * Guest Sessions Slice (multiplayer w4)
 *
 * Actions + reducer for the guest side of workspace sharing: the hosts this
 * app joined through an invite link (authoritative from main, token-free), the
 * in-flight *Leave host* operations, and the owner-side rosters of the current
 * window's shared workspaces (a read-through view of `workspace.members.list`).
 */

import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { removeWorkspaceEntity, resetWorkspaceState } from '../workspace/workspace-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  hostedMemberKey,
  type GuestSessionRecord,
  type GuestSessionsListResult,
  type GuestSessionsState,
  type LeaveGuestSessionResult,
  type WorkspaceMember,
  type WorkspaceMemberRemoveResult,
  type WorkspaceMembersListResult,
} from './guest-sessions-types';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: GuestSessionsState = {
  sessions: createCollection<GuestSessionRecord, 'id'>('id'),
  openIds: [],
  connectedIds: [],
  hasReceivedList: false,
  leavingIds: [],
  hostedRosters: {},
  removingMemberKeys: [],
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Guest sessions list received — from the initial `guest-sessions:list`
 * invoke or a `guest-sessions:changed` push (same payload shape).
 */
export const guestSessionsListReceived = createAction<[result: GuestSessionsListResult]>(
  'guestSessions/listReceived',
);

/** Saga-owned list hydration (boot). */
export const loadGuestSessionsRequested = createAsyncAction<[], GuestSessionsListResult>(
  'guestSessions/load',
  'guestSessions/loadRequested',
);

/**
 * *Leave host*: best-effort `principal.revokeSelf` on the host, then the local
 * delete + window teardown (main-owned; the list refresh arrives via the
 * `guest-sessions:changed` push).
 */
export const leaveGuestSessionRequested = createAsyncAction<[id: string], LeaveGuestSessionResult>(
  'guestSessions/leave',
  'guestSessions/leaveRequested',
);

export const leaveOperationStarted = createAction<[id: string]>('guestSessions/leaveStarted');
export const leaveOperationSettled = createAction<[id: string]>('guestSessions/leaveSettled');

/** Saga-owned roster read (`workspace.members.list`) for one hosted workspace. */
export const loadHostedRosterRequested = createAsyncAction<
  [workspaceId: string],
  WorkspaceMembersListResult
>('guestSessions/loadHostedRoster', 'guestSessions/loadHostedRosterRequested');

export const hostedRosterLoading = createAction<[workspaceId: string]>(
  'guestSessions/hostedRosterLoading',
);
export const hostedRosterReceived = createAction<[workspaceId: string, members: WorkspaceMember[]]>(
  'guestSessions/hostedRosterReceived',
);
export const hostedRosterFailed = createAction<[workspaceId: string]>(
  'guestSessions/hostedRosterFailed',
);
/**
 * The caller no longer manages the workspace (daemon `-32003 Forbidden` on a
 * roster read / *Remove*, or the local owner gate): terminal — cached rows and
 * in-flight *Remove* markers are dropped, controls disappear, no refetch.
 */
export const hostedRosterWithheld = createAction<[workspaceId: string]>(
  'guestSessions/hostedRosterWithheld',
);

/** Owner-side *Remove* (`workspace.members.remove`) of one collaborator. */
export const removeHostedMemberRequested = createAsyncAction<
  [workspaceId: string, principalId: string],
  WorkspaceMemberRemoveResult
>('guestSessions/removeHostedMember', 'guestSessions/removeHostedMemberRequested');

export const removeMemberOperationStarted = createAction<
  [workspaceId: string, principalId: string]
>('guestSessions/removeMemberStarted');
export const removeMemberOperationSettled = createAction<
  [workspaceId: string, principalId: string]
>('guestSessions/removeMemberSettled');

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const guestSessionsReducer = createReducer<GuestSessionsState>(initialState);

guestSessionsReducer.with(guestSessionsListReceived, (state, { payload: [result] }) => ({
  ...state,
  sessions: createCollection<GuestSessionRecord, 'id'>('id', result.sessions),
  openIds: result.openIds,
  connectedIds: result.connectedIds,
  hasReceivedList: true,
}));

guestSessionsReducer.with(leaveOperationStarted, (state, { payload: [id] }) =>
  state.leavingIds.includes(id) ? state : { ...state, leavingIds: [...state.leavingIds, id] },
);
guestSessionsReducer.with(leaveOperationSettled, (state, { payload: [id] }) => ({
  ...state,
  leavingIds: state.leavingIds.filter((leaving) => leaving !== id),
}));

guestSessionsReducer.with(hostedRosterLoading, (state, { payload: [workspaceId] }) => ({
  ...state,
  hostedRosters: {
    ...state.hostedRosters,
    [workspaceId]: {
      status: 'loading',
      members: state.hostedRosters[workspaceId]?.members ?? [],
    },
  },
}));
guestSessionsReducer.with(hostedRosterReceived, (state, { payload: [workspaceId, members] }) => ({
  ...state,
  hostedRosters: { ...state.hostedRosters, [workspaceId]: { status: 'loaded', members } },
}));
guestSessionsReducer.with(hostedRosterFailed, (state, { payload: [workspaceId] }) => ({
  ...state,
  hostedRosters: {
    ...state.hostedRosters,
    [workspaceId]: { status: 'error', members: state.hostedRosters[workspaceId]?.members ?? [] },
  },
}));
guestSessionsReducer.with(hostedRosterWithheld, (state, { payload: [workspaceId] }) => ({
  ...state,
  hostedRosters: { ...state.hostedRosters, [workspaceId]: { status: 'withheld', members: [] } },
  removingMemberKeys: withoutWorkspaceKeys(state.removingMemberKeys, workspaceId),
}));

/** Drop one workspace's roster + *Remove* markers (deleted / removed entity). */
function purgeHostedRoster(state: GuestSessionsState, workspaceId: string): GuestSessionsState {
  if (!(workspaceId in state.hostedRosters)) {
    const removingMemberKeys = withoutWorkspaceKeys(state.removingMemberKeys, workspaceId);
    return removingMemberKeys === state.removingMemberKeys
      ? state
      : { ...state, removingMemberKeys };
  }
  const { [workspaceId]: _purged, ...hostedRosters } = state.hostedRosters;
  return {
    ...state,
    hostedRosters,
    removingMemberKeys: withoutWorkspaceKeys(state.removingMemberKeys, workspaceId),
  };
}

function withoutWorkspaceKeys(keys: string[], workspaceId: string): string[] {
  const prefix = hostedMemberKey(workspaceId, '');
  const next = keys.filter((key) => !key.startsWith(prefix));
  return next.length === keys.length ? keys : next;
}

guestSessionsReducer.with(workspaceDeleted, (state, { payload: [workspaceId] }) =>
  purgeHostedRoster(state, workspaceId),
);
guestSessionsReducer.with(removeWorkspaceEntity, (state, { payload: [workspaceId] }) =>
  purgeHostedRoster(state, workspaceId),
);
// The window's workspace list was reset (backend change): every roster is a
// view of the previous backend's data.
guestSessionsReducer.with(resetWorkspaceState, (state) =>
  Object.keys(state.hostedRosters).length === 0 && state.removingMemberKeys.length === 0
    ? state
    : { ...state, hostedRosters: {}, removingMemberKeys: [] },
);

guestSessionsReducer.with(
  removeMemberOperationStarted,
  (state, { payload: [workspaceId, principalId] }) => {
    const key = hostedMemberKey(workspaceId, principalId);
    return state.removingMemberKeys.includes(key)
      ? state
      : { ...state, removingMemberKeys: [...state.removingMemberKeys, key] };
  },
);
guestSessionsReducer.with(
  removeMemberOperationSettled,
  (state, { payload: [workspaceId, principalId] }) => {
    const key = hostedMemberKey(workspaceId, principalId);
    return { ...state, removingMemberKeys: state.removingMemberKeys.filter((k) => k !== key) };
  },
);
