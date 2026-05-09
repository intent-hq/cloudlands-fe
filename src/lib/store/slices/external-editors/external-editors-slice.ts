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

const VALID_CATEGORIES = new Set<EditorCategory>(["ide", "terminal", "finder"]);
const VALID_HANDLER_TYPES = new Set<InstalledEditor["handlerType"]>([
  "generic",
  "vscode",
  "jetbrains",
  "xcode",
  "finder",
]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return fallback;
}

function coerceOptionalString(value: unknown): string | undefined {
  const coerced = coerceString(value, "");
  return coerced ? coerced : undefined;
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  if (typeof value === "number") return value !== 0;
  return false;
}

function coercePriority(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeOpenAction(action: unknown): OpenAction {
  return coerceString(action, DEFAULT_ACTION) || DEFAULT_ACTION;
}

export function normalizeExternalEditorsError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error)) {
    return (
      coerceOptionalString(error.message) ??
      coerceOptionalString(error.error) ??
      "Failed to detect editors"
    );
  }
  return coerceString(error, "Failed to detect editors") || "Failed to detect editors";
}

export function normalizeInstalledEditor(value: unknown): InstalledEditor | null {
  if (!isRecord(value)) return null;

  const id = coerceString(value.id, "").trim();
  if (!id) return null;

  const categoryValue = coerceString(value.category, "ide") as EditorCategory;
  const handlerTypeValue = coerceString(value.handlerType, "generic") as InstalledEditor["handlerType"];
  const bundleId = coerceOptionalString(value.bundleId);
  const shortcut = coerceOptionalString(value.shortcut);
  const iconBase64 = coerceOptionalString(value.iconBase64);

  return {
    id,
    name: coerceString(value.name, id),
    shortLabel: coerceString(value.shortLabel, id),
    appName: coerceString(value.appName, id),
    category: VALID_CATEGORIES.has(categoryValue) ? categoryValue : "ide",
    handlerType: VALID_HANDLER_TYPES.has(handlerTypeValue) ? handlerTypeValue : "generic",
    priority: coercePriority(value.priority),
    installed: coerceBoolean(value.installed),
    ...(bundleId ? { bundleId } : {}),
    ...(shortcut ? { shortcut } : {}),
    ...(iconBase64 ? { iconBase64 } : {}),
  };
}

export function normalizeInstalledEditors(editors: unknown): InstalledEditor[] {
  if (!Array.isArray(editors)) return [];
  return editors.flatMap((editor) => {
    const normalized = normalizeInstalledEditor(editor);
    return normalized ? [normalized] : [];
  });
}

// ============================================================================
// Reducer
// ============================================================================

export const externalEditorsReducer = createReducer<ExternalEditorsState>(
  initialState
)
  .with(setOpenAction, (state, { payload: [selectedAction] }) => ({
    ...state,
    selectedAction: normalizeOpenAction(selectedAction),
  }))
  .with(fetchEditorsSuccess, (state, { payload: [editors, lastFetched] }) => ({
    ...state,
    editors: createCollection<InstalledEditor, "id">("id", normalizeInstalledEditors(editors)),
    lastFetched: typeof lastFetched === "number" && Number.isFinite(lastFetched) ? lastFetched : 0,
    loading: false,
    error: null,
  }))
  .with(fetchEditorsFailure, (state, { payload: [error] }) => ({
    ...state,
    error: normalizeExternalEditorsError(error),
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