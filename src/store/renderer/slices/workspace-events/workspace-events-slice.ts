import type { WorkspaceEvent } from '$features/events/types';
import { createAction } from '@augmentcode/ag-redux-toolkit/utils/store/create-action';
import { createReducer } from '@augmentcode/ag-redux-toolkit/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import {
  sanitizeWorkspaceEvent,
  sanitizeWorkspaceEventsList,
} from './workspace-events-sanitizer';

const MAX_EVENTS = 100;

export type WorkspaceEventsWorkspaceState = {
  events: WorkspaceEvent[];
  loading: boolean;
};

export type WorkspaceEventsState = {
  byWorkspaceId: Record<string, WorkspaceEventsWorkspaceState>;
};

export const emptyWorkspaceEventsState: WorkspaceEventsWorkspaceState = {
  events: [],
  loading: false,
};

export const initialState: WorkspaceEventsState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceEventsState);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const eventReceived = createAction<[workspaceId: string, event: WorkspaceEvent]>(
  'workspaceEvents/eventReceived',
);
export const bulkEventsReceived = createAction<[workspaceId: string, events: WorkspaceEvent[]]>(
  'workspaceEvents/bulkEventsReceived',
);
export const eventsLoaded = createAction<[workspaceId: string, events: WorkspaceEvent[]]>(
  'workspaceEvents/eventsLoaded',
);
export const eventsCleared = createAction<[workspaceId: string]>('workspaceEvents/eventsCleared');
export const loadEventsRequested = createAction<[workspaceId: string]>(
  'workspaceEvents/loadEventsRequested',
);
export const setEventsLoading = createAction<[workspaceId: string, loading: boolean]>(
  'workspaceEvents/setEventsLoading',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const workspaceEventsReducer = createReducer<WorkspaceEventsState>(initialState)
  .with(eventReceived, (state, { payload: [workspaceId, event] }) => {
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
    const combined = [...wsState.events, safeEvent].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
    const nextEvents = combined.slice(-MAX_EVENTS);
    return setWorkspaceState(state, workspaceId, { ...wsState, events: nextEvents });
  })
  .with(bulkEventsReceived, (state, { payload: [workspaceId, events] }) => {
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
    const combined = [...wsState.events, ...deduped].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
    const nextEvents = combined.slice(-MAX_EVENTS);
    return setWorkspaceState(state, workspaceId, { ...wsState, events: nextEvents });
  })
  .with(eventsLoaded, (state, { payload: [workspaceId, events] }) => {
    const wsState = getWorkspaceState(state, workspaceId);
    const safeEvents = sanitizeWorkspaceEventsList(events, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...wsState,
      events: safeEvents.slice(-MAX_EVENTS),
      loading: false,
    });
  })
  .with(eventsCleared, (state, { payload: [workspaceId] }) => {
    return clearWorkspaceState(state, workspaceId);
  })
  .with(setEventsLoading, (state, { payload: [workspaceId, loading] }) => {
    const wsState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, { ...wsState, loading });
  });
