/**
 * Selectors for the workspace-events slice.
 *
 * All selectors use the main-process createSelector (typed to MainStoreState,
 * cached, no Svelte Readable). Passing RendererStoreState is a compile error.
 */

import { createSelector } from "../../utils/create-selector";
import type { MainStoreState } from "../../types";
import type { WorkspaceEventState } from "./types";
import { emptyWorkspaceEventState } from "./types";
import type { WorkspaceEvent } from "../../../../features/events/types";

// ---------------------------------------------------------------------------
// Workspace-level
// ---------------------------------------------------------------------------

const getSlice = (state: MainStoreState): Record<string, WorkspaceEventState> => {
  const slice = (state as any).workspaceEvents;
  if (!slice) return {};
  return slice.byWorkspaceId ?? {};
};

const getWs = (state: MainStoreState, wsId: string): WorkspaceEventState => {
  return getSlice(state)[wsId] ?? emptyWorkspaceEventState;
};

// ---------------------------------------------------------------------------
// Public selectors
// ---------------------------------------------------------------------------

/** Get the recent events buffer for a workspace */
export const selectRecentEvents = createSelector(
  (state: MainStoreState, workspaceId: string): WorkspaceEvent[] => {
    return getWs(state, workspaceId).recentEvents;
  },
);

/** Get total event count for a workspace */
export const selectEventCount = createSelector(
  (state: MainStoreState, workspaceId: string): number => {
    return getWs(state, workspaceId).eventCount;
  },
);

/** Get the most recent event for a workspace */
export const selectLastEvent = createSelector(
  (state: MainStoreState, workspaceId: string): WorkspaceEvent | undefined => {
    const events = getWs(state, workspaceId).recentEvents;
    return events.length > 0 ? events[events.length - 1] : undefined;
  },
);

/** Filter events by type for a workspace */
export const selectEventsByType = createSelector(
  (state: MainStoreState, workspaceId: string, type: string): WorkspaceEvent[] => {
    return getWs(state, workspaceId).recentEvents.filter((e) => e.type === type);
  },
);

/** Filter events by actor ID for a workspace */
export const selectEventsByActor = createSelector(
  (state: MainStoreState, workspaceId: string, actorId: string): WorkspaceEvent[] => {
    return getWs(state, workspaceId).recentEvents.filter((e) => e.actor.id === actorId);
  },
);

