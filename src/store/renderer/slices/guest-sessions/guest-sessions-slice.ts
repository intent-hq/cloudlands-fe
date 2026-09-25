/**
 * Guest Sessions Slice (multiplayer w4)
 *
 * Actions + reducer for the guest side of workspace sharing: the hosts this
 * app joined through an invite link (authoritative from main, token-free), the
 * in-flight *Leave host* operations, and the owner-side rosters of the current
 * window's shared workspaces (a read-through view of `workspace.members.list`).
 */

import {
  addItem,
  createCollection,
  removeItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { removeWorkspaceEntity, resetWorkspaceState } from '../workspace/workspace-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  guestWorkspaceKey,
  hostedMemberKey,
  type GuestSessionRecord,
  type GuestSessionsListResult,
  type GuestSessionsState,
  type HostedSweepReport,
  type LeaveGuestSessionResult,
  type LeaveGuestWorkspaceResult,
  type RemoveAllHostedGuestsResult,
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
  listUnavailable: false,
  leavingIds: [],
  leavingWorkspaceKeys: [],
  failedLeaveIds: [],
  failedLeaveWorkspaceKeys: [],
  failedMemberKeys: [],
  sweepReports: createCollection<HostedSweepReport, 'workspaceId'>('workspaceId'),
  hostedRosters: {},
  removingMemberKeys: [],
  clearingWorkspaceIds: [],
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

/** The boot hydration delivered no list (invoke failed, or no Electron bridge). */
export const guestSessionsListUnavailable = createAction('guestSessions/listUnavailable');

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

/**
 * Per-workspace *Leave* on a joined host: `workspace.members.leave` on the
 * host, then the workspace is dropped from the session's local record
 * (main-owned `guest-sessions:leave-workspace`; the list refresh arrives via
 * the `guest-sessions:changed` push). The session itself is kept.
 */
export const leaveGuestWorkspaceRequested = createAsyncAction<
  [id: string, workspaceId: string],
  LeaveGuestWorkspaceResult
>('guestSessions/leaveWorkspace', 'guestSessions/leaveWorkspaceRequested');

export const leaveWorkspaceOperationStarted = createAction<[id: string, workspaceId: string]>(
  'guestSessions/leaveWorkspaceStarted',
);
export const leaveWorkspaceOperationSettled = createAction<[id: string, workspaceId: string]>(
  'guestSessions/leaveWorkspaceSettled',
);

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

/**
 * Owner-side *Remove all guests*: every collaborator removed
 * (`workspace.members.remove`) and every open invite revoked
 * (`workspace.invite.list` → `workspace.invite.revoke`), reported per step.
 */
export const removeAllHostedGuestsRequested = createAsyncAction<
  [workspaceId: string],
  RemoveAllHostedGuestsResult
>('guestSessions/removeAllHostedGuests', 'guestSessions/removeAllHostedGuestsRequested');

export const removeAllGuestsOperationStarted = createAction<[workspaceId: string]>(
  'guestSessions/removeAllGuestsStarted',
);
export const removeAllGuestsOperationSettled = createAction<[workspaceId: string]>(
  'guestSessions/removeAllGuestsSettled',
);

export const hostedSweepReportReceived = createAction<[report: HostedSweepReport]>(
  'guestSessions/hostedSweepReportReceived',
);

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
  listUnavailable: false,
}));

guestSessionsReducer.with(guestSessionsListUnavailable, (state) =>
  state.listUnavailable ? state : { ...state, listUnavailable: true },
);

guestSessionsReducer.with(leaveOperationStarted, (state, { payload: [id] }) =>
  state.leavingIds.includes(id)
    ? state
    : {
        ...state,
        leavingIds: [...state.leavingIds, id],
        failedLeaveIds: withoutId(state.failedLeaveIds, id),
      },
);
guestSessionsReducer.with(leaveGuestSessionRequested.failure, (state, { payload }) => {
  const id = payload.request[0];
  return payload.error.message === 'cancelled' || state.failedLeaveIds.includes(id)
    ? state
    : { ...state, failedLeaveIds: [...state.failedLeaveIds, id] };
});
guestSessionsReducer.with(leaveOperationSettled, (state, { payload: [id] }) => ({
  ...state,
  leavingIds: state.leavingIds.filter((leaving) => leaving !== id),
}));

guestSessionsReducer.with(
  leaveWorkspaceOperationStarted,
  (state, { payload: [id, workspaceId] }) => {
    const key = guestWorkspaceKey(id, workspaceId);
    return state.leavingWorkspaceKeys.includes(key)
      ? state
      : {
          ...state,
          leavingWorkspaceKeys: [...state.leavingWorkspaceKeys, key],
          failedLeaveWorkspaceKeys: withoutId(state.failedLeaveWorkspaceKeys, key),
        };
  },
);
guestSessionsReducer.with(
  leaveWorkspaceOperationSettled,
  (state, { payload: [id, workspaceId] }) => {
    const key = guestWorkspaceKey(id, workspaceId);
    return {
      ...state,
      leavingWorkspaceKeys: state.leavingWorkspaceKeys.filter((k) => k !== key),
    };
  },
);

guestSessionsReducer.with(leaveGuestWorkspaceRequested.failure, (state, { payload }) => {
  const key = guestWorkspaceKey(...payload.request);
  return payload.error.message === 'cancelled' || state.failedLeaveWorkspaceKeys.includes(key)
    ? state
    : { ...state, failedLeaveWorkspaceKeys: [...state.failedLeaveWorkspaceKeys, key] };
});

/** `withheld` is terminal: a load / result / failure landing on it is dropped. */
function isWithheld(state: GuestSessionsState, workspaceId: string): boolean {
  return state.hostedRosters[workspaceId]?.status === 'withheld';
}

guestSessionsReducer.with(hostedRosterLoading, (state, { payload: [workspaceId] }) =>
  isWithheld(state, workspaceId)
    ? state
    : {
        ...state,
        hostedRosters: {
          ...state.hostedRosters,
          [workspaceId]: {
            status: 'loading',
            members: state.hostedRosters[workspaceId]?.members ?? [],
          },
        },
      },
);
guestSessionsReducer.with(hostedRosterReceived, (state, { payload: [workspaceId, members] }) => {
  if (isWithheld(state, workspaceId)) return state;
  const prefix = hostedMemberKey(workspaceId, '');
  const memberKeys = new Set(
    members.map((member) => hostedMemberKey(workspaceId, member.principalId)),
  );
  // A retry belongs to the membership that failed, not a later re-addition.
  const failedMemberKeys = state.failedMemberKeys.filter(
    (key) => !key.startsWith(prefix) || memberKeys.has(key),
  );
  return {
    ...state,
    hostedRosters: { ...state.hostedRosters, [workspaceId]: { status: 'loaded', members } },
    failedMemberKeys:
      failedMemberKeys.length === state.failedMemberKeys.length
        ? state.failedMemberKeys
        : failedMemberKeys,
  };
});
guestSessionsReducer.with(hostedRosterFailed, (state, { payload: [workspaceId] }) =>
  isWithheld(state, workspaceId)
    ? state
    : {
        ...state,
        hostedRosters: {
          ...state.hostedRosters,
          [workspaceId]: {
            status: 'error',
            members: state.hostedRosters[workspaceId]?.members ?? [],
          },
        },
      },
);
guestSessionsReducer.with(hostedRosterWithheld, (state, { payload: [workspaceId] }) =>
  isWithheld(state, workspaceId)
    ? state
    : {
        ...state,
        hostedRosters: {
          ...state.hostedRosters,
          [workspaceId]: { status: 'withheld', members: [] },
        },
        removingMemberKeys: withoutWorkspaceKeys(state.removingMemberKeys, workspaceId),
        clearingWorkspaceIds: withoutId(state.clearingWorkspaceIds, workspaceId),
        failedMemberKeys: withoutWorkspaceKeys(state.failedMemberKeys, workspaceId),
      },
);

/** Drop one workspace's roster + *Remove* / sweep markers (deleted / removed entity). */
function purgeHostedRoster(state: GuestSessionsState, workspaceId: string): GuestSessionsState {
  const failedMemberKeys = withoutWorkspaceKeys(state.failedMemberKeys, workspaceId);
  const sweepReports = removeItem(state.sweepReports, workspaceId);
  const removingMemberKeys = withoutWorkspaceKeys(state.removingMemberKeys, workspaceId);
  const clearingWorkspaceIds = withoutId(state.clearingWorkspaceIds, workspaceId);
  if (!(workspaceId in state.hostedRosters)) {
    return removingMemberKeys === state.removingMemberKeys &&
      clearingWorkspaceIds === state.clearingWorkspaceIds &&
      failedMemberKeys === state.failedMemberKeys &&
      sweepReports === state.sweepReports
      ? state
      : { ...state, removingMemberKeys, clearingWorkspaceIds, failedMemberKeys, sweepReports };
  }
  const { [workspaceId]: _purged, ...hostedRosters } = state.hostedRosters;
  return {
    ...state,
    hostedRosters,
    removingMemberKeys,
    clearingWorkspaceIds,
    failedMemberKeys,
    sweepReports,
  };
}

function withoutId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : ids;
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
  Object.keys(state.hostedRosters).length === 0 &&
  state.removingMemberKeys.length === 0 &&
  state.clearingWorkspaceIds.length === 0 &&
  state.failedMemberKeys.length === 0 &&
  state.sweepReports.ids.length === 0
    ? state
    : {
        ...state,
        hostedRosters: {},
        removingMemberKeys: [],
        clearingWorkspaceIds: [],
        failedMemberKeys: [],
        sweepReports: initialState.sweepReports,
      },
);

guestSessionsReducer.with(
  removeMemberOperationStarted,
  (state, { payload: [workspaceId, principalId] }) => {
    const key = hostedMemberKey(workspaceId, principalId);
    return state.removingMemberKeys.includes(key)
      ? state
      : {
          ...state,
          removingMemberKeys: [...state.removingMemberKeys, key],
          failedMemberKeys: withoutId(state.failedMemberKeys, key),
        };
  },
);
guestSessionsReducer.with(
  removeMemberOperationSettled,
  (state, { payload: [workspaceId, principalId] }) => {
    const key = hostedMemberKey(workspaceId, principalId);
    return { ...state, removingMemberKeys: state.removingMemberKeys.filter((k) => k !== key) };
  },
);

guestSessionsReducer.with(removeAllGuestsOperationStarted, (state, { payload: [workspaceId] }) =>
  state.clearingWorkspaceIds.includes(workspaceId)
    ? state
    : {
        ...state,
        clearingWorkspaceIds: [...state.clearingWorkspaceIds, workspaceId],
        sweepReports: removeItem(state.sweepReports, workspaceId),
      },
);
guestSessionsReducer.with(removeAllGuestsOperationSettled, (state, { payload: [workspaceId] }) => ({
  ...state,
  clearingWorkspaceIds: withoutId(state.clearingWorkspaceIds, workspaceId),
}));

guestSessionsReducer.with(removeHostedMemberRequested.failure, (state, { payload }) => {
  const [workspaceId, principalId] = payload.request;
  if (
    payload.error.message === 'forbidden' ||
    payload.error.message === 'cancelled' ||
    isWithheld(state, workspaceId)
  )
    return state;
  const key = hostedMemberKey(workspaceId, principalId);
  return state.failedMemberKeys.includes(key)
    ? state
    : { ...state, failedMemberKeys: [...state.failedMemberKeys, key] };
});

guestSessionsReducer.with(hostedSweepReportReceived, (state, { payload: [report] }) => ({
  ...state,
  sweepReports: addItem(state.sweepReports, report),
}));
