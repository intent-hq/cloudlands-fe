import { store } from '../../store';
import { devicePasskeysView, initialState, type DevicePasskeysView } from './device-passkeys-slice';

export const selectDevicePasskeys = store.createSelector((state): DevicePasskeysView =>
  devicePasskeysView(state.devicePasskeys ?? initialState),
);

/** Settings → Passkeys is shown only once the helper confirms device passkeys. */
export const selectDevicePasskeysAvailable = store.createSelector((state): boolean => {
  const status = state.devicePasskeys?.status ?? 'unknown';
  return status === 'ready' || status === 'error' || status === 'loading';
});
