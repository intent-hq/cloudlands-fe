import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import type { LegacyImportReport } from './legacy-import-types';

export type LegacyImportState = {
  loading: boolean;
  report: LegacyImportReport | null;
  error: string | null;
};

export const initialState: LegacyImportState = {
  loading: false,
  report: null,
  error: null,
};

export const legacyImportRequested = createAction<[force: boolean]>('legacyImport/requested');
export const legacyImportSucceeded =
  createAction<[report: LegacyImportReport]>('legacyImport/succeeded');
export const legacyImportFailed = createAction<[error: string]>('legacyImport/failed');

export const legacyImportReducer = createReducer<LegacyImportState>(initialState)
  .with(legacyImportRequested, (state) => ({
    ...state,
    loading: true,
    report: null,
    error: null,
  }))
  .with(legacyImportSucceeded, (state, { payload: [report] }) => ({
    ...state,
    loading: false,
    report,
    error: null,
  }))
  .with(legacyImportFailed, (state, { payload: [error] }) => ({
    ...state,
    loading: false,
    report: null,
    error,
  }));
