import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Types
// ============================================================================

export type AgentFontStyle = 'sans' | 'monospace';

export const FONT_STYLES: AgentFontStyle[] = ['sans', 'monospace'];

export type AgentFontSettingsState = {
  fontStyle: AgentFontStyle;
};

// ============================================================================
// Initial State
// ============================================================================

const initialState: AgentFontSettingsState = {
  fontStyle: 'sans',
};

// ============================================================================
// Actions
// ============================================================================

export const setAgentFontStyle = createAction<[style: AgentFontStyle]>(
  "agentFontSettings/setAgentFontStyle"
);

export const cycleFontStyle = createAction(
  "agentFontSettings/cycleFontStyle"
);

// ============================================================================
// Reducer
// ============================================================================

export const agentFontSettingsReducer = createReducer<AgentFontSettingsState>(initialState)
  .with(setAgentFontStyle, (state, { payload: [style] }) => ({
    ...state,
    fontStyle: style,
  }))
  .with(cycleFontStyle, (state) => {
    const currentIndex = FONT_STYLES.indexOf(state.fontStyle);
    const nextIndex = (currentIndex + 1) % FONT_STYLES.length;
    return {
      ...state,
      fontStyle: FONT_STYLES[nextIndex],
    };
  });

