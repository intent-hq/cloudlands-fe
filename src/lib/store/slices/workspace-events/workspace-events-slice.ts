import type { WorkspaceEvent } from '$features/events/types';
import { createAction } from '../../utils/create-action';
import { createReducer } from '../../utils/create-reducer';
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
    const events = [...wsState.events, safeEvent].slice(-MAX_EVENTS);
    return setWorkspaceState(state, workspaceId, { ...wsState, events });
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
