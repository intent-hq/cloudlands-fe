/**
 * Serializable types for the workspace-events Redux slice.
 *
 * Re-exports WorkspaceEvent from the canonical event types.
 * All types are JSON-safe — no Map, Set, Date, RegExp, or functions.
 */

import type { WorkspaceEvent } from '../../../../features/events/types';

// Re-export for convenience

/** Maximum number of recent events to keep in the buffer */
export const MAX_RECENT_EVENTS = 200;

/** Per-workspace event state */
export interface WorkspaceEventState {
  /** Capped buffer of recent events (last MAX_RECENT_EVENTS) */
  recentEvents: WorkspaceEvent[];
  /** Total count of events emitted (including evicted from buffer) */
  eventCount: number;
  /** ISO timestamp of the last event, or null if none */
  lastEventTimestamp: string | null;
}

/** Root state shape for the workspace-events slice */
export interface WorkspaceEventsState {
  byWorkspaceId: Record<string, WorkspaceEventState>;
}

/** Empty workspace state used as default by createWorkspaceScopedHelpers */
export const emptyWorkspaceEventState: WorkspaceEventState = {
  recentEvents: [],
  eventCount: 0,
  lastEventTimestamp: null,
};
