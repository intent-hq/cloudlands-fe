import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { HostMembershipChange, PrincipalSnapshot } from '$shared/types/principal';
import { backendReconnected } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  setLabsMultiplayerEnabled,
  toggleLabsMultiplayer,
} from '../user-preferences/user-preferences-slice';
import type { PrincipalRead, PrincipalState } from './principal-types';

export const initialState: PrincipalState = {
  context: null,
  status: 'unknown',
  snapshot: null,
  boundPrincipalId: null,
  minimumRevision: 0,
  invalidation: 0,
  presentationVersion: 0,
  refreshedPresentationVersion: null,
  error: null,
};

export const principalContextChanged = createAction<[context: string | null]>(
  'principal/contextChanged',
);
export const principalReadStarted = createAction('principal/readStarted');
export const principalReceived =
  createAction<[read: PrincipalRead, snapshot: PrincipalSnapshot]>('principal/received');
export const principalReadFailed =
  createAction<[read: PrincipalRead, error: NonNullable<PrincipalState['error']>]>(
    'principal/readFailed',
  );
export const hostMembershipChanged = createAction<[change: HostMembershipChange]>(
  'principal/hostMembershipChanged',
);
export const principalIdentityChanged = createAction<[principalId: string]>(
  'principal/identityChanged',
);

function current(state: PrincipalState, read: PrincipalRead): boolean {
  return (
    state.status !== 'revoked' &&
    state.context === read.context &&
    state.invalidation === read.invalidation
  );
}

export const principalReducer = createReducer<PrincipalState>(initialState);
principalReducer.with(principalContextChanged, (_state, { payload: [context] }) => ({
  ...initialState,
  context,
}));
principalReducer.with(backendReconnected, (state) => ({
  ...state,
  snapshot: null,
  status: 'unknown',
  invalidation: state.invalidation + 1,
  refreshedPresentationVersion: null,
}));
principalReducer.with(principalReadStarted, (state) => ({
  ...state,
  status: state.snapshot ? 'ready' : 'loading',
  error: null,
}));
principalReducer.with(principalReceived, (state, { payload: [read, snapshot] }) => {
  if (!current(state, read)) return state;
  const { principal, capabilities } = snapshot;
  const revision = principal.hostMembershipRevision;
  if (
    (state.boundPrincipalId !== null && principal.id !== state.boundPrincipalId) ||
    (capabilities.hostMembership && (revision === undefined || revision < state.minimumRevision))
  ) {
    return { ...state, snapshot: null, status: 'error', error: 'incompatible-response' };
  }
  return {
    ...state,
    snapshot,
    status: 'ready',
    boundPrincipalId: principal.id,
    error: null,
    minimumRevision: capabilities.hostMembership && revision !== undefined ? revision : 0,
    refreshedPresentationVersion: read.presentationVersion,
  };
});
principalReducer.with(principalReadFailed, (state, { payload: [read, error] }) =>
  current(state, read) ? { ...state, snapshot: null, status: 'error', error } : state,
);
principalReducer.with(hostMembershipChanged, (state, { payload: [change] }) => {
  if (!state.context || change.revision <= state.minimumRevision || state.status === 'revoked')
    return state;
  return {
    ...state,
    snapshot: null,
    error: null,
    minimumRevision: change.revision,
    invalidation: state.invalidation + 1,
    refreshedPresentationVersion: null,
    status:
      change.action === 'removed' && change.principalId === state.boundPrincipalId
        ? 'revoked'
        : 'loading',
  };
});
principalReducer.with(principalIdentityChanged, (state, { payload: [id] }) =>
  id !== state.boundPrincipalId || state.status === 'revoked'
    ? state
    : {
        ...state,
        snapshot: null,
        status: 'loading',
        invalidation: state.invalidation + 1,
      },
);
function invalidatePresentation(state: PrincipalState): PrincipalState {
  return { ...state, presentationVersion: state.presentationVersion + 1 };
}
principalReducer.with(setLabsMultiplayerEnabled, invalidatePresentation);
principalReducer.with(toggleLabsMultiplayer, invalidatePresentation);
