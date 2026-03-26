import { isElectron } from "$lib/electron-bridge";
import { put } from "typed-redux-saga";
import { takeEveryFromListenSync } from "$lib/store/utils/ipc-channel";
import { setZoomFactor } from "../user-preferences-slice";

interface ZoomChangedEvent {
  zoomFactor: number;
}

export function* ipcZoomSaga() {
  if (!isElectron()) return;

  yield* takeEveryFromListenSync<ZoomChangedEvent>("window:zoom-changed", function* (data) {
      if (typeof data?.zoomFactor === "number" && data.zoomFactor > 0) {
        yield* put(setZoomFactor(data.zoomFactor));
      }
    });
}