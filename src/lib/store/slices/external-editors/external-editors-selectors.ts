import { store } from "../../store";
import type { EditorCategory } from "$shared/editors/editor-registry";
import {
  getItems,
  type Collection,
} from "svelte-redux-toolkit/utils/collections/collection-utils";
import type { InstalledEditor, OpenAction } from "./external-editors-slice";

/** Select the selected open action */
export const selectOpenAction = store.createSelector((state): OpenAction => {
  return state.externalEditors.selectedAction;
});

/** Select installed editors collection */
export const selectInstalledEditorsCollection = store.createSelector(
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

/** Select error state */
export const selectInstalledEditorsError = store.createSelector(
  (state): string | null => {
    return state.externalEditors.error;
  }
);

/** Select editors filtered by category */
export const selectInstalledEditorsByCategory = store.createSelector(
  (state, category: EditorCategory): InstalledEditor[] => {
    return selectInstalledEditors
      .select(state)
      .filter((editor) => editor.category === category);
  }
);

/** Select IDEs only */
export const selectInstalledIdes = store.createSelector((state): InstalledEditor[] => {
  return selectInstalledEditors.select(state).filter((editor) => editor.category === "ide");
});

/** Select terminals only */
export const selectInstalledTerminals = store.createSelector(
  (state): InstalledEditor[] => {
    return selectInstalledEditors
      .select(state)
      .filter((editor) => editor.category === "terminal");
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