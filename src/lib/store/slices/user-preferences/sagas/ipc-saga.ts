import { isElectron } from "$lib/electron-bridge";
import { put, take } from "typed-redux-saga";
import { createListenSyncChannel } from "$lib/store/utils/ipc-channel";
import { setZoomFactor } from "../user-preferences-slice";

interface ZoomChangedEvent {
  zoomFactor: number;
}

export function* ipcZoomSaga() {
  if (!isElectron()) return;

  const channel = createListenSyncChannel<ZoomChangedEvent>("window:zoom-changed");

  try {
    while (true) {
      const data: ZoomChangedEvent = yield* take(channel);
      if (typeof data?.zoomFactor === "number" && data.zoomFactor > 0) {
        yield* put(setZoomFactor(data.zoomFactor));
      }
    }
  } finally {
    channel.close();
  }
}