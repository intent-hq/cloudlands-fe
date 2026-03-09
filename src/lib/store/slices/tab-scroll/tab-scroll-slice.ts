import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { omitKey } from "../../utils/utils";

// ============================================================================
// Types
// ============================================================================

export type TabScrollState = {
  positions: Record<string, number>;
};

// ============================================================================
// Initial State
// ============================================================================

const initialState: TabScrollState = {
  positions: {},
};

// ============================================================================
// Actions
// ============================================================================

export const saveScrollPosition = createAction<[tabId: string, scrollTop: number]>(
  "tabScroll/saveScrollPosition"
);

export const removeScrollPosition = createAction<[tabId: string]>(
  "tabScroll/removeScrollPosition"
);

export const clearForWorkspace = createAction<[workspaceId: string]>(
  "tabScroll/clearForWorkspace"
);

export const loadScrollPositions = createAction<[positions: Record<string, number>]>(
  "tabScroll/loadScrollPositions"
);

// ============================================================================
// Reducer
// ============================================================================

export const tabScrollReducer = createReducer<TabScrollState>(initialState)
  .with(saveScrollPosition, (state, { payload: [tabId, scrollTop] }) => {
    if (scrollTop <= 0) {
      return state;
    }
    return {
      ...state,
      positions: { ...state.positions, [tabId]: scrollTop },
    };
  })
  .with(removeScrollPosition, (state, { payload: [tabId] }) => {
    if (!(tabId in state.positions)) {
      return state;
    }
    return {
      ...state,
      positions: omitKey(state.positions, tabId),
    };
  })
  .with(clearForWorkspace, (state, { payload: [workspaceId] }) => {
    const keysToRemove = Object.keys(state.positions).filter((key) =>
      key.includes(workspaceId)
    );
    if (keysToRemove.length === 0) {
      return state;
    }
    const newPositions = { ...state.positions };
    for (const key of keysToRemove) {
      delete newPositions[key];
    }
    return {
      ...state,
      positions: newPositions,
    };
  })
  .with(loadScrollPositions, (state, { payload: [positions] }) => ({
    ...state,
    positions,
  }));

