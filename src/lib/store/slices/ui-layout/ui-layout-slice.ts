import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

export const DEFAULT_WIDTH = 350;
export const MIN_WIDTH = 180;
export const MAX_WIDTH = 800;

export type UiLayoutState = {
  lineWrapping: boolean;
  foldUnchanged: boolean;
  diffSideBySide: boolean;
  diffIndicators: boolean;
  sidebarWidth: number;
  sidebarWidthBeforeCollapse: number;
  sidebarCollapsed: boolean;
};

type EditorSettingsFields = Pick<
  UiLayoutState,
  "lineWrapping" | "foldUnchanged" | "diffSideBySide" | "diffIndicators"
>;

export const initialState: UiLayoutState = {
  lineWrapping: true,
  foldUnchanged: true,
  diffSideBySide: true,
  diffIndicators: true,
  sidebarWidth: DEFAULT_WIDTH,
  sidebarWidthBeforeCollapse: DEFAULT_WIDTH,
  sidebarCollapsed: false,
};

export const setLineWrapping = createAction<[value: boolean]>("uiLayout/setLineWrapping");
export const setFoldUnchanged = createAction<[value: boolean]>("uiLayout/setFoldUnchanged");
export const setDiffSideBySide = createAction<[value: boolean]>("uiLayout/setDiffSideBySide");
export const setDiffIndicators = createAction<[value: boolean]>("uiLayout/setDiffIndicators");

export const toggleLineWrapping = createAction("uiLayout/toggleLineWrapping");
export const toggleFoldUnchanged = createAction("uiLayout/toggleFoldUnchanged");
export const toggleDiffSideBySide = createAction("uiLayout/toggleDiffSideBySide");
export const toggleDiffIndicators = createAction("uiLayout/toggleDiffIndicators");

export const loadEditorSettings = createAction<[settings: EditorSettingsFields]>(
  "uiLayout/loadEditorSettings"
);

export const setWidth = createAction<[pixels: number]>("uiLayout/setWidth");
export const toggleSidebar = createAction("uiLayout/toggleSidebar");
export const setCollapsed = createAction<[collapsed: boolean]>("uiLayout/setCollapsed");
export const loadSidebarState = createAction<[width: number, collapsed: boolean]>(
  "uiLayout/loadSidebarState"
);

export const uiLayoutReducer = createReducer<UiLayoutState>(initialState)
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
  }))
  .with(setWidth, (state, { payload: [pixels] }) => {
    const newWidth = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, pixels)));
    return {
      ...state,
      sidebarWidth: newWidth,
      sidebarWidthBeforeCollapse: state.sidebarCollapsed
        ? state.sidebarWidthBeforeCollapse
        : newWidth,
    };
  })
  .with(toggleSidebar, (state) => {
    if (state.sidebarCollapsed) {
      return { ...state, sidebarCollapsed: false };
    }

    return {
      ...state,
      sidebarWidthBeforeCollapse: state.sidebarWidth,
      sidebarCollapsed: true,
    };
  })
  .with(setCollapsed, (state, { payload: [collapsed] }) => {
    if (collapsed === state.sidebarCollapsed) {
      return state;
    }

    if (collapsed) {
      return {
        ...state,
        sidebarWidthBeforeCollapse: state.sidebarWidth,
        sidebarCollapsed: true,
      };
    }

    return { ...state, sidebarCollapsed: false };
  })
  .with(loadSidebarState, (state, { payload: [width, collapsed] }) => ({
    ...state,
    sidebarWidth: width,
    sidebarWidthBeforeCollapse: width,
    sidebarCollapsed: collapsed,
  }));