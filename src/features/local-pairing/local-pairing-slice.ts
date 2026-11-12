import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { isTerminalCode, mergeCodeUpdate } from './local-pairing-model';
import {
  sortLocalPairingCredentials,
  type LocalPairingCode,
  type LocalPairingCredential,
  type LocalPairingPanelFailure,
  type LocalPairingState,
  type LocalPairingSupport,
} from './local-pairing-types';

export const initialState: LocalPairingState = {
  support: 'unknown',
  step: 'closed',
  code: null,
  failure: null,
  credentials: null,
  removing: {},
  removeFailed: {},
};

/** Re-read support and the credential list. */
export const localPairingRefreshRequested = createAction('localPairing/refreshRequested');
export const localPairingLoaded =
  createAction<[support: LocalPairingSupport, credentials: LocalPairingCredential[] | null]>(
    'localPairing/loaded',
  );

/** "Let another Intent on this computer connect": create a code (replacing any shown one). */
export const localPairingCodeRequested = createAction('localPairing/codeRequested');
/** The daemon has no TCP listener: ask before turning on a loopback-only one. */
export const localPairingListenerNeeded = createAction('localPairing/listenerNeeded');
/** The user agreed to turn on connections from this computer. */
export const localPairingListenerConfirmed = createAction('localPairing/listenerConfirmed');
export const localPairingCodeCreated = createAction<[code: LocalPairingCode]>(
  'localPairing/codeCreated',
);
/** `pairing:localCode-changed`, or a local update after a cancel. */
export const localPairingCodeChanged = createAction<[code: LocalPairingCode]>(
  'localPairing/codeChanged',
);
export const localPairingCancelRequested = createAction('localPairing/cancelRequested');
export const localPairingPanelFailed = createAction<[failure: LocalPairingPanelFailure]>(
  'localPairing/panelFailed',
);
/** Close the panel (Not now, Done, Close); an active code is cancelled first. */
export const localPairingCloseRequested = createAction('localPairing/closeRequested');
export const localPairingPanelClosed = createAction('localPairing/panelClosed');

export const localPairingCredentialChanged = createAction<[credential: LocalPairingCredential]>(
  'localPairing/credentialChanged',
);
export const localPairingCredentialRevoked = createAction<[credentialId: string]>(
  'localPairing/credentialRevoked',
);
/** Remove one Intent from **Intents on this computer** (asks first). */
export const localPairingRemoveRequested = createAction<[credentialId: string]>(
  'localPairing/removeRequested',
);
export const localPairingRemoveStarted = createAction<[credentialId: string]>(
  'localPairing/removeStarted',
);
export const localPairingRemoveSettled = createAction<[credentialId: string, failed: boolean]>(
  'localPairing/removeSettled',
);
export const localPairingRemoveFailureDismissed = createAction<[credentialId: string]>(
  'localPairing/removeFailureDismissed',
);

function omit<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

export const localPairingReducer = createReducer<LocalPairingState>(initialState);
// Codes never survive the daemon connection's loss, and support is re-read.
localPairingReducer.with(backendReconnected, () => initialState);
localPairingReducer.with(localPairingLoaded, (state, { payload: [support, credentials] }) => ({
  ...state,
  support,
  credentials: credentials ? sortLocalPairingCredentials(credentials) : null,
  ...(support === 'supported' ? {} : { step: 'closed' as const, code: null, failure: null }),
}));
localPairingReducer.with(localPairingCodeRequested, (state) => ({
  ...state,
  step: 'creating',
  failure: null,
}));
localPairingReducer.with(localPairingListenerNeeded, (state) => ({
  ...state,
  step: 'confirm-listener',
  code: null,
  failure: null,
}));
localPairingReducer.with(localPairingListenerConfirmed, (state) =>
  state.step === 'confirm-listener' ? { ...state, step: 'enabling-listener' } : state,
);
localPairingReducer.with(localPairingCodeCreated, (state, { payload: [code] }) => ({
  ...state,
  step: 'open',
  code,
  failure: null,
}));
localPairingReducer.with(localPairingCodeChanged, (state, { payload: [update] }) => {
  const code = mergeCodeUpdate(state.code, update);
  if (code === state.code) return state;
  return {
    ...state,
    code,
    failure: code && isTerminalCode(code) ? null : state.failure,
  };
});
localPairingReducer.with(localPairingPanelFailed, (state, { payload: [failure] }) => ({
  ...state,
  step: 'open',
  // A failed cancel keeps showing the still-active code.
  code: failure === 'cancel-failed' ? state.code : null,
  failure,
}));
localPairingReducer.with(localPairingPanelClosed, (state) => ({
  ...state,
  step: 'closed',
  code: null,
  failure: null,
}));
localPairingReducer.with(localPairingCredentialChanged, (state, { payload: [credential] }) => ({
  ...state,
  credentials: sortLocalPairingCredentials([
    ...(state.credentials ?? []).filter((entry) => entry.credentialId !== credential.credentialId),
    credential,
  ]),
}));
localPairingReducer.with(localPairingCredentialRevoked, (state, { payload: [credentialId] }) => ({
  ...state,
  credentials: state.credentials?.filter((entry) => entry.credentialId !== credentialId) ?? null,
  removing: omit(state.removing, credentialId),
  removeFailed: omit(state.removeFailed, credentialId),
}));
localPairingReducer.with(localPairingRemoveStarted, (state, { payload: [credentialId] }) => ({
  ...state,
  removing: { ...state.removing, [credentialId]: true },
  removeFailed: omit(state.removeFailed, credentialId),
}));
localPairingReducer.with(
  localPairingRemoveSettled,
  (state, { payload: [credentialId, failed] }) => ({
    ...state,
    removing: omit(state.removing, credentialId),
    removeFailed: failed
      ? { ...state.removeFailed, [credentialId]: true }
      : omit(state.removeFailed, credentialId),
  }),
);
localPairingReducer.with(
  localPairingRemoveFailureDismissed,
  (state, { payload: [credentialId] }) => ({
    ...state,
    removeFailed: omit(state.removeFailed, credentialId),
  }),
);
