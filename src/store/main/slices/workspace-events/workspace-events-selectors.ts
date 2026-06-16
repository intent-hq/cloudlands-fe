/**
 * Selectors for the workspace-events slice.
 *
 * Selectors are created from the configured main-process StreamingStore.
 * Passing RendererStoreState is a compile error.
 */

import { store } from "../../configured-store";
import type { WorkspaceEventState } from "./types";
import { emptyWorkspaceEventState } from "./types";
import type { WorkspaceEvent } from "../../../../features/events/types";

type MainSelectorState = typeof store.state;

// ---------------------------------------------------------------------------
// Workspace-level
// ---------------------------------------------------------------------------

const getSlice = (state: MainSelectorState): Record<string, WorkspaceEventState> => {
  const slice = (state as any).workspaceEvents;
  if (!slice) return {};
  return slice.byWorkspaceId ?? {};
};

const getWs = (state: MainSelectorState, wsId: string): WorkspaceEventState => {
  return getSlice(state)[wsId] ?? emptyWorkspaceEventState;
};

// ---------------------------------------------------------------------------
// Public selectors
// ---------------------------------------------------------------------------

/** Get the recent events buffer for a workspace */
export const selectRecentEvents = store.createSelector(
  (state, workspaceId: string): WorkspaceEvent[] => {
    return getWs(state, workspaceId).recentEvents;
  },
);

/** Get total event count for a workspace */
export const selectEventCount = store.createSelector(
  (state, workspaceId: string): number => {
    return getWs(state, workspaceId).eventCount;
  },
);

/** Filter events by type for a workspace */
export const selectEventsByType = store.createSelector(
  (state, workspaceId: string, type: string): WorkspaceEvent[] => {
    return getWs(state, workspaceId).recentEvents.filter((e) => e.type === type);
  },
);

