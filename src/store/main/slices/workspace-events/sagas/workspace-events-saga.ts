/**
 * Root saga for the workspace-events slice.
 *
 * Coordinates:
 * - Dedup gate: checks module-level dedup cache and dispatches workspaceEventAccepted
 * - Persistence: persists accepted events to JSONL via EventStore
 * - Broadcast: sends accepted events to renderer windows (IPC) and STDIO (MCP clients)
 * - Renderer subscriptions: delivers accepted events to filtered renderer subscriptions
 * - Event-triggered sagas: message delivery, auto-commit
 *
 * Deduplication is handled in this coordinating saga using a module-level cache
 * (dedup-cache.ts), NOT in the reducer. This ensures duplicate events never reach
 * downstream sagas — fixing the correctness issue where ALL dispatched actions
 * reached sagas regardless of reducer behavior.
 */

import { fork, put, takeEvery } from "typed-redux-saga";
import { emitWorkspaceEvent, cleanupWorkspace, workspaceEventAccepted } from "../workspace-events-slice";
import { isDuplicateEvent, clearWorkspaceCache } from "../dedup-cache";
import { workspaceEventsPersistenceSaga } from "./persistence-saga";
import { workspaceEventsBroadcastSaga } from "./broadcast-saga";
import { eventTriggeredSagas } from "./event-triggered-sagas";
import { rendererSubscriptionSaga } from "./renderer-subscription-saga";
import { Logger } from "../../../../../shared/logger";

const logger = new Logger("DedupGate");
// ---------------------------------------------------------------------------
// Dedup gate saga — single entry point for all event processing
// ---------------------------------------------------------------------------

/**
 * Watches `emitWorkspaceEvent` and checks the module-level dedup cache.
 * If the event is not a duplicate, dispatches `workspaceEventAccepted`
 * which all downstream sagas listen to.
 *
 * This is the single fork per event — downstream sagas only trigger on
 * `workspaceEventAccepted`, reducing total saga forks from 4-5 per event
 * to 1 (for duplicates, 0 downstream forks).
 */
function* handleDedupGate(action: ReturnType<typeof emitWorkspaceEvent>) {
  const [event, eventTimestampMs] = action.payload;

  if (isDuplicateEvent(event, eventTimestampMs)) {
    if (event.type === "agent:idle" || event.type === "agent:completed" || event.type === "agent:failed") {
      logger.debug(`DEDUPLICATED ${event.type} from actor=${event.actor?.id?.substring(0, 20)}`);
    }
    return; // duplicate — skip all downstream processing
  }

  if (event.type === "agent:idle" || event.type === "agent:completed" || event.type === "agent:failed") {
    logger.debug(`ACCEPTED ${event.type} from actor=${event.actor?.id?.substring(0, 20)} wsId=${event.workspaceId}`);
  }

  // Not a duplicate — dispatch accepted action for downstream sagas + reducer
  yield* put(workspaceEventAccepted(event));
}

// ---------------------------------------------------------------------------
// Workspace cleanup — clear module-level dedup cache
// ---------------------------------------------------------------------------

function* handleCleanupWorkspace(action: ReturnType<typeof cleanupWorkspace>) {
  const [workspaceId] = action.payload;
  clearWorkspaceCache(workspaceId);
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* workspaceEventsSaga() {
  // Dedup gate: watches emitWorkspaceEvent, dispatches workspaceEventAccepted
  yield* takeEvery(emitWorkspaceEvent, handleDedupGate);

  // Clean up module-level dedup cache when workspace is removed
  yield* takeEvery(cleanupWorkspace, handleCleanupWorkspace);

  // All downstream sagas listen to workspaceEventAccepted (not emitWorkspaceEvent)
  yield* fork(workspaceEventsPersistenceSaga);
  yield* fork(workspaceEventsBroadcastSaga);

  // Renderer subscription delivery (replaces store.subscribe() in events.ipc.ts)
  yield* fork(rendererSubscriptionSaga);

  // Event-triggered sagas (message delivery, auto-commit)
  yield* fork(eventTriggeredSagas);
}

