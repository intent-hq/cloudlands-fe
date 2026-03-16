import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import type { EditorCategory } from "$shared/editors/editor-registry";

// ============================================================================
// Types
// ============================================================================

/** Detected editor from the main process */
export interface InstalledEditor {
  id: string;
  name: string;
  shortLabel: string;
  appName: string;
  category: EditorCategory;
  handlerType: "generic" | "vscode" | "jetbrains" | "xcode" | "finder";
  bundleId?: string;
  shortcut?: string;
  priority: number;
  installed: boolean;
  /** Base64-encoded PNG icon extracted from the app bundle */
  iconBase64?: string;
}

export type InstalledEditorsState = {
  editors: InstalledEditor[];
  loading: boolean;
  error: string | null;
  lastFetched: number;
};

// ============================================================================
// Constants
// ============================================================================

export const STORAGE_KEY = "installed-editors-cache";
export const CACHE_TTL_MS = 60000; // 1 minute cache

// ============================================================================
// Initial State
// ============================================================================

export const initialState: InstalledEditorsState = {
  editors: [],
  loading: false,
  error: null,
  lastFetched: 0,
};

// ============================================================================
// Actions
// ============================================================================

/** Trigger fetch of installed editors (saga handles IPC + caching) */
export const fetchEditors = createAction<[forceRefresh?: boolean]>(
  "installedEditors/fetchEditors"
);

/** Set editors and lastFetched on successful fetch */
export const fetchEditorsSuccess = createAction<
  [editors: InstalledEditor[], lastFetched: number]
>("installedEditors/fetchEditorsSuccess");

/** Set error on failed fetch */
export const fetchEditorsFailure = createAction<[error: string]>(
  "installedEditors/fetchEditorsFailure"
);

/** Clear stale error before a new fetch starts */
export const clearError = createAction("installedEditors/clearError");

/** Set loading state */
export const setLoading = createAction<[loading: boolean]>(
  "installedEditors/setLoading"
);

// ============================================================================
// Reducer
// ============================================================================

export const installedEditorsReducer = createReducer<InstalledEditorsState>(
  initialState
)
  .with(fetchEditorsSuccess, (state, { payload: [editors, lastFetched] }) => ({
    ...state,
    editors,
    lastFetched,
    loading: false,
    error: null,
  }))
  .with(fetchEditorsFailure, (state, { payload: [error] }) => ({
    ...state,
    error,
    loading: false,
  }))
  .with(clearError, (state) => ({
    ...state,
    error: null,
  }))
  .with(setLoading, (state, { payload: [loading] }) => ({
    ...state,
    loading,
  }));

