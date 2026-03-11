import { isElectron } from "$lib/electron-bridge";
import { call, put, take, delay } from "typed-redux-saga";
import { buffers, eventChannel, type EventChannel } from "redux-saga";
import { setZoomFactor } from "../zoom-slice";
import { fetchZoomFactor } from "./init-saga";

/**
 * Create an event channel for window resize events.
 * Events are debounced by 100ms in the saga loop.
 * `buffers.none()` drops intermediate resize bursts while the saga is busy,
 * so only one re-fetch runs per burst.
 */
function createResizeChannel(): EventChannel<true> {
  return eventChannel<true>((emitter) => {
    const handler = () => emitter(true);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, buffers.none());
}

/**
 * Resize saga: listen for window.resize events (debounced 100ms),
 * then re-fetch zoom factor from the main process.
 */
export function* resizeZoomSaga() {
  if (!isElectron()) return;

  const channel: EventChannel<true> = yield* call(createResizeChannel);

  try {
    while (true) {
      yield* take(channel);
      // Debounce: wait 100ms. buffers.none() drops extra resize events that
      // arrive during the delay/fetch cycle, so a burst triggers one re-fetch.
      yield* delay(100);
      const factor: number = yield* call(fetchZoomFactor);
      yield* put(setZoomFactor(factor));
    }
  } finally {
    channel.close();
  }
}

