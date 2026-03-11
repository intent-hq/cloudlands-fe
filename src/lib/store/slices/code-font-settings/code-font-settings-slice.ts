import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Constants
// ============================================================================

export const SYSTEM_DEFAULT_FONT =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace";

// ============================================================================
// Types
// ============================================================================

export interface FontOption {
  value: string;
  label: string;
  fontFamily: string;
}

export type CodeFontSettingsState = {
  fontFamily: string;
  systemFonts: string[];
};

// ============================================================================
// Initial State
// ============================================================================

const initialState: CodeFontSettingsState = {
  fontFamily: 'system-default',
  systemFonts: [],
};

// ============================================================================
// Actions
// ============================================================================

export const setCodeFontFamily = createAction<[fontFamily: string]>(
  "codeFontSettings/setCodeFontFamily"
);

export const setSystemFonts = createAction<[fonts: string[]]>(
  "codeFontSettings/setSystemFonts"
);

// ============================================================================
// Reducer
// ============================================================================

export const codeFontSettingsReducer = createReducer<CodeFontSettingsState>(initialState)
  .with(setCodeFontFamily, (state, { payload: [fontFamily] }) => ({
    ...state,
    fontFamily,
  }))
  .with(setSystemFonts, (state, { payload: [fonts] }) => ({
    ...state,
    systemFonts: fonts,
  }));

