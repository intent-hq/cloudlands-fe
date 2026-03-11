import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_WIDTH = 350;
export const MIN_WIDTH = 180;
export const MAX_WIDTH = 800;

// ============================================================================
// Types
// ============================================================================

export type SidebarWidthState = {
  width: number;
  widthBeforeCollapse: number;
  isCollapsed: boolean;
};

// ============================================================================
// Initial State
// ============================================================================

export const initialState: SidebarWidthState = {
  width: DEFAULT_WIDTH,
  widthBeforeCollapse: DEFAULT_WIDTH,
  isCollapsed: false,
};

// ============================================================================
// Actions
// ============================================================================

export const setWidth = createAction<[pixels: number]>("sidebarWidth/setWidth");

export const toggleSidebar = createAction("sidebarWidth/toggleSidebar");

export const setCollapsed = createAction<[collapsed: boolean]>(
  "sidebarWidth/setCollapsed"
);

export const loadSidebarState = createAction<[width: number, collapsed: boolean]>(
  "sidebarWidth/loadSidebarState"
);

// ============================================================================
// Reducer
// ============================================================================

export const sidebarWidthReducer = createReducer<SidebarWidthState>(initialState)
  .with(setWidth, (state, { payload: [pixels] }) => {
    const newWidth = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, pixels)));
    return {
      ...state,
      width: newWidth,
      widthBeforeCollapse: state.isCollapsed ? state.widthBeforeCollapse : newWidth,
    };
  })
  .with(toggleSidebar, (state) => {
    if (state.isCollapsed) {
      return { ...state, isCollapsed: false };
    }
    return {
      ...state,
      widthBeforeCollapse: state.width,
      isCollapsed: true,
    };
  })
  .with(setCollapsed, (state, { payload: [collapsed] }) => {
    if (collapsed === state.isCollapsed) {
      return state;
    }
    if (collapsed) {
      return {
        ...state,
        widthBeforeCollapse: state.width,
        isCollapsed: true,
      };
    }
    return { ...state, isCollapsed: false };
  })
  .with(loadSidebarState, (_state, { payload: [width, collapsed] }) => ({
    width,
    widthBeforeCollapse: width,
    isCollapsed: collapsed,
  }));

