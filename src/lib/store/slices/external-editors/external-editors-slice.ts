import type { EditorCategory } from "$shared/editors/editor-registry";
import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createCollection, type Collection } from "../../utils/collection-utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Open action can be any editor ID from the registry, or special actions.
 * Using string type to support dynamic editors from auto-detection.
 */
export type OpenAction = string;

/** Special non-editor actions that are always available */
export const SPECIAL_ACTIONS = ["copy", "copy-branch"] as const;
export type SpecialAction = (typeof SPECIAL_ACTIONS)[number];

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

export type ExternalEditorsState = {
  selectedAction: OpenAction;
  editors: Collection<InstalledEditor, "id">;
  loading: boolean;
  error: string | null;
  lastFetched: number;
};

// ============================================================================
// Constants
// ============================================================================

export const STORAGE_KEY = "installed-editors-cache";
export const CACHE_TTL_MS = 60000; // 1 minute cache

const DEFAULT_ACTION: OpenAction = "vscode";

// ============================================================================
// Initial State
// ============================================================================

export const initialState: ExternalEditorsState = {
  selectedAction: DEFAULT_ACTION,
  editors: createCollection<InstalledEditor, "id">("id"),
  loading: false,
  error: null,
  lastFetched: 0,
};

// ============================================================================
// Actions
// ============================================================================

export const setOpenAction = createAction<[action: OpenAction]>(
  "externalEditors/setOpenAction"
);

/** Trigger fetch of installed editors (saga handles IPC + caching) */
export const fetchEditors = createAction<[forceRefresh?: boolean]>(
  "externalEditors/fetchEditors"
);

/** Set editors and lastFetched on successful fetch */
export const fetchEditorsSuccess = createAction<
  [editors: InstalledEditor[], lastFetched: number]
>("externalEditors/fetchEditorsSuccess");

/** Set error on failed fetch */
export const fetchEditorsFailure = createAction<[error: string]>(
  "externalEditors/fetchEditorsFailure"
);

/** Clear stale error before a new fetch starts */
export const clearError = createAction("externalEditors/clearError");

/** Set loading state */
export const setLoading = createAction<[loading: boolean]>(
  "externalEditors/setLoading"
);

// ============================================================================
// Utilities
// ============================================================================

/** Check if action is a special (non-editor) action */
export function isSpecialAction(value: string): value is SpecialAction {
  return SPECIAL_ACTIONS.includes(value as SpecialAction);
}

// ============================================================================
// Reducer
// ============================================================================

export const externalEditorsReducer = createReducer<ExternalEditorsState>(
  initialState
)
  .with(setOpenAction, (state, { payload: [selectedAction] }) => ({
    ...state,
    selectedAction,
  }))
  .with(fetchEditorsSuccess, (state, { payload: [editors, lastFetched] }) => ({
    ...state,
    editors: createCollection<InstalledEditor, "id">("id", editors),
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