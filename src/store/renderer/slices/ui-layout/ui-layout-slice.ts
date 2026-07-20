import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import { createBooleanPreference } from "$lib/store-shim/utils/store/boolean-preference";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";

export const DEFAULT_WIDTH = 350;
export const DEFAULT_EXPANDED_WIDTH = 600;
export const MIN_WIDTH = 180;
export const MAX_WIDTH = 800;

// Bottom dock constants
export type DockViewMode = 'agents' | 'terminal';

export const DEFAULT_DOCK_HEIGHT = 400;
export const MIN_DOCK_HEIGHT = 200;
export const MAX_DOCK_HEIGHT = 800;

export interface PanelVisibilityState {
  showNavigationRail: boolean;
  showNotesPanel: boolean;
  showCodeChangesPanel: boolean;
  showFilesPanel: boolean;
  showActivityLogPanel: boolean;
  showWorkspaceDock: boolean;
  showAgentNavRail: boolean;
  showTerminalNavRail: boolean;
  showMainContent: boolean;
  showChatHeader: boolean;
  isChatFocusedMode: boolean;
}

export const defaultPanelVisibility: PanelVisibilityState = {
  showNavigationRail: true,
  showNotesPanel: true,
  showCodeChangesPanel: true,
  showFilesPanel: true,
  showActivityLogPanel: true,
  showWorkspaceDock: true,
  showAgentNavRail: true,
  showTerminalNavRail: true,
  showMainContent: true,
  showChatHeader: true,
  isChatFocusedMode: false,
};

export type SidebarSide = 'left' | 'right';

export interface BottomDockState {
  isExpanded: boolean;
  viewMode: DockViewMode;
  activeTerminalId: string | null;
  height: number;
}

export interface ResizablePanelGroupLayoutState {
  sizes: number[];
  collapsed: string[];
}

export interface WorkspaceSidebarPanelLayoutState {
  collapsed: Record<string, boolean>;
  heights: Record<string, number>;
}

export const defaultWorkspaceSidebarPanelLayout: WorkspaceSidebarPanelLayoutState = {
  collapsed: {
    notes: false,
    "source-control": false,
    explorer: false,
    activity: true,
  },
  heights: {},
};

export const defaultBottomDockState: BottomDockState = {
  isExpanded: false,
  viewMode: 'agents',
  activeTerminalId: null,
  height: DEFAULT_DOCK_HEIGHT,
};

export type UiLayoutState = {
  lineWrapping: boolean;
  foldUnchanged: boolean;
  diffSideBySide: boolean;
  diffIndicators: boolean;
  sidebarWidth: number;
  sidebarExpandedWidth: number;
  sidebarWidthBeforeCollapse: number;
  sidebarCollapsed: boolean;
  panelVisibility: {
    byWorkspaceId: Record<string, PanelVisibilityState>;
  };
  // Layout settings (migrated from layout-settings.svelte.ts)
  spacesSidebarWidth: number;
  spacesSidebarCollapsed: boolean;
  tabbedSidebarPinned: boolean;
  sidebarSide: SidebarSide;
  bottomDock: BottomDockState;
  resizablePanelSizes: Record<string, number>;
  resizablePanelGroupLayouts: Record<string, ResizablePanelGroupLayoutState>;
  collapsiblePanelCollapsed: Record<string, boolean>;
  workspaceSidebarPanelLayout: WorkspaceSidebarPanelLayoutState;
};

type EditorSettingsFields = Pick<
  UiLayoutState,
  "lineWrapping" | "foldUnchanged" | "diffSideBySide" | "diffIndicators"
>;

export const SPACES_SIDEBAR_DEFAULT_WIDTH = 200;

export const initialState: UiLayoutState = {
  lineWrapping: true,
  foldUnchanged: true,
  diffSideBySide: true,
  diffIndicators: true,
  sidebarWidth: DEFAULT_WIDTH,
  sidebarExpandedWidth: DEFAULT_EXPANDED_WIDTH,
  sidebarWidthBeforeCollapse: DEFAULT_WIDTH,
  sidebarCollapsed: false,
  panelVisibility: {
    byWorkspaceId: {},
  },
  spacesSidebarWidth: SPACES_SIDEBAR_DEFAULT_WIDTH,
  spacesSidebarCollapsed: false,
  tabbedSidebarPinned: true,
  sidebarSide: 'left',
  bottomDock: { ...defaultBottomDockState },
  resizablePanelSizes: {},
  resizablePanelGroupLayouts: {},
  collapsiblePanelCollapsed: {},
  workspaceSidebarPanelLayout: { ...defaultWorkspaceSidebarPanelLayout },
};

const {
  getWorkspaceState: getPanelVisibility,
  setWorkspaceState: setPanelVisibilityState,
  clearWorkspaceState: clearPanelVisibilityState,
} = createWorkspaceScopedHelpers(defaultPanelVisibility);

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

const spacesSidebarCollapsedPreference = createBooleanPreference<UiLayoutState>({
  sliceName: "uiLayout",
  field: "spacesSidebarCollapsed",
  setActionName: "setSpacesSidebarCollapsed",
  toggleActionName: "toggleSpacesSidebarCollapsed",
});

const tabbedSidebarPinnedPreference = createBooleanPreference<UiLayoutState>({
  sliceName: "uiLayout",
  field: "tabbedSidebarPinned",
  setActionName: "setTabbedSidebarPinned",
  toggleActionName: "toggleTabbedSidebarPinned",
});

export const setLineWrapping = lineWrappingPreference.setAction;
export const setFoldUnchanged = foldUnchangedPreference.setAction;
export const setDiffSideBySide = diffSideBySidePreference.setAction;
export const setDiffIndicators = diffIndicatorsPreference.setAction;

export const toggleLineWrapping = lineWrappingPreference.toggleAction;
export const toggleFoldUnchanged = foldUnchangedPreference.toggleAction;
export const toggleDiffSideBySide = diffSideBySidePreference.toggleAction;
export const toggleDiffIndicators = diffIndicatorsPreference.toggleAction;

export const setSpacesSidebarCollapsed = spacesSidebarCollapsedPreference.setAction;
export const toggleSpacesSidebarCollapsed = spacesSidebarCollapsedPreference.toggleAction;
export const setTabbedSidebarPinned = tabbedSidebarPinnedPreference.setAction;
export const toggleTabbedSidebarPinned = tabbedSidebarPinnedPreference.toggleAction;

export const setSpacesSidebarWidth = createAction<[pixels: number]>("uiLayout/setSpacesSidebarWidth");
export const setSidebarSide = createAction<[side: SidebarSide]>("uiLayout/setSidebarSide");
export const toggleSidebarSide = createAction("uiLayout/toggleSidebarSide");

export const loadLayoutSettings = createAction<[settings: {
  spacesSidebarWidth: number;
  spacesSidebarCollapsed: boolean;
  tabbedSidebarPinned: boolean;
  sidebarSide: SidebarSide;
}]>("uiLayout/loadLayoutSettings");

export const resetLayoutSettings = createAction("uiLayout/resetLayoutSettings");

// Bottom dock actions
export const toggleBottomDock = createAction("uiLayout/toggleBottomDock");
export const expandBottomDock = createAction("uiLayout/expandBottomDock");
export const collapseBottomDock = createAction("uiLayout/collapseBottomDock");
export const setBottomDockViewMode = createAction<[mode: DockViewMode]>("uiLayout/setBottomDockViewMode");
export const selectBottomDockTerminal = createAction<[terminalId: string]>("uiLayout/selectBottomDockTerminal");
export const showBottomDockAgents = createAction("uiLayout/showBottomDockAgents");
export const setBottomDockHeight = createAction<[height: number]>("uiLayout/setBottomDockHeight");
export const loadBottomDockState = createAction<[state: Omit<BottomDockState, 'isExpanded'>]>("uiLayout/loadBottomDockState");

export const loadEditorSettings = createAction<[settings: EditorSettingsFields]>(
  "uiLayout/loadEditorSettings"
);

export const setWidth = createAction<[pixels: number]>("uiLayout/setWidth");
export const setSidebarExpandedWidth = createAction<[pixels: number]>("uiLayout/setSidebarExpandedWidth");
export const toggleSidebar = createAction("uiLayout/toggleSidebar");
export const setCollapsed = createAction<[collapsed: boolean]>("uiLayout/setCollapsed");
export const setPanelVisibility = createAction<
  [wsId: string, key: keyof PanelVisibilityState, value: boolean]
>("uiLayout/setPanelVisibility");
export const setPanelVisibilityBulk = createAction<
  [wsId: string, updates: Partial<PanelVisibilityState>]
>("uiLayout/setPanelVisibilityBulk");
export const loadSidebarState = createAction<[width: number, collapsed: boolean, expandedWidth?: number]>(
  "uiLayout/loadSidebarState"
);
export const requestResizablePanelSize = createAction<[key: string]>("uiLayout/requestResizablePanelSize");
export const hydrateResizablePanelSize = createAction<[key: string, value: number]>("uiLayout/hydrateResizablePanelSize");
export const setResizablePanelSize = createAction<[key: string, value: number]>("uiLayout/setResizablePanelSize");
export const requestResizablePanelGroupLayout = createAction<[key: string]>("uiLayout/requestResizablePanelGroupLayout");
export const hydrateResizablePanelGroupLayout = createAction<[
  key: string,
  layout: ResizablePanelGroupLayoutState,
]>("uiLayout/hydrateResizablePanelGroupLayout");
export const setResizablePanelGroupLayout = createAction<[
  key: string,
  layout: ResizablePanelGroupLayoutState,
]>("uiLayout/setResizablePanelGroupLayout");
export const requestCollapsiblePanelCollapsed = createAction<[key: string]>("uiLayout/requestCollapsiblePanelCollapsed");
export const hydrateCollapsiblePanelCollapsed = createAction<[key: string, collapsed: boolean]>(
  "uiLayout/hydrateCollapsiblePanelCollapsed"
);
export const setCollapsiblePanelCollapsed = createAction<[key: string, collapsed: boolean]>(
  "uiLayout/setCollapsiblePanelCollapsed"
);
export const loadWorkspaceSidebarPanelLayout = createAction<[layout: WorkspaceSidebarPanelLayoutState]>(
  "uiLayout/loadWorkspaceSidebarPanelLayout"
);
export const setWorkspaceSidebarPanelLayout = createAction<[layout: WorkspaceSidebarPanelLayoutState]>(
  "uiLayout/setWorkspaceSidebarPanelLayout"
);

export const uiLayoutReducer = tabbedSidebarPinnedPreference.register(
  spacesSidebarCollapsedPreference.register(
    diffIndicatorsPreference.register(
      diffSideBySidePreference.register(
        foldUnchangedPreference.register(
          lineWrappingPreference.register(createReducer<UiLayoutState>(initialState))
        )
      )
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
  .with(setSidebarExpandedWidth, (state, { payload: [pixels] }) => {
    const newWidth = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, pixels)));
    if (newWidth === state.sidebarExpandedWidth) return state;
    return { ...state, sidebarExpandedWidth: newWidth };
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
  .with(setPanelVisibility, (state, { payload: [wsId, key, value] }) => {
    const current = getPanelVisibility(state.panelVisibility, wsId);
    if (current[key] === value) return state;

    return {
      ...state,
      panelVisibility: setPanelVisibilityState(state.panelVisibility, wsId, {
        ...current,
        [key]: value,
      }),
    };
  })
  .with(setPanelVisibilityBulk, (state, { payload: [wsId, updates] }) => {
    const current = getPanelVisibility(state.panelVisibility, wsId);
    let changed = false;
    const updated = { ...current };

    for (const key of Object.keys(updates) as (keyof PanelVisibilityState)[]) {
      const value = updates[key];
      if (value !== undefined && current[key] !== value) {
        updated[key] = value;
        changed = true;
      }
    }

    if (!changed) return state;

    return {
      ...state,
      panelVisibility: setPanelVisibilityState(state.panelVisibility, wsId, updated),
    };
  })
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => {
    const next = clearPanelVisibilityState(state.panelVisibility, wsId);
    if (next === state.panelVisibility) return state;
    return { ...state, panelVisibility: next };
  })
  .with(loadSidebarState, (state, { payload: [width, collapsed, expandedWidth] }) => ({
    ...state,
    sidebarWidth: width,
    sidebarExpandedWidth: expandedWidth ?? state.sidebarExpandedWidth,
    sidebarWidthBeforeCollapse: width,
    sidebarCollapsed: collapsed,
  }))
  .with(hydrateResizablePanelSize, (state, { payload: [key, value] }) => ({
    ...state,
    resizablePanelSizes: { ...state.resizablePanelSizes, [key]: value },
  }))
  .with(setResizablePanelSize, (state, { payload: [key, value] }) => ({
    ...state,
    resizablePanelSizes: { ...state.resizablePanelSizes, [key]: value },
  }))
  .with(hydrateResizablePanelGroupLayout, (state, { payload: [key, layout] }) => ({
    ...state,
    resizablePanelGroupLayouts: { ...state.resizablePanelGroupLayouts, [key]: layout },
  }))
  .with(setResizablePanelGroupLayout, (state, { payload: [key, layout] }) => ({
    ...state,
    resizablePanelGroupLayouts: { ...state.resizablePanelGroupLayouts, [key]: layout },
  }))
  .with(hydrateCollapsiblePanelCollapsed, (state, { payload: [key, collapsed] }) => ({
    ...state,
    collapsiblePanelCollapsed: { ...state.collapsiblePanelCollapsed, [key]: collapsed },
  }))
  .with(setCollapsiblePanelCollapsed, (state, { payload: [key, collapsed] }) => ({
    ...state,
    collapsiblePanelCollapsed: { ...state.collapsiblePanelCollapsed, [key]: collapsed },
  }))
  .with(loadWorkspaceSidebarPanelLayout, (state, { payload: [layout] }) => ({
    ...state,
    workspaceSidebarPanelLayout: layout,
  }))
  .with(setWorkspaceSidebarPanelLayout, (state, { payload: [layout] }) => ({
    ...state,
    workspaceSidebarPanelLayout: layout,
  }))
  .with(setSpacesSidebarWidth, (state, { payload: [pixels] }) => {
    if (pixels === state.spacesSidebarWidth) return state;
    return { ...state, spacesSidebarWidth: pixels };
  })
  .with(setSidebarSide, (state, { payload: [side] }) => {
    if (side === state.sidebarSide) return state;
    return { ...state, sidebarSide: side };
  })
  .with(toggleSidebarSide, (state) => ({
    ...state,
    sidebarSide: state.sidebarSide === 'left' ? 'right' : 'left',
  }))
  .with(loadLayoutSettings, (state, { payload: [settings] }) => ({
    ...state,
    ...settings,
  }))
  .with(resetLayoutSettings, (state) => ({
    ...state,
    spacesSidebarWidth: SPACES_SIDEBAR_DEFAULT_WIDTH,
    spacesSidebarCollapsed: false,
    tabbedSidebarPinned: true,
    sidebarSide: 'left' as SidebarSide,
  }))
  // Bottom dock reducers
  .with(toggleBottomDock, (state) => ({
    ...state,
    bottomDock: { ...state.bottomDock, isExpanded: !state.bottomDock.isExpanded },
  }))
  .with(expandBottomDock, (state) => {
    if (state.bottomDock.isExpanded) return state;
    return { ...state, bottomDock: { ...state.bottomDock, isExpanded: true } };
  })
  .with(collapseBottomDock, (state) => {
    if (!state.bottomDock.isExpanded) return state;
    return { ...state, bottomDock: { ...state.bottomDock, isExpanded: false } };
  })
  .with(setBottomDockViewMode, (state, { payload: [mode] }) => {
    if (mode === state.bottomDock.viewMode) return state;
    return { ...state, bottomDock: { ...state.bottomDock, viewMode: mode } };
  })
  .with(selectBottomDockTerminal, (state, { payload: [terminalId] }) => ({
    ...state,
    bottomDock: {
      ...state.bottomDock,
      activeTerminalId: terminalId,
      viewMode: 'terminal' as DockViewMode,
      isExpanded: true,
    },
  }))
  .with(showBottomDockAgents, (state) => ({
    ...state,
    bottomDock: {
      ...state.bottomDock,
      viewMode: 'agents' as DockViewMode,
      isExpanded: true,
    },
  }))
  .with(setBottomDockHeight, (state, { payload: [height] }) => {
    const clamped = Math.max(MIN_DOCK_HEIGHT, Math.min(MAX_DOCK_HEIGHT, height));
    if (clamped === state.bottomDock.height) return state;
    return { ...state, bottomDock: { ...state.bottomDock, height: clamped } };
  })
  .with(loadBottomDockState, (state, { payload: [loaded] }) => ({
    ...state,
    bottomDock: {
      // Always start collapsed on load
      isExpanded: false,
      viewMode: loaded.viewMode ?? 'agents',
      activeTerminalId: loaded.activeTerminalId ?? null,
      height: loaded.height ?? DEFAULT_DOCK_HEIGHT,
    },
  }));