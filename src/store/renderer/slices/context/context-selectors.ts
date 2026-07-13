import { store } from "../../store";
import { getItems } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import { emptyWorkspaceContextState } from "./context-slice";
import type { ContextItem } from "$features/context/types";
import type { ContextWorkspaceState } from "./context-types";

const selectContextWorkspaceState = store.createSelector<[workspaceId: string], ContextWorkspaceState>(
  (state, workspaceId) => {
    return state.context.byWorkspaceId[workspaceId] ?? emptyWorkspaceContextState;
  },
);

export const selectContextItems = store.createSelector<[workspaceId: string], ContextItem[]>(
  (state, workspaceId) => {
    return getItems(selectContextWorkspaceState.select(state, workspaceId).items);
  },
);

export const selectTopLevelContextItems = store.createSelector<[workspaceId: string], ContextItem[]>(
  (state, workspaceId) => {
    return selectContextItems.select(state, workspaceId).filter((item) => !item.parentNoteId);
  },
);

