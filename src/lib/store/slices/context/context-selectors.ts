import { createSelector } from "../../utils/create-selector";
import { getItems } from "../../utils/collection-utils";
import { emptyWorkspaceContextState } from "./context-slice";
import type { ContextItem } from "$features/context/types";
import type { ContextWorkspaceState } from "./context-types";

export const selectContextWorkspaceState = createSelector<[workspaceId: string], ContextWorkspaceState>(
  (state, workspaceId) => {
    return state.context.byWorkspaceId[workspaceId] ?? emptyWorkspaceContextState;
  },
);

export const selectContextItems = createSelector<[workspaceId: string], ContextItem[]>(
  (state, workspaceId) => {
    return getItems(selectContextWorkspaceState.select(state, workspaceId).items);
  },
);

export const selectContextLoading = createSelector<[workspaceId: string], boolean>(
  (state, workspaceId) => {
    return selectContextWorkspaceState.select(state, workspaceId).loading;
  },
);

export const selectContextError = createSelector<[workspaceId: string], string | null>(
  (state, workspaceId) => {
    return selectContextWorkspaceState.select(state, workspaceId).error;
  },
);

export const selectTopLevelContextItems = createSelector<[workspaceId: string], ContextItem[]>(
  (state, workspaceId) => {
    return selectContextItems.select(state, workspaceId).filter((item) => !item.parentNoteId);
  },
);

export const selectContextItemsForNote = createSelector<[workspaceId: string, noteId: string], ContextItem[]>(
  (state, workspaceId, noteId) => {
    return selectContextItems.select(state, workspaceId).filter((item) => item.parentNoteId === noteId);
  },
);

