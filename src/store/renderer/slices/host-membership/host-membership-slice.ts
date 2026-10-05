import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import { refreshLiveClientsRequested } from '../browser-clients/browser-clients-slice';
import { hostMembershipChanged } from '../principal/principal-slice';
import type { HostInvite, HostInviteInput, HostMember } from '$features/host-membership/types';

export interface HostMembershipTarget {
  session: string;
  context: string;
}
export type HostMembershipCommand =
  | { kind: 'load' }
  | { kind: 'copy'; inviteId: string }
  | { kind: 'create'; input: HostInviteInput }
  | { kind: 'remove'; principalId: string }
  | { kind: 'revoke'; inviteId: string };
export interface HostMembershipState {
  target: HostMembershipTarget | null;
  presence: {
    session: string | null;
    epoch: number;
    status: 'unknown' | 'loading' | 'ready' | 'error';
    onlinePrincipalIds: string[];
  };
  members: Collection<HostMember, 'principalId'>;
  invites: Collection<HostInvite, 'id'>;
  loaded: boolean;
  withheld: boolean;
  busy: boolean;
  creating: boolean;
  reloadPending: boolean;
  error: string | null;
  refreshError: string | null;
  revision: number | null;
  createdInviteId: string | null;
}
export const initialState: HostMembershipState = {
  target: null,
  presence: { session: null, epoch: 0, status: 'unknown', onlinePrincipalIds: [] },
  members: createCollection('principalId'),
  invites: createCollection('id'),
  loaded: false,
  withheld: false,
  busy: false,
  creating: false,
  reloadPending: false,
  error: null,
  refreshError: null,
  revision: null,
  createdInviteId: null,
};
export const hostMembershipOpened =
  createAction<[target: HostMembershipTarget]>('hostMembership/opened');
export const hostMembershipRebound =
  createAction<[target: HostMembershipTarget]>('hostMembership/rebound');
export const hostMembershipListsChanged = createAction('hostMembership/listsChanged');
export const hostMembershipClosed =
  createAction<[target: HostMembershipTarget]>('hostMembership/closed');
export const hostMembershipRequested = createAction<
  [target: HostMembershipTarget, command: HostMembershipCommand]
>('hostMembership/requested');
export const hostMembershipStarted =
  createAction<[target: HostMembershipTarget, creating?: boolean]>('hostMembership/started');
export const hostMembershipLoaded =
  createAction<
    [target: HostMembershipTarget, members: HostMember[], invites: HostInvite[], revision: number]
  >('hostMembership/loaded');
export const hostMembershipInviteCleared = createAction<[target: HostMembershipTarget]>(
  'hostMembership/inviteCleared',
);
export const hostMembershipCreated =
  createAction<[target: HostMembershipTarget, inviteId: string]>('hostMembership/created');
export const hostMembershipDenied =
  createAction<[target: HostMembershipTarget, error: string]>('hostMembership/denied');
export const hostMembershipFinished =
  createAction<[target: HostMembershipTarget]>('hostMembership/finished');
export const hostMembershipFailed =
  createAction<[target: HostMembershipTarget, error: string, refresh?: boolean]>(
    'hostMembership/failed',
  );
export const hostMembershipReducer = createReducer(initialState);
const matches = (state: HostMembershipState, target: HostMembershipTarget) =>
  state.target?.session === target.session && state.target.context === target.context;
hostMembershipReducer.with(hostMembershipOpened, (_state, { payload: [target] }) => ({
  ...initialState,
  target,
}));
hostMembershipReducer.with(hostMembershipClosed, (state, { payload: [target] }) =>
  matches(state, target) ? initialState : state,
);
hostMembershipReducer.with(
  hostMembershipStarted,
  (state, { payload: [target, creating = false] }) =>
    matches(state, target)
      ? { ...state, busy: true, creating, reloadPending: false, error: state.refreshError }
      : state,
);
hostMembershipReducer.with(
  hostMembershipLoaded,
  (state, { payload: [target, members, invites, revision] }) =>
    matches(state, target)
      ? {
          ...state,
          busy: false,
          creating: false,
          loaded: true,
          error: null,
          refreshError: null,
          revision,
          members: createCollection('principalId', members),
          invites: createCollection('id', invites),
        }
      : state,
);
hostMembershipReducer.with(hostMembershipFailed, (state, { payload: [target, error, refresh] }) =>
  matches(state, target)
    ? {
        ...state,
        busy: false,
        creating: false,
        error,
        refreshError: refresh ? error : state.refreshError,
      }
    : state,
);

hostMembershipReducer.with(hostMembershipFinished, (state, { payload: [target] }) =>
  matches(state, target)
    ? { ...state, busy: false, creating: false, error: state.refreshError }
    : state,
);

hostMembershipReducer.with(hostMembershipDenied, (state, { payload: [target, error] }) =>
  matches(state, target) ? { ...initialState, target, withheld: true, error } : state,
);

hostMembershipReducer.with(hostMembershipCreated, (state, { payload: [target, inviteId] }) =>
  matches(state, target) ? { ...state, createdInviteId: inviteId } : state,
);

hostMembershipReducer.with(hostMembershipInviteCleared, (state, { payload: [target] }) =>
  matches(state, target) && !state.busy ? { ...state, createdInviteId: null } : state,
);

hostMembershipReducer.with(hostMembershipRebound, (state, { payload: [target] }) =>
  state.target?.session === target.session ? { ...state, target, reloadPending: true } : state,
);
const invalidateLists = (state: HostMembershipState) =>
  state.target && !state.withheld ? { ...state, reloadPending: true } : state;
hostMembershipReducer.with(hostMembershipListsChanged, invalidateLists);
hostMembershipReducer.with(hostMembershipChanged, invalidateLists);

export const hostUserPresenceStarted = createAction<[session: string]>(
  'hostMembership/presenceStarted',
);
export const hostUserPresenceSettled = createAction<
  [session: string, epoch: number, onlinePrincipalIds: string[] | null]
>('hostMembership/presenceSettled');
export const hostUserPresenceCleared = createAction<[session: string]>(
  'hostMembership/presenceCleared',
);
hostMembershipReducer.with(hostUserPresenceStarted, (state, { payload: [session] }) => ({
  ...state,
  presence: { session, epoch: state.presence.epoch + 1, status: 'loading', onlinePrincipalIds: [] },
}));
hostMembershipReducer.with(refreshLiveClientsRequested, (state, { payload: [workspaceId] }) =>
  state.presence.session && !workspaceId
    ? {
        ...state,
        presence: {
          ...state.presence,
          epoch: state.presence.epoch + 1,
          status: 'loading',
          onlinePrincipalIds: [],
        },
      }
    : state,
);
hostMembershipReducer.with(
  hostUserPresenceSettled,
  (state, { payload: [session, epoch, onlinePrincipalIds] }) =>
    state.presence.session === session && state.presence.epoch === epoch
      ? {
          ...state,
          presence: {
            ...state.presence,
            status: onlinePrincipalIds === null ? 'error' : 'ready',
            onlinePrincipalIds: onlinePrincipalIds ?? [],
          },
        }
      : state,
);
hostMembershipReducer.with(hostUserPresenceCleared, (state, { payload: [session] }) =>
  state.presence.session === session
    ? { ...state, presence: { ...initialState.presence, epoch: state.presence.epoch + 1 } }
    : state,
);
