/**
 * Selectors for the workspace-events slice.
 *
 * Plain selectors invoked with an explicit main-process state snapshot.
 */

import { createMainSelector } from "../../create-main-selector";
import type { MainStoreState } from "../../types";
import type { WorkspaceEventState } from "./types";
import { emptyWorkspaceEventState } from "./types";
import type { WorkspaceEvent } from "../../../../features/events/types";

type MainSelectorState = MainStoreState;

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
export const selectRecentEvents = createMainSelector(
  (state, workspaceId: string): WorkspaceEvent[] => {
    return getWs(state, workspaceId).recentEvents;
  },
);

/** Get total event count for a workspace */
export const selectEventCount = createMainSelector(
  (state, workspaceId: string): number => {
    return getWs(state, workspaceId).eventCount;
  },
);

/** Filter events by type for a workspace */
export const selectEventsByType = createMainSelector(
  (state, workspaceId: string, type: string): WorkspaceEvent[] => {
    return getWs(state, workspaceId).recentEvents.filter((e) => e.type === type);
  },
);

