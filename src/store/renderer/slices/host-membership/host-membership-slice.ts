import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
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
  members: Collection<HostMember, 'principalId'>;
  invites: Collection<HostInvite, 'id'>;
  loaded: boolean;
  withheld: boolean;
  busy: boolean;
  error: string | null;
  revision: number | null;
  createdInviteId: string | null;
}
export const initialState: HostMembershipState = {
  target: null,
  members: createCollection('principalId'),
  invites: createCollection('id'),
  loaded: false,
  withheld: false,
  busy: false,
  error: null,
  revision: null,
  createdInviteId: null,
};
export const hostMembershipOpened =
  createAction<[target: HostMembershipTarget]>('hostMembership/opened');
export const hostMembershipClosed =
  createAction<[target: HostMembershipTarget]>('hostMembership/closed');
export const hostMembershipRequested = createAction<
  [target: HostMembershipTarget, command: HostMembershipCommand]
>('hostMembership/requested');
export const hostMembershipStarted =
  createAction<[target: HostMembershipTarget]>('hostMembership/started');
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
  createAction<[target: HostMembershipTarget, error: string]>('hostMembership/failed');
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
hostMembershipReducer.with(hostMembershipStarted, (state, { payload: [target] }) =>
  matches(state, target) ? { ...state, busy: true, error: null } : state,
);
hostMembershipReducer.with(
  hostMembershipLoaded,
  (state, { payload: [target, members, invites, revision] }) =>
    matches(state, target)
      ? {
          ...state,
          busy: false,
          loaded: true,
          error: null,
          revision,
          members: createCollection('principalId', members),
          invites: createCollection('id', invites),
        }
      : state,
);
hostMembershipReducer.with(hostMembershipFailed, (state, { payload: [target, error] }) =>
  matches(state, target) ? { ...state, busy: false, error } : state,
);

hostMembershipReducer.with(hostMembershipFinished, (state, { payload: [target] }) =>
  matches(state, target) ? { ...state, busy: false, error: null } : state,
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
