import { isElectron } from "$lib/electron-bridge";
import { call, put, take, delay } from "typed-redux-saga";
import { buffers, eventChannel, type EventChannel } from "redux-saga";
import { setZoomFactor } from "../user-preferences-slice";
import { fetchZoomFactor } from "./init-saga";

function createResizeChannel(): EventChannel<true> {
  return eventChannel<true>((emitter) => {
    const handler = () => emitter(true);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, buffers.none());
}

export function* resizeZoomSaga() {
  if (!isElectron()) return;

  const channel: EventChannel<true> = yield* call(createResizeChannel);

  try {
    while (true) {
      yield* take(channel);
      yield* delay(100);
      const factor: number = yield* call(fetchZoomFactor);
      yield* put(setZoomFactor(factor));
    }
  } finally {
    channel.close();
  }
}