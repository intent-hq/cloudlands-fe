import type { EditorCategory } from "$shared/editors/editor-registry";
import { createSelector } from "../../utils/create-selector";
import {
  getItems,
  type Collection,
} from "../../utils/collection-utils";
import type { InstalledEditor, OpenAction } from "./external-editors-slice";

/** Select the selected open action */
export const selectOpenAction = createSelector((state): OpenAction => {
  return state.externalEditors.selectedAction;
});

/** Select installed editors collection */
export const selectInstalledEditorsCollection = createSelector(
  (state): Collection<InstalledEditor, "id"> => {
    return state.externalEditors.editors;
  }
);

/** Select all installed editors */
export const selectInstalledEditors = createSelector(
  (state): InstalledEditor[] => {
    return getItems(selectInstalledEditorsCollection.select(state));
  }
);

/** Select loading state */
export const selectInstalledEditorsLoading = createSelector(
  (state): boolean => {
    return state.externalEditors.loading;
  }
);

/** Select error state */
export const selectInstalledEditorsError = createSelector(
  (state): string | null => {
    return state.externalEditors.error;
  }
);

/** Select editors filtered by category */
export const selectInstalledEditorsByCategory = createSelector(
  (state, category: EditorCategory): InstalledEditor[] => {
    return selectInstalledEditors
      .select(state)
      .filter((editor) => editor.category === category);
  }
);

/** Select IDEs only */
export const selectInstalledIdes = createSelector((state): InstalledEditor[] => {
  return selectInstalledEditors.select(state).filter((editor) => editor.category === "ide");
});

/** Select terminals only */
export const selectInstalledTerminals = createSelector(
  (state): InstalledEditor[] => {
    return selectInstalledEditors
      .select(state)
      .filter((editor) => editor.category === "terminal");
  }
);

/** Select the last fetched timestamp */
export const selectLastFetched = createSelector((state): number => {
  return state.externalEditors.lastFetched;
});

/** Select editor IDs hidden from Open In menus */
export const selectHiddenEditorIds = createSelector((state): string[] => {
  return state.externalEditors.hiddenEditorIds;
});

/** Select editors where installed === true and not hidden */
export const selectInstalledEditorsFiltered = createSelector(
  (state): InstalledEditor[] => {
    const hiddenEditorIds = selectHiddenEditorIds.select(state);
    return selectInstalledEditors
      .select(state)
      .filter((editor) => editor.installed && !hiddenEditorIds.includes(editor.id));
  }
);