import { store } from "../../store";
import {
  getItems,
  type Collection,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import type { PanelContextItem, SelectionContextItem } from "./multi-panel-context-slice";

const selectPanelsCollection = store.createSelector(
  (state): Collection<PanelContextItem, "id"> => {
    return state.multiPanelContext.panels;
  }
);

export const selectPanels = store.createSelector((state) => {
  return getItems(selectPanelsCollection.select(state));
});

export const selectCheckedPanels = store.createSelector((state) => {
  return selectPanels.select(state).filter((p) => p.checked);
});

const selectSelectionsCollection = store.createSelector(
  (state): Collection<SelectionContextItem, "id"> => {
    return state.multiPanelContext.selections;
  }
);

export const selectSelections = store.createSelector((state) => {
  return getItems(selectSelectionsCollection.select(state));
});

export const selectCheckedSelections = store.createSelector((state) => {
  return selectSelections.select(state).filter((s) => s.checked);
});

