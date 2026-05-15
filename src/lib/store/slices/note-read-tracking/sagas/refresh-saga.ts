import {
  delay,
  takeLatest,
} from "typed-redux-saga";
import { refreshUnreadNotes } from "../note-read-tracking-slice";
import { handleComputeUnreadNotes } from "./ipc-saga";

const COMPUTE_DEBOUNCE_MS = 100;

/**
 * Debounced refresh of unread notes.
 * Uses redux-saga's debounce effect (50ms) to coalesce rapid calls.
 * The worker uses takeLatest-like behavior via handleComputeUnreadNotes.
 */
export function* refreshSaga() {
  yield* takeLatest(refreshUnreadNotes, function*(action) {
    yield* delay(COMPUTE_DEBOUNCE_MS);
    yield* handleComputeUnreadNotes(action);
  });
}

