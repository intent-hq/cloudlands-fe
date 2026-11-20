import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { PasskeyDeviceCredential, PasskeyDeviceListResult } from '$shared/ipc/passkeys';

/** Settings → Passkeys: device passkeys that the browser-panel helper keeps (Linux). */
export type DevicePasskeysState = {
  /** `unknown` until the first list; `unavailable` hides the Passkeys tab. */
  status: 'unknown' | 'loading' | 'ready' | 'error' | 'unavailable';
  credentials: PasskeyDeviceCredential[];
  deletingIds: string[];
  /** The last delete that failed; cleared by the next list or delete. */
  deleteFailedId: string | null;
};

export const initialState: DevicePasskeysState = {
  status: 'unknown',
  credentials: [],
  deletingIds: [],
  deleteFailedId: null,
};

export const devicePasskeysRequested = createAction('devicePasskeys/requested');
export const devicePasskeysLoaded =
  createAction<[result: PasskeyDeviceListResult]>('devicePasskeys/loaded');
export const devicePasskeyDeleteRequested = createAction<[credentialId: string]>(
  'devicePasskeys/deleteRequested',
);
export const devicePasskeyDeleteFinished = createAction<[credentialId: string, ok: boolean]>(
  'devicePasskeys/deleteFinished',
);

export const devicePasskeysReducer = createReducer<DevicePasskeysState>(initialState);
devicePasskeysReducer
  // Only a retry after an error shows loading; the first list keeps the tab hidden.
  .with(devicePasskeysRequested, (state) =>
    state.status === 'error' ? { ...state, status: 'loading' } : state,
  )
  .with(devicePasskeysLoaded, (state, { payload: [result] }) => {
    if (!result.available) return { ...initialState, status: 'unavailable' };
    if ('error' in result) return { ...state, status: 'error', deleteFailedId: null };
    return { ...state, status: 'ready', credentials: result.credentials, deleteFailedId: null };
  })
  .with(devicePasskeyDeleteRequested, (state, { payload: [credentialId] }) =>
    state.deletingIds.includes(credentialId)
      ? state
      : { ...state, deletingIds: [...state.deletingIds, credentialId], deleteFailedId: null },
  )
  .with(devicePasskeyDeleteFinished, (state, { payload: [credentialId, ok] }) => ({
    ...state,
    deletingIds: state.deletingIds.filter((id) => id !== credentialId),
    credentials: ok
      ? state.credentials.filter((entry) => entry.credentialId !== credentialId)
      : state.credentials,
    deleteFailedId: ok ? null : credentialId,
  }));
