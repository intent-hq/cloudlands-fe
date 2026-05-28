/**
 * Workspace Events Redux Slice
 *
 * Manages a capped buffer of recent workspace events per workspace.
 * This is the Redux replacement for the imperative eventBus.emitEvent() pattern.
 *
 * Deduplication is handled in a coordinating saga (not the reducer) using a
 * module-level cache in `dedup-cache.ts`. The saga watches `emitWorkspaceEvent`,
 * checks the dedup cache, and dispatches `workspaceEventAccepted` for non-duplicates.
 * Downstream sagas listen to `workspaceEventAccepted` instead of `emitWorkspaceEvent`.
 *
 * Actions:
 * - emitWorkspaceEvent: Dispatch a workspace event (dedup checked in saga)
 * - workspaceEventAccepted: Internal — event passed dedup, downstream sagas listen here
 * - clearWorkspaceEvents: Clear the event buffer for a workspace
 * - cleanupWorkspace: Remove workspace state entirely
 * - eventPersisted: Saga feedback — event was persisted to storage
 * - eventBroadcasted: Saga feedback — event was broadcast to renderer
 */

import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import { createReducer } from "svelte-redux-toolkit/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../../utils/workspace-scoped";
import type { WorkspaceEvent } from "../../../../features/events/types";
import {
  type WorkspaceEventsState,
  type WorkspaceEventState,
  emptyWorkspaceEventState,
  MAX_RECENT_EVENTS,
} from "./types";


// ============================================================================
// Initial State
// ============================================================================

export const initialState: WorkspaceEventsState = {
  byWorkspaceId: {},
};

// ============================================================================
// Actions
// ============================================================================

/** Emit a single workspace event into the buffer */
export const emitWorkspaceEvent = createAction(
  "workspaceEvents/emitWorkspaceEvent",
  (event: WorkspaceEvent) =>
    [event, Date.parse(event.timestamp)] as [WorkspaceEvent, number],
);

/** Clear the event buffer for a workspace (keeps workspace state entry) */
export const clearWorkspaceEvents = createAction<[workspaceId: string]>(
  "workspaceEvents/clearWorkspaceEvents",
);

/** Remove workspace state entirely */
export const cleanupWorkspace = createAction<[workspaceId: string]>(
  "workspaceEvents/cleanupWorkspace",
);

/**
 * Internal action dispatched by the coordinating dedup saga when an event
 * passes the dedup check. Downstream sagas (persistence, broadcast,
 * renderer-subscription, event-triggered) listen to this instead of
 * emitWorkspaceEvent, ensuring duplicates never reach them.
 */
export const workspaceEventAccepted = createAction(
  "workspaceEvents/workspaceEventAccepted",
  (event: WorkspaceEvent) =>
    [event, Date.parse(event.timestamp)] as [WorkspaceEvent, number],
);

/** Saga feedback: event was persisted to storage */
export const eventPersisted = createAction<[workspaceId: string, eventId: string]>(
  "workspaceEvents/eventPersisted",
);

/** Saga feedback: event was broadcast to renderer */
export const eventBroadcasted = createAction<[eventId: string]>(
  "workspaceEvents/eventBroadcasted",
);

// ============================================================================
// Workspace-scoped helpers
// ============================================================================

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceEventState);

// ============================================================================
// Internal helpers
// ============================================================================

/** Append events to a workspace state, capping the buffer at MAX_RECENT_EVENTS */
function appendEvents(
  ws: WorkspaceEventState,
  events: WorkspaceEvent[],
): WorkspaceEventState {
  if (events.length === 0) return ws;

  const combined = [...ws.recentEvents, ...events];
  const capped =
    combined.length > MAX_RECENT_EVENTS
      ? combined.slice(combined.length - MAX_RECENT_EVENTS)
      : combined;

  const lastEvent = events[events.length - 1];

  return {
    ...ws,
    recentEvents: capped,
    eventCount: ws.eventCount + events.length,
    lastEventTimestamp: lastEvent.timestamp,
  };
}

// ============================================================================
// Reducer
// ============================================================================

export const workspaceEventsReducer = createReducer<WorkspaceEventsState>(initialState)
  .with(workspaceEventAccepted, (state, { payload: [event] }) => {
    // Only accepted (deduped) events reach here — the coordinating saga
    // dispatches workspaceEventAccepted after the dedup check passes.
    const wsId = event.workspaceId;
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, appendEvents(ws, [event]));
  })
  .with(clearWorkspaceEvents, (state, { payload: [workspaceId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    if (ws.recentEvents.length === 0) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      recentEvents: [],
    });
  })
  .with(cleanupWorkspace, (state, { payload: [workspaceId] }) => {
    return clearWorkspaceState(state, workspaceId);
  });

// Note: eventPersisted and eventBroadcasted are saga-only feedback actions.
// They don't modify state — sagas will listen for them.

