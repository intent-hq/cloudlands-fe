import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Types
// ============================================================================

export type NoteFontStyle = 'sans' | 'monospace';

export const FONT_STYLES: NoteFontStyle[] = ['sans', 'monospace'];

export type NoteFontSettingsState = {
  fontStyle: NoteFontStyle;
};

// ============================================================================
// Initial State
// ============================================================================

const initialState: NoteFontSettingsState = {
  fontStyle: 'sans',
};

// ============================================================================
// Actions
// ============================================================================

export const setNoteFontStyle = createAction<[style: NoteFontStyle]>(
  "noteFontSettings/setNoteFontStyle"
);

export const cycleNoteFontStyle = createAction(
  "noteFontSettings/cycleNoteFontStyle"
);

// ============================================================================
// Reducer
// ============================================================================

export const noteFontSettingsReducer = createReducer<NoteFontSettingsState>(initialState)
  .with(setNoteFontStyle, (state, { payload: [style] }) => ({
    ...state,
    fontStyle: style,
  }))
  .with(cycleNoteFontStyle, (state) => {
    const currentIndex = FONT_STYLES.indexOf(state.fontStyle);
    const nextIndex = (currentIndex + 1) % FONT_STYLES.length;
    return {
      ...state,
      fontStyle: FONT_STYLES[nextIndex],
    };
  });

