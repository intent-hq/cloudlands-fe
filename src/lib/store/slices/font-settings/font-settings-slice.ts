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

export type FontStyle = 'sans' | 'monospace';
export type AgentFontStyle = FontStyle;
export type NoteFontStyle = FontStyle;

export const FONT_STYLES: FontStyle[] = ['sans', 'monospace'];

export interface FontOption {
  value: string;
  label: string;
  fontFamily: string;
}

export type FontSettingsState = {
  agentFontStyle: AgentFontStyle;
  noteFontStyle: NoteFontStyle;
  codeFontFamily: string;
  systemFonts: string[];
};

// ============================================================================
// Initial State
// ============================================================================

export const initialState: FontSettingsState = {
  agentFontStyle: 'sans',
  noteFontStyle: 'sans',
  codeFontFamily: 'system-default',
  systemFonts: [],
};

// ============================================================================
// Actions
// ============================================================================

export const setAgentFontStyle = createAction<[style: AgentFontStyle]>(
  "fontSettings/setAgentFontStyle"
);

export const cycleFontStyle = createAction("fontSettings/cycleFontStyle");

export const setNoteFontStyle = createAction<[style: NoteFontStyle]>(
  "fontSettings/setNoteFontStyle"
);

export const cycleNoteFontStyle = createAction("fontSettings/cycleNoteFontStyle");

export const setCodeFontFamily = createAction<[fontFamily: string]>(
  "fontSettings/setCodeFontFamily"
);

export const setSystemFonts = createAction<[fonts: string[]]>("fontSettings/setSystemFonts");

// ============================================================================
// Reducer
// ============================================================================

export const fontSettingsReducer = createReducer<FontSettingsState>(initialState)
  .with(setAgentFontStyle, (state, { payload: [style] }) => ({
    ...state,
    agentFontStyle: style,
  }))
  .with(cycleFontStyle, (state) => ({
    ...state,
    agentFontStyle: FONT_STYLES[(FONT_STYLES.indexOf(state.agentFontStyle) + 1) % FONT_STYLES.length],
  }))
  .with(setNoteFontStyle, (state, { payload: [style] }) => ({
    ...state,
    noteFontStyle: style,
  }))
  .with(cycleNoteFontStyle, (state) => ({
    ...state,
    noteFontStyle: FONT_STYLES[(FONT_STYLES.indexOf(state.noteFontStyle) + 1) % FONT_STYLES.length],
  }))
  .with(setCodeFontFamily, (state, { payload: [fontFamily] }) => ({
    ...state,
    codeFontFamily: fontFamily,
  }))
  .with(setSystemFonts, (state, { payload: [fonts] }) => ({
    ...state,
    systemFonts: fonts,
  }));