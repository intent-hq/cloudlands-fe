import { isElectron } from "$lib/electron-bridge";
import { takeLatestFromWindowEvent } from "$store/renderer/utils/ipc-channel";
import {
  call,
  put,
  delay,
} from "typed-redux-saga";
import { setZoomFactor } from "../user-preferences-slice";
import { fetchZoomFactor } from "./init-saga";

export function* resizeZoomSaga() {
  if (!isElectron()) return;

  yield* takeLatestFromWindowEvent("resize", function* () {
      yield* delay(100);
      const factor: number = yield* call(fetchZoomFactor);
      yield* put(setZoomFactor(factor));
    });
}