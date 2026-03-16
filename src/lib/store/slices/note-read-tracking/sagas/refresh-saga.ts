import { debounce } from "typed-redux-saga";
import { refreshUnreadNotes } from "../note-read-tracking-slice";
import { handleComputeUnreadNotes } from "./ipc-saga";

const COMPUTE_DEBOUNCE_MS = 50;

/**
 * Debounced refresh of unread notes.
 * Uses redux-saga's debounce effect (50ms) to coalesce rapid calls.
 * The worker uses takeLatest-like behavior via handleComputeUnreadNotes.
 */
export function* refreshSaga() {
  yield* debounce(COMPUTE_DEBOUNCE_MS, refreshUnreadNotes, handleComputeUnreadNotes);
}

