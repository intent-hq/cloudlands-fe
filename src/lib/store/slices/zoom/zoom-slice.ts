import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Types
// ============================================================================

export type ZoomState = {
  zoomFactor: number;
};

// ============================================================================
// Initial State
// ============================================================================

const initialState: ZoomState = {
  zoomFactor: 1.0,
};

// ============================================================================
// Actions
// ============================================================================

/** Set the zoom factor (must be > 0) */
export const setZoomFactor = createAction<[factor: number]>("zoom/setZoomFactor");

// ============================================================================
// Reducer
// ============================================================================

export const zoomReducer = createReducer<ZoomState>(initialState)
  .with(setZoomFactor, (state, { payload: [factor] }) => {
    if (!Number.isFinite(factor) || factor <= 0) return state;
    if (factor === state.zoomFactor) return state;
    return { ...state, zoomFactor: factor };
  });

