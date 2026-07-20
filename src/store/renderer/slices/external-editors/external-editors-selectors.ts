import { store } from "../../store";
import {
  getItems,
  type Collection,
} from "$lib/store-shim/utils/collections/collection-utils";
import type { InstalledEditor, OpenAction } from "./external-editors-slice";

/** Select the selected open action */
export const selectOpenAction = store.createSelector((state): OpenAction => {
  return state.externalEditors.selectedAction;
});

/** Select installed editors collection */
const selectInstalledEditorsCollection = store.createSelector(
  (state): Collection<InstalledEditor, "id"> => {
    return state.externalEditors.editors;
  }
);

/** Select all installed editors */
export const selectInstalledEditors = store.createSelector(
  (state): InstalledEditor[] => {
    return getItems(selectInstalledEditorsCollection.select(state));
  }
);

/** Select loading state */
export const selectInstalledEditorsLoading = store.createSelector(
  (state): boolean => {
    return state.externalEditors.loading;
  }
);

/** Select the last fetched timestamp */
export const selectLastFetched = store.createSelector((state): number => {
  return state.externalEditors.lastFetched;
});

/** Select editor IDs hidden from Open In menus */
export const selectHiddenEditorIds = store.createSelector((state): string[] => {
  return state.externalEditors.hiddenEditorIds;
});

/** Select editors where installed === true and not hidden */
export const selectInstalledEditorsFiltered = store.createSelector(
  (state): InstalledEditor[] => {
    const hiddenEditorIds = selectHiddenEditorIds.select(state);
    return selectInstalledEditors
      .select(state)
      .filter((editor) => editor.installed && !hiddenEditorIds.includes(editor.id));
  }
);