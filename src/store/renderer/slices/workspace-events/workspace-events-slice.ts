import type { WorkspaceEvent } from '$features/events/types';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { sanitizeWorkspaceEvent, sanitizeWorkspaceEventsList } from './workspace-events-sanitizer';

// Buffer depth. The raw feed includes chatty machine events (agent:stream:*,
// tool-call status patches, git-status ticks) that UI consumers filter out, so
// the buffer must be deep enough that user-meaningful events survive the cap.
// Keep in sync with BOOT_SNAPSHOT_LIMIT in live-events-client.ts.
const MAX_EVENTS = 300;

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

const { getWorkspaceState, setWorkspaceState } =
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
export const loadEventsRequested = createAction<[workspaceId: string]>(
  'workspaceEvents/loadEventsRequested',
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
workspaceEventsReducer.with(eventsLoaded, (state, { payload: [workspaceId, events] }) => {
  const wsState = getWorkspaceState(state, workspaceId);
  const safeEvents = sanitizeWorkspaceEventsList(events, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...wsState,
    events: safeEvents.slice(-MAX_EVENTS),
    loading: false,
  });
});
