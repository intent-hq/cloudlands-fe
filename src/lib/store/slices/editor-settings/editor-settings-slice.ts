import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Types
// ============================================================================

export type EditorSettingsState = {
  lineWrapping: boolean;
  foldUnchanged: boolean;
  diffSideBySide: boolean;
  diffIndicators: boolean;
};

// ============================================================================
// Initial State
// ============================================================================

const initialState: EditorSettingsState = {
  lineWrapping: true,
  foldUnchanged: true,
  diffSideBySide: true,
  diffIndicators: true,
};

// ============================================================================
// Actions
// ============================================================================

export const setLineWrapping = createAction<[value: boolean]>(
  "editorSettings/setLineWrapping"
);

export const setFoldUnchanged = createAction<[value: boolean]>(
  "editorSettings/setFoldUnchanged"
);

export const setDiffSideBySide = createAction<[value: boolean]>(
  "editorSettings/setDiffSideBySide"
);

export const setDiffIndicators = createAction<[value: boolean]>(
  "editorSettings/setDiffIndicators"
);

export const toggleLineWrapping = createAction(
  "editorSettings/toggleLineWrapping"
);

export const toggleFoldUnchanged = createAction(
  "editorSettings/toggleFoldUnchanged"
);

export const toggleDiffSideBySide = createAction(
  "editorSettings/toggleDiffSideBySide"
);

export const toggleDiffIndicators = createAction(
  "editorSettings/toggleDiffIndicators"
);

export const loadEditorSettings = createAction<[settings: EditorSettingsState]>(
  "editorSettings/loadEditorSettings"
);

// ============================================================================
// Reducer
// ============================================================================

export const editorSettingsReducer = createReducer<EditorSettingsState>(initialState)
  .with(setLineWrapping, (state, { payload: [value] }) => ({
    ...state,
    lineWrapping: value,
  }))
  .with(setFoldUnchanged, (state, { payload: [value] }) => ({
    ...state,
    foldUnchanged: value,
  }))
  .with(setDiffSideBySide, (state, { payload: [value] }) => ({
    ...state,
    diffSideBySide: value,
  }))
  .with(setDiffIndicators, (state, { payload: [value] }) => ({
    ...state,
    diffIndicators: value,
  }))
  .with(toggleLineWrapping, (state) => ({
    ...state,
    lineWrapping: !state.lineWrapping,
  }))
  .with(toggleFoldUnchanged, (state) => ({
    ...state,
    foldUnchanged: !state.foldUnchanged,
  }))
  .with(toggleDiffSideBySide, (state) => ({
    ...state,
    diffSideBySide: !state.diffSideBySide,
  }))
  .with(toggleDiffIndicators, (state) => ({
    ...state,
    diffIndicators: !state.diffIndicators,
  }))
  .with(loadEditorSettings, (state, { payload: [settings] }) => ({
    ...state,
    ...settings,
  }));

