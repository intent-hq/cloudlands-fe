import { all, call, cancelled, put, takeEvery } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import {
  getServerPairingInfoRequested,
  getSettingRequested,
  getSystemCapabilitiesRequested,
  getUserRuleRequested,
  listSettingsRequested,
  rotateServerTokenRequested,
  updateSettingsRequested,
  updateUserRuleRequested,
} from '../settings-events-slice';

type AsyncAction =
  | ReturnType<typeof listSettingsRequested>
  | ReturnType<typeof getSettingRequested>
  | ReturnType<typeof updateSettingsRequested>
  | ReturnType<typeof getUserRuleRequested>
  | ReturnType<typeof updateUserRuleRequested>
  | ReturnType<typeof getServerPairingInfoRequested>
  | ReturnType<typeof rotateServerTokenRequested>
  | ReturnType<typeof getSystemCapabilitiesRequested>;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function* runRequest(action: AsyncAction) {
  action.promise.catch(() => {});
  let settled = false;
  try {
    let result;
    switch (action.type) {
      case listSettingsRequested.type:
        result = yield* call(() => appClient.settings.list());
        break;
      case getSettingRequested.type:
        result = yield* call(() => appClient.settings.get(action.payload[0] as string));
        break;
      case updateSettingsRequested.type:
        result = yield* call(() =>
          appClient.settings.update(
            action.payload[0] as Parameters<typeof appClient.settings.update>[0],
          ),
        );
        break;
      case getUserRuleRequested.type:
        result = yield* call(() => appClient.settings.getUserRule(action.payload[0] as string));
        break;
      case updateUserRuleRequested.type:
        result = yield* call(() =>
          appClient.settings.updateUserRule(
            action.payload[0] as string,
            action.payload[1] as string,
            action.payload[2] as boolean | undefined,
          ),
        );
        break;
      case getServerPairingInfoRequested.type:
        result = yield* call(() => appClient.server.pairingInfo());
        break;
      case rotateServerTokenRequested.type:
        result = yield* call(() => appClient.server.rotateToken());
        break;
      default:
        result = yield* call(() => appClient.system.capabilities());
    }
    yield* put(action.success(result as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Settings request was cancelled')));
    }
  }
}

export function* settingsOperationsSaga() {
  yield* all([
    takeEvery(listSettingsRequested, runRequest),
    takeEvery(getSettingRequested, runRequest),
    takeEvery(updateSettingsRequested, runRequest),
    takeEvery(getUserRuleRequested, runRequest),
    takeEvery(updateUserRuleRequested, runRequest),
    takeEvery(getServerPairingInfoRequested, runRequest),
    takeEvery(rotateServerTokenRequested, runRequest),
    takeEvery(getSystemCapabilitiesRequested, runRequest),
  ]);
}
