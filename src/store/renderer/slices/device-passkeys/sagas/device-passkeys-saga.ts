import { call, put, takeEvery, takeLatest } from 'typed-redux-saga';
import { deleteDevicePasskey, listDevicePasskeys } from '$features/passkeys/device-passkeys-client';
import { createLogger } from '$lib/utils/client-logger';
import type { PasskeyDeviceListResult } from '$shared/ipc/passkeys';
import {
  devicePasskeyDeleteFinished,
  devicePasskeyDeleteRequested,
  devicePasskeysLoaded,
  devicePasskeysRequested,
} from '../device-passkeys-slice';

const logger = createLogger('DevicePasskeysSaga');

function* list() {
  let result: PasskeyDeviceListResult;
  try {
    result = yield* call(listDevicePasskeys);
  } catch (error) {
    logger.warn('device passkey list failed', error);
    result = { available: false };
  }
  yield* put(devicePasskeysLoaded(result));
}

function* remove({ payload: [credentialId] }: ReturnType<typeof devicePasskeyDeleteRequested>) {
  let ok = false;
  try {
    ok = yield* call(deleteDevicePasskey, credentialId);
  } catch (error) {
    logger.warn('device passkey delete failed', error);
  }
  yield* put(devicePasskeyDeleteFinished(credentialId, ok));
  if (ok) yield* put(devicePasskeysRequested());
}

/** Settings → Passkeys: list on request; delete, then list again. */
export function* devicePasskeysSaga() {
  yield* takeLatest(devicePasskeysRequested, list);
  yield* takeEvery(devicePasskeyDeleteRequested, remove);
}
