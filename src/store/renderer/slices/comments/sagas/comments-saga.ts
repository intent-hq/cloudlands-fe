/**
 * Comments V2 saga.
 *
 * The old Svelte store had no side effects — all backend calls were in
 * comment-manager-v2.ts, not in the store.  This saga is a placeholder
 * for future side-effect needs (e.g. persistence, IPC).
 */

import type { SagaGenerator } from "typed-redux-saga";

 
export function* commentsSaga(): SagaGenerator<void> {
  // No side effects to handle — all backend I/O stays in CommentManagerV2.
}

