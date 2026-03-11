import { call, put } from "typed-redux-saga";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { setZoomFactor } from "../zoom-slice";

/**
 * Fetch zoom factor from the Electron main process via IPC.
 */
function fetchZoomFactor(): Promise<number> {
  if (typeof window === "undefined" || !window.electronAPI) {
    return Promise.resolve(1.0);
  }

  return window.electronAPI
    .invoke(IPC_CHANNELS.WINDOW.GET_ZOOM_FACTOR, undefined)
    .then((result: any) => {
      if (result?.success && typeof result.data === "number" && result.data > 0) {
        return result.data;
      }
      return 1.0;
    })
    .catch(() => 1.0);
}

/**
 * Init saga: fetch and set the initial zoom factor on startup.
 */
export function* initZoomSaga() {
  if (typeof window === "undefined") return;

  const factor: number = yield* call(fetchZoomFactor);
  if (factor !== 1.0) {
    yield* put(setZoomFactor(factor));
  }
}

/** Exported for reuse in resize saga */
export { fetchZoomFactor };

