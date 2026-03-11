import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Types
// ============================================================================

export type NoteSpellcheckSettingsState = {
  enabled: boolean;
};

// ============================================================================
// Initial State
// ============================================================================

const initialState: NoteSpellcheckSettingsState = {
  enabled: false,
};

// ============================================================================
// Actions
// ============================================================================

export const setSpellcheckEnabled = createAction<[enabled: boolean]>(
  "noteSpellcheckSettings/setSpellcheckEnabled"
);

export const toggleSpellcheck = createAction(
  "noteSpellcheckSettings/toggleSpellcheck"
);

// ============================================================================
// Reducer
// ============================================================================

export const noteSpellcheckSettingsReducer = createReducer<NoteSpellcheckSettingsState>(initialState)
  .with(setSpellcheckEnabled, (state, { payload: [enabled] }) => ({
    ...state,
    enabled,
  }))
  .with(toggleSpellcheck, (state) => ({
    ...state,
    enabled: !state.enabled,
  }));

