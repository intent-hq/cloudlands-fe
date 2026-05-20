import {
  getItems,
  type Collection,
} from "svelte-redux-toolkit/utils/collections/collection-utils";
import { createSelector } from "../../utils/create-selector";
import type { PanelContextItem, SelectionContextItem } from "./multi-panel-context-slice";

export const selectPanelsCollection = createSelector(
  (state): Collection<PanelContextItem, "id"> => {
    return state.multiPanelContext.panels;
  }
);

export const selectPanels = createSelector((state) => {
  return getItems(selectPanelsCollection.select(state));
});

export const selectCheckedPanels = createSelector((state) => {
  return selectPanels.select(state).filter((p) => p.checked);
});

export const selectSelectionsCollection = createSelector(
  (state): Collection<SelectionContextItem, "id"> => {
    return state.multiPanelContext.selections;
  }
);

export const selectSelections = createSelector((state) => {
  return getItems(selectSelectionsCollection.select(state));
});

export const selectCheckedSelections = createSelector((state) => {
  return selectSelections.select(state).filter((s) => s.checked);
});

export const selectHasSelections = createSelector((state) => {
  return state.multiPanelContext.selections.ids.length > 0;
});

export const selectSelectionCount = createSelector((state) => {
  return state.multiPanelContext.selections.ids.length;
});

export const selectWorkspaceId = createSelector((state) => {
  return state.multiPanelContext.workspaceId;
});

export const selectCurrentAgentPanelId = createSelector((state) => {
  return state.multiPanelContext.currentAgentPanelId;
});

