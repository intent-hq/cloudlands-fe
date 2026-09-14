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
