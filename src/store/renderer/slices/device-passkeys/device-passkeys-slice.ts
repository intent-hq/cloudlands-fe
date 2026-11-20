import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItems,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import type { PasskeyDeviceCredential, PasskeyDeviceListResult } from '$shared/ipc/passkeys';

type DevicePasskeysStatus = 'unknown' | 'loading' | 'ready' | 'error' | 'unavailable';

/** What Settings → Passkeys renders. */
export interface DevicePasskeysView {
  status: DevicePasskeysStatus;
  credentials: PasskeyDeviceCredential[];
  deletingIds: string[];
  deleteFailedId: string | null;
}

/** Settings → Passkeys: device passkeys that the browser-panel helper keeps (Linux). */
export type DevicePasskeysState = {
  /** `unknown` until the first list; `unavailable` hides the Passkeys tab. */
  status: DevicePasskeysStatus;
  credentials: Collection<PasskeyDeviceCredential, 'credentialId'>;
  deletingIds: string[];
  /** The last delete that failed; cleared by the next list or delete. */
  deleteFailedId: string | null;
};

export const initialState: DevicePasskeysState = {
  status: 'unknown',
  credentials: createCollection<PasskeyDeviceCredential, 'credentialId'>('credentialId'),
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
// Only a retry after an error shows loading; the first list keeps the tab hidden.
devicePasskeysReducer.with(devicePasskeysRequested, (state) =>
  state.status === 'error' ? { ...state, status: 'loading' } : state,
);
devicePasskeysReducer.with(devicePasskeysLoaded, (state, { payload: [result] }) => {
  if (!result.available) return { ...initialState, status: 'unavailable' };
  if ('error' in result) return { ...state, status: 'error', deleteFailedId: null };
  return {
    ...state,
    status: 'ready',
    credentials: createCollection<PasskeyDeviceCredential, 'credentialId'>(
      'credentialId',
      result.credentials,
    ),
    deleteFailedId: null,
  };
});
devicePasskeysReducer.with(devicePasskeyDeleteRequested, (state, { payload: [credentialId] }) =>
  state.deletingIds.includes(credentialId)
    ? state
    : { ...state, deletingIds: [...state.deletingIds, credentialId], deleteFailedId: null },
);
devicePasskeysReducer.with(
  devicePasskeyDeleteFinished,
  (state, { payload: [credentialId, ok] }) => ({
    ...state,
    deletingIds: state.deletingIds.filter((id) => id !== credentialId),
    credentials: ok
      ? createCollection<PasskeyDeviceCredential, 'credentialId'>(
          'credentialId',
          getItems(state.credentials).filter((entry) => entry.credentialId !== credentialId),
        )
      : state.credentials,
    deleteFailedId: ok ? null : credentialId,
  }),
);

export function devicePasskeysView(state: DevicePasskeysState): DevicePasskeysView {
  return {
    status: state.status,
    credentials: getItems(state.credentials),
    deletingIds: state.deletingIds,
    deleteFailedId: state.deleteFailedId,
  };
}
