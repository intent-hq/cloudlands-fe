import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createBooleanPreference } from "../../utils/boolean-preference";

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

const lineWrappingPreference = createBooleanPreference<UiLayoutState>({
  sliceName: "uiLayout",
  field: "lineWrapping",
  setActionName: "setLineWrapping",
  toggleActionName: "toggleLineWrapping",
});

const foldUnchangedPreference = createBooleanPreference<UiLayoutState>({
  sliceName: "uiLayout",
  field: "foldUnchanged",
  setActionName: "setFoldUnchanged",
  toggleActionName: "toggleFoldUnchanged",
});

const diffSideBySidePreference = createBooleanPreference<UiLayoutState>({
  sliceName: "uiLayout",
  field: "diffSideBySide",
  setActionName: "setDiffSideBySide",
  toggleActionName: "toggleDiffSideBySide",
});

const diffIndicatorsPreference = createBooleanPreference<UiLayoutState>({
  sliceName: "uiLayout",
  field: "diffIndicators",
  setActionName: "setDiffIndicators",
  toggleActionName: "toggleDiffIndicators",
});

export const setLineWrapping = lineWrappingPreference.setAction;
export const setFoldUnchanged = foldUnchangedPreference.setAction;
export const setDiffSideBySide = diffSideBySidePreference.setAction;
export const setDiffIndicators = diffIndicatorsPreference.setAction;

export const toggleLineWrapping = lineWrappingPreference.toggleAction;
export const toggleFoldUnchanged = foldUnchangedPreference.toggleAction;
export const toggleDiffSideBySide = diffSideBySidePreference.toggleAction;
export const toggleDiffIndicators = diffIndicatorsPreference.toggleAction;

export const loadEditorSettings = createAction<[settings: EditorSettingsFields]>(
  "uiLayout/loadEditorSettings"
);

export const setWidth = createAction<[pixels: number]>("uiLayout/setWidth");
export const toggleSidebar = createAction("uiLayout/toggleSidebar");
export const setCollapsed = createAction<[collapsed: boolean]>("uiLayout/setCollapsed");
export const loadSidebarState = createAction<[width: number, collapsed: boolean]>(
  "uiLayout/loadSidebarState"
);

export const uiLayoutReducer = diffIndicatorsPreference.register(
  diffSideBySidePreference.register(
    foldUnchangedPreference.register(
      lineWrappingPreference.register(createReducer<UiLayoutState>(initialState))
    )
  )
)
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