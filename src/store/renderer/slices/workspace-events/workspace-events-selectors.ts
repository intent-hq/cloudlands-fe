import { store } from "../../store";
import type { WorkspaceEvent } from "$features/events/types";
import { emptyWorkspaceEventsState } from "./workspace-events-slice";

export const selectWorkspaceEvents = store.createSelector<[workspaceId: string], WorkspaceEvent[]>(
  (state, workspaceId) => {
    return (
      state.workspaceEvents.byWorkspaceId[workspaceId] ?? emptyWorkspaceEventsState
    ).events;
  }
);

export const selectEventsLoading = store.createSelector<[workspaceId: string], boolean>(
  (state, workspaceId) => {
    return (
      state.workspaceEvents.byWorkspaceId[workspaceId] ?? emptyWorkspaceEventsState
    ).loading;
  }
);

