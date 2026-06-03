import { invoke } from "$lib/electron-bridge";
import { AUGGIE_CHANNELS } from "$shared/ipc/channels";
import {
  call,
  put,
} from "typed-redux-saga";
import { setSystemStatus } from "../system-status-slice";

type SystemStatusResponse = {
  success: boolean;
  data?: {
    nodeVersionOk: boolean;
    nodeVersion?: string;
    installed?: boolean;
    binaryInstallAvailable?: boolean;
  };
};

export function* loadSystemStatusSaga() {
  try {
    const result: SystemStatusResponse = yield* call(
      invoke<SystemStatusResponse>,
      AUGGIE_CHANNELS.STATUS
    );

    if (result.data) {
      yield* put(
        setSystemStatus({
          nodeVersionOk: result.data.nodeVersionOk,
          nodeVersion: result.data.nodeVersion,
          auggieInstalled: result.data.installed ?? false,
          binaryInstallAvailable: result.data.binaryInstallAvailable ?? false,
        })
      );
    }
  } catch {
    // Silently ignore — the warning just won't show.
  }
}

export function* systemStatusSaga() {
  yield* call(loadSystemStatusSaga);
}