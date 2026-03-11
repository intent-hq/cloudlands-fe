import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Types
// ============================================================================

/**
 * Open action can be any editor ID from the registry, or special actions.
 * Using string type to support dynamic editors from auto-detection.
 */
export type OpenAction = string;

/** Special non-editor actions that are always available */
export const SPECIAL_ACTIONS = ['copy', 'copy-branch'] as const;
export type SpecialAction = (typeof SPECIAL_ACTIONS)[number];

export type OpenActionState = {
  action: OpenAction;
};

// ============================================================================
// Initial State
// ============================================================================

const DEFAULT_ACTION: OpenAction = 'vscode';

const initialState: OpenActionState = {
  action: DEFAULT_ACTION,
};

// ============================================================================
// Actions
// ============================================================================

export const setOpenAction = createAction<[action: OpenAction]>(
  "openAction/setOpenAction"
);

export const loadOpenAction = createAction<[action: OpenAction]>(
  "openAction/loadOpenAction"
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

export const openActionReducer = createReducer<OpenActionState>(initialState)
  .with(setOpenAction, (state, { payload: [action] }) => ({
    ...state,
    action,
  }))
  .with(loadOpenAction, (state, { payload: [action] }) => ({
    ...state,
    action,
  }));

