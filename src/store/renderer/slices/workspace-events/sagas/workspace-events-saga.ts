import { invoke } from '$lib/electron-bridge';
import {
  HIGH_VOLUME_IPC_BUFFER_LIMIT,
  takeEveryFromListenSync,
} from '$store/renderer/utils/ipc-channel';
import type { WorkspaceEvent } from '$features/events/types';
import { buffers } from 'redux-saga';
import {
  actionChannel,
  call,
  delay,
  flush,
  fork,
  put,
  take,
  takeEvery,
} from 'typed-redux-saga';
import {
  bulkEventsReceived,
  eventReceived,
  eventsCleared,
  eventsLoaded,
  loadEventsRequested,
  setEventsLoading,
} from '../workspace-events-slice';
import {
  sanitizeWorkspaceEvent,
  sanitizeWorkspaceEventsList,
} from '../workspace-events-sanitizer';
import { workspaceMounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';

// ---------------------------------------------------------------------------
// Types for IPC payloads
// ---------------------------------------------------------------------------

interface EventsNewPayload {
  workspaceId: string;
  event: unknown;
}

interface EventsClearedPayload {
  workspaceId: string;
}

interface EventsQueryResponse {
  success: boolean;
  events?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Dedup set — tracks recently seen event IDs to avoid duplicate dispatches
// ---------------------------------------------------------------------------

const DEDUP_MAX = 200;
const EVENT_BATCH_FLUSH_INTERVAL_MS = 1_000;
export const EVENT_BATCH_ACTION_BUFFER_LIMIT = 1_000;
export const EVENTS_NEW_IPC_BUFFER_LIMIT = HIGH_VOLUME_IPC_BUFFER_LIMIT;
const recentEventIds = new Set<string>();

type PendingEventsByWorkspace = Record<string, WorkspaceEvent[]>;
type EventReceivedAction = ReturnType<typeof eventReceived>;

function isDuplicate(eventId: string): boolean {
  if (recentEventIds.has(eventId)) return true;
  recentEventIds.add(eventId);
  if (recentEventIds.size > DEDUP_MAX) {
    // Trim oldest entries (Set insertion order)
    const iter = recentEventIds.values();
    for (let i = 0; i < recentEventIds.size - DEDUP_MAX; i++) {
      recentEventIds.delete(iter.next().value!);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// IPC listener sagas
// ---------------------------------------------------------------------------

export function* watchEventsNewSaga() {
  yield* takeEveryFromListenSync<EventsNewPayload>('events:new', function* (data) {
    if (!data || typeof data.workspaceId !== 'string') return;
    const event = sanitizeWorkspaceEvent(data.event, data.workspaceId);
    if (!event) return;
    if (isDuplicate(event.id)) return;
    yield* put(eventReceived(data.workspaceId, event));
  }, {
    bufferPolicy: {
      kind: 'sliding',
      limit: EVENTS_NEW_IPC_BUFFER_LIMIT,
      rationale:
        'events:new is a high-volume audit stream; downstream storage is already bounded/batched and can load recent events again if pathological storms drop oldest queued IPC payloads.',
    },
  });
}

export function* watchEventsClearedSaga() {
  yield* takeEveryFromListenSync<EventsClearedPayload>('events:cleared', function* (data) {
    if (!data.workspaceId) return;
    yield* put(eventsCleared(data.workspaceId));
  });
}

// ---------------------------------------------------------------------------
// Load saga
// ---------------------------------------------------------------------------

export function* handleLoadEventsRequested(action: ReturnType<typeof loadEventsRequested>) {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;

  yield* put(setEventsLoading(workspaceId, true));

  try {
    const result: EventsQueryResponse = yield* call(invoke<EventsQueryResponse>, 'events:query', {
      workspaceId,
      filters: [],
      limit: 100,
    });

    if (result.success && Array.isArray(result.events)) {
      yield* put(
        eventsLoaded(workspaceId, sanitizeWorkspaceEventsList(result.events, workspaceId)),
      );
    } else {
      yield* put(setEventsLoading(workspaceId, false));
    }
  } catch {
    yield* put(setEventsLoading(workspaceId, false));
  }
}

export function* watchLoadEventsRequestedSaga() {
  yield* takeEvery(loadEventsRequested, handleLoadEventsRequested);
}

// ---------------------------------------------------------------------------
// Batched reducer storage
// ---------------------------------------------------------------------------

export function* watchBatchedEventStorageSaga() {
  const eventActions = yield* actionChannel<EventReceivedAction>(
    eventReceived,
    buffers.sliding<EventReceivedAction>(EVENT_BATCH_ACTION_BUFFER_LIMIT),
  );
  try {
    while (true) {
      const firstAction = yield* take(eventActions);
      yield* delay(EVENT_BATCH_FLUSH_INTERVAL_MS);
      const flushedActions = yield* flush(eventActions);
      const actions = [firstAction, ...flushedActions];

      const pendingByWorkspace: PendingEventsByWorkspace = {};

      for (const action of actions) {
        const [workspaceId, event] = action.payload;
        pendingByWorkspace[workspaceId] = [
          ...(pendingByWorkspace[workspaceId] ?? []),
          event,
        ];
      }

      for (const [workspaceId, events] of Object.entries(pendingByWorkspace)) {
        if (events.length === 0) continue;
        yield* put(bulkEventsReceived(workspaceId, events));
      }
    }
  } finally {
    eventActions.close();
  }
}

// ---------------------------------------------------------------------------
// Workspace mount handler — load events when workspace mounts
// ---------------------------------------------------------------------------

function* handleWorkspaceMounted(action: ReturnType<typeof workspaceMounted>) {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* put(loadEventsRequested(workspaceId));
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* workspaceEventsSaga() {
  yield* fork(watchEventsNewSaga);
  yield* fork(watchEventsClearedSaga);
  yield* fork(watchLoadEventsRequestedSaga);
  // Canonical storage watcher for eventReceived; other sagas may still use
  // eventReceived as an individual fan-out action for side effects.
  yield* fork(watchBatchedEventStorageSaga);
  yield* takeEvery(workspaceMounted, handleWorkspaceMounted);
}
