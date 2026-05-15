import { invoke } from '$lib/electron-bridge';
import { takeEveryFromListenSync } from '$lib/store/utils/ipc-channel';
import {
  call,
  fork,
  put,
  takeEvery,
} from 'typed-redux-saga';
import {
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
const recentEventIds = new Set<string>();

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
  yield* takeEvery(workspaceMounted, handleWorkspaceMounted);
}
