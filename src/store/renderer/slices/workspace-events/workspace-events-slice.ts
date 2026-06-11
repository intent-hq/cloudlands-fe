import type { WorkspaceEvent } from '$features/events/types';
import { createAction } from 'ag-redux-toolkit/utils/store/create-action';
import { createReducer } from 'ag-redux-toolkit/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { sanitizeWorkspaceEventsList } from './workspace-events-sanitizer';

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
  .with(bulkEventsReceived, (state, { payload: [workspaceId, events] }) => {
    const safeEvents = sanitizeWorkspaceEventsList(events, workspaceId);
    if (safeEvents.length === 0) return state;
    const wsState = getWorkspaceState(state, workspaceId);
    const nextEvents = [...wsState.events, ...safeEvents].slice(-MAX_EVENTS);
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
