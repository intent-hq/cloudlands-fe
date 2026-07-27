import { store } from '../../store';
import type { LegacyImportReport } from './legacy-import-types';

export const selectLegacyImportLoading = store.createSelector(
  (state): boolean => state.legacyImport.loading,
);

export const selectLegacyImportReport = store.createSelector(
  (state): LegacyImportReport | null => state.legacyImport.report,
);

export const selectLegacyImportError = store.createSelector(
  (state): string | null => state.legacyImport.error,
);