import type { WorkspaceEvent } from "$features/events/types";
import { createSelector } from "../../utils/create-selector";
import { emptyWorkspaceEventsState } from "./workspace-events-slice";

export const selectWorkspaceEvents = createSelector<[workspaceId: string], WorkspaceEvent[]>(
  (state, workspaceId) => {
    return (
      state.workspaceEvents.byWorkspaceId[workspaceId] ?? emptyWorkspaceEventsState
    ).events;
  }
);

export const selectEventsLoading = createSelector<[workspaceId: string], boolean>(
  (state, workspaceId) => {
    return (
      state.workspaceEvents.byWorkspaceId[workspaceId] ?? emptyWorkspaceEventsState
    ).loading;
  }
);

