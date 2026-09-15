/**
 * Workspace Events Redux Slice
 *
 * Manages a capped buffer of recent workspace events per workspace.
 *
 * Actions:
 * - workspaceEventAccepted: Buffer an accepted (deduped) event
 * - cleanupWorkspace: Remove workspace state entirely
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../../utils/workspace-scoped';
import type { WorkspaceEvent } from '../../../../features/events/types';
import {
  type WorkspaceEventsState,
  type WorkspaceEventState,
  emptyWorkspaceEventState,
  MAX_RECENT_EVENTS,
} from './types';

// ============================================================================
// Initial State
// ============================================================================

export const initialState: WorkspaceEventsState = {
  byWorkspaceId: {},
};

// ============================================================================
// Actions
// ============================================================================

/** Remove workspace state entirely */
export const cleanupWorkspace = createAction<[workspaceId: string]>(
  'workspaceEvents/cleanupWorkspace',
);

/** Buffer an event that has already passed deduplication. */
export const workspaceEventAccepted = createAction(
  'workspaceEvents/workspaceEventAccepted',
  (event: WorkspaceEvent) => [event, Date.parse(event.timestamp)] as [WorkspaceEvent, number],
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
function appendEvents(ws: WorkspaceEventState, events: WorkspaceEvent[]): WorkspaceEventState {
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

export const workspaceEventsReducer = createReducer<WorkspaceEventsState>(initialState);
workspaceEventsReducer.with(workspaceEventAccepted, (state, { payload: [event] }) => {
  // Only accepted (deduped) events reach here — the coordinating saga
  // dispatches workspaceEventAccepted after the dedup check passes.
  const wsId = event.workspaceId;
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, appendEvents(ws, [event]));
});
workspaceEventsReducer.with(cleanupWorkspace, (state, { payload: [workspaceId] }) => {
  return clearWorkspaceState(state, workspaceId);
});
