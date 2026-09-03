import type { WorkspaceEvent } from '$features/events/types';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { sanitizeWorkspaceEvent, sanitizeWorkspaceEventsList } from './workspace-events-sanitizer';

// Buffer depth. The raw feed includes chatty machine events (agent:stream:*,
// tool-call status patches, git-status ticks) that UI consumers filter out, so
// the buffer must be deep enough that user-meaningful events survive the cap.
const MAX_EVENTS = 300;

export type WorkspaceEventsWorkspaceState = {
  events: WorkspaceEvent[];
  loading: boolean;
  error: string | null;
  loadingOlder: boolean;
  olderError: string | null;
  nextToken: string | null;
  endReached: boolean;
};

export type WorkspaceEventsState = {
  byWorkspaceId: Record<string, WorkspaceEventsWorkspaceState>;
};

export const emptyWorkspaceEventsState: WorkspaceEventsWorkspaceState = {
  events: [],
  loading: false,
  error: null,
  loadingOlder: false,
  olderError: null,
  nextToken: null,
  endReached: false,
};

export const initialState: WorkspaceEventsState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceEventsState);

function mergeEventPage(
  existing: WorkspaceEvent[],
  incoming: WorkspaceEvent[],
  workspaceId: string,
): WorkspaceEvent[] {
  const safeEvents = sanitizeWorkspaceEventsList(incoming, workspaceId);
  const seenIds = new Set<string>();
  return [...existing, ...safeEvents]
    .filter((event) => {
      if (seenIds.has(event.id)) return false;
      seenIds.add(event.id);
      return true;
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-MAX_EVENTS);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const eventReceived = createAction<[workspaceId: string, event: WorkspaceEvent]>(
  'workspaceEvents/eventReceived',
);
export const bulkEventsReceived = createAction<[workspaceId: string, events: WorkspaceEvent[]]>(
  'workspaceEvents/bulkEventsReceived',
);
export const eventsLoaded = createAction<
  [workspaceId: string, events: WorkspaceEvent[], nextToken?: string | null]
>('workspaceEvents/eventsLoaded');
export const eventsLoadFailed = createAction<[workspaceId: string, error: string]>(
  'workspaceEvents/eventsLoadFailed',
);
export const eventsCleared = createAction<[workspaceId: string]>('workspaceEvents/eventsCleared');
export const loadEventsRequested = createAction<[workspaceId: string]>(
  'workspaceEvents/loadEventsRequested',
);
export const loadOlderEventsRequested = createAction<[workspaceId: string]>(
  'workspaceEvents/loadOlderEventsRequested',
);
export const olderEventsLoaded = createAction<
  [workspaceId: string, events: WorkspaceEvent[], nextToken: string | null]
>('workspaceEvents/olderEventsLoaded');
export const olderEventsLoadFailed = createAction<[workspaceId: string, error: string]>(
  'workspaceEvents/olderEventsLoadFailed',
);
export const setEventsLoading = createAction<[workspaceId: string, loading: boolean]>(
  'workspaceEvents/setEventsLoading',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const workspaceEventsReducer = createReducer<WorkspaceEventsState>(initialState);
workspaceEventsReducer.with(eventReceived, (state, { payload: [workspaceId, event] }) => {
  const safeEvent = sanitizeWorkspaceEvent(event, workspaceId);
  if (!safeEvent) return state;
  const wsState = getWorkspaceState(state, workspaceId);
  // Dedup by id against the current buffer: `eventsLoaded` seeds a boot
  // snapshot from `event.query`, and a subsequent live push carrying the
  // same id (fan-out gate notwithstanding) must not double-append.
  if (wsState.events.some((existing) => existing.id === safeEvent.id)) return state;
  // STAB-2: Insert the new event in timestamp-sorted order (oldest→newest)
  // instead of blindly appending. The boot snapshot from `eventsLoaded` is
  // already oldest→newest (via `LiveEventsClient.list()`), so maintain that
  // order when live events arrive from the daemon-events-bridge.
  const combined = [...wsState.events, safeEvent].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeA - timeB;
  });
  const nextEvents = combined.slice(-MAX_EVENTS);
  return setWorkspaceState(state, workspaceId, { ...wsState, events: nextEvents });
});
workspaceEventsReducer.with(bulkEventsReceived, (state, { payload: [workspaceId, events] }) => {
  const safeEvents = sanitizeWorkspaceEventsList(events, workspaceId);
  if (safeEvents.length === 0) return state;
  const wsState = getWorkspaceState(state, workspaceId);
  const seenIds = new Set(wsState.events.map((existing) => existing.id));
  const deduped: WorkspaceEvent[] = [];
  for (const candidate of safeEvents) {
    if (seenIds.has(candidate.id)) continue;
    seenIds.add(candidate.id);
    deduped.push(candidate);
  }
  if (deduped.length === 0) return state;
  // STAB-2: Merge and sort by timestamp (oldest→newest) to maintain
  // chronological order regardless of the arrival sequence of live events.
  const combined = [...wsState.events, ...deduped].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeA - timeB;
  });
  const nextEvents = combined.slice(-MAX_EVENTS);
  return setWorkspaceState(state, workspaceId, { ...wsState, events: nextEvents });
});
workspaceEventsReducer.with(loadEventsRequested, (state, { payload: [workspaceId] }) => {
  const wsState = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...wsState,
    loading: true,
    error: null,
    loadingOlder: false,
    olderError: null,
    nextToken: null,
    endReached: false,
  });
});
workspaceEventsReducer.with(
  eventsLoaded,
  (state, { payload: [workspaceId, events, nextToken = null] }) => {
    const wsState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...wsState,
      events: mergeEventPage(wsState.events, events, workspaceId),
      loading: false,
      error: null,
      nextToken,
      endReached: nextToken === null,
    });
  },
);
workspaceEventsReducer.with(eventsLoadFailed, (state, { payload: [workspaceId, error] }) => {
  const wsState = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, { ...wsState, loading: false, error });
});
workspaceEventsReducer.with(loadOlderEventsRequested, (state, { payload: [workspaceId] }) => {
  const wsState = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...wsState,
    loadingOlder: true,
    olderError: null,
  });
});
workspaceEventsReducer.with(
  olderEventsLoaded,
  (state, { payload: [workspaceId, events, nextToken] }) => {
    const wsState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...wsState,
      events: mergeEventPage(wsState.events, events, workspaceId),
      loadingOlder: false,
      olderError: null,
      nextToken,
      endReached: nextToken === null,
    });
  },
);
workspaceEventsReducer.with(olderEventsLoadFailed, (state, { payload: [workspaceId, error] }) => {
  const wsState = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...wsState,
    loadingOlder: false,
    olderError: error,
  });
});
workspaceEventsReducer.with(eventsCleared, (state, { payload: [workspaceId] }) => {
  return clearWorkspaceState(state, workspaceId);
});
workspaceEventsReducer.with(setEventsLoading, (state, { payload: [workspaceId, loading] }) => {
  const wsState = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, { ...wsState, loading });
});
