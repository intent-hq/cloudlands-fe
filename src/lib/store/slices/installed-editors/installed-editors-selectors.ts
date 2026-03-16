import { createSelector } from "../../utils/create-selector";
import type { EditorCategory } from "$shared/editors/editor-registry";
import type { InstalledEditor } from "./installed-editors-slice";

/** Select all installed editors */
export const selectInstalledEditors = createSelector(
  (state): InstalledEditor[] => {
    return state.installedEditors.editors;
  }
);

/** Select loading state */
export const selectInstalledEditorsLoading = createSelector(
  (state): boolean => {
    return state.installedEditors.loading;
  }
);

/** Select error state */
export const selectInstalledEditorsError = createSelector(
  (state): string | null => {
    return state.installedEditors.error;
  }
);

/** Select editors filtered by category */
export const selectInstalledEditorsByCategory = createSelector(
  (state, category: EditorCategory): InstalledEditor[] => {
    return state.installedEditors.editors.filter(
      (e) => e.category === category
    );
  }
);

/** Select IDEs only */
export const selectInstalledIdes = createSelector(
  (state): InstalledEditor[] => {
    return state.installedEditors.editors.filter(
      (e) => e.category === "ide"
    );
  }
);

/** Select terminals only */
export const selectInstalledTerminals = createSelector(
  (state): InstalledEditor[] => {
    return state.installedEditors.editors.filter(
      (e) => e.category === "terminal"
    );
  }
);

/** Select the last fetched timestamp */
export const selectLastFetched = createSelector(
  (state): number => {
    return state.installedEditors.lastFetched;
  }
);

/** Select editors where installed === true */
export const selectInstalledEditorsFiltered = createSelector(
  (state): InstalledEditor[] => {
    return state.installedEditors.editors.filter((e) => e.installed);
  }
);

