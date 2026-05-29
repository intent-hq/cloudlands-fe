import { store } from "../../store";
import {
  defaultPanelVisibility,
  type PanelVisibilityState,
  type DockViewMode,
  type ResizablePanelGroupLayoutState,
  type WorkspaceSidebarPanelLayoutState,
} from "./ui-layout-slice";

export const selectLineWrapping = store.createSelector((state) => {
  return state.uiLayout.lineWrapping;
});

export const selectFoldUnchanged = store.createSelector((state) => {
  return state.uiLayout.foldUnchanged;
});

export const selectDiffSideBySide = store.createSelector((state) => {
  return state.uiLayout.diffSideBySide;
});

export const selectDiffIndicators = store.createSelector((state) => {
  return state.uiLayout.diffIndicators;
});

export const selectSidebarWidth = store.createSelector((state) => {
  return state.uiLayout.sidebarWidth;
});

export const selectSidebarExpandedWidth = store.createSelector((state) => {
  return state.uiLayout.sidebarExpandedWidth;
});

export const selectIsCollapsed = store.createSelector((state) => {
  return state.uiLayout.sidebarCollapsed;
});

export const selectWidthBeforeCollapse = store.createSelector((state) => {
  return state.uiLayout.sidebarWidthBeforeCollapse;
});

export const selectEffectiveWidth = store.createSelector((state) => {
  return state.uiLayout.sidebarCollapsed ? 0 : state.uiLayout.sidebarWidth;
});

export const selectPanelVisibilityFlag = store.createSelector<
  [wsId: string, key: keyof PanelVisibilityState],
  boolean
>((state, wsId, key) => {
  const visibility = state.uiLayout.panelVisibility.byWorkspaceId[wsId];
  return visibility ? visibility[key] : defaultPanelVisibility[key];
});

// Layout settings selectors
export const selectSpacesSidebarWidth = store.createSelector((state) => {
  return state.uiLayout.spacesSidebarWidth;
});

export const selectSpacesSidebarCollapsed = store.createSelector((state) => {
  return state.uiLayout.spacesSidebarCollapsed;
});

export const selectTabbedSidebarPinned = store.createSelector((state) => {
  return state.uiLayout.tabbedSidebarPinned;
});

export const selectSidebarSide = store.createSelector((state) => {
  return state.uiLayout.sidebarSide;
});

// Bottom dock selectors
export const selectBottomDockIsExpanded = store.createSelector((state) => {
  return state.uiLayout.bottomDock.isExpanded;
});

export const selectBottomDockViewMode = store.createSelector<[], DockViewMode>((state) => {
  return state.uiLayout.bottomDock.viewMode;
});

export const selectBottomDockActiveTerminalId = store.createSelector<[], string | null>((state) => {
  return state.uiLayout.bottomDock.activeTerminalId;
});

export const selectBottomDockHeight = store.createSelector((state) => {
  return state.uiLayout.bottomDock.height;
});

export const selectResizablePanelSize = store.createSelector<[key: string], number | undefined>((state, key) => {
  return state.uiLayout.resizablePanelSizes[key];
});

export const selectResizablePanelGroupLayout = store.createSelector<[
  key: string,
], ResizablePanelGroupLayoutState | undefined>((state, key) => {
  return state.uiLayout.resizablePanelGroupLayouts[key];
});

export const selectCollapsiblePanelCollapsed = store.createSelector<[key: string], boolean | undefined>((state, key) => {
  return state.uiLayout.collapsiblePanelCollapsed[key];
});

export const selectWorkspaceSidebarPanelLayout = store.createSelector<[], WorkspaceSidebarPanelLayoutState>((state) => {
  return state.uiLayout.workspaceSidebarPanelLayout;
});