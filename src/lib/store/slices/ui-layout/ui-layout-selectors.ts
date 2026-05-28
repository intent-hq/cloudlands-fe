import { createSelector } from "../../utils/create-selector";
import {
  defaultPanelVisibility,
  type PanelVisibilityState,
  type DockViewMode,
  type ResizablePanelGroupLayoutState,
  type WorkspaceSidebarPanelLayoutState,
} from "./ui-layout-slice";

export const selectLineWrapping = createSelector((state) => {
  return state.uiLayout.lineWrapping;
});

export const selectFoldUnchanged = createSelector((state) => {
  return state.uiLayout.foldUnchanged;
});

export const selectDiffSideBySide = createSelector((state) => {
  return state.uiLayout.diffSideBySide;
});

export const selectDiffIndicators = createSelector((state) => {
  return state.uiLayout.diffIndicators;
});

export const selectSidebarWidth = createSelector((state) => {
  return state.uiLayout.sidebarWidth;
});

export const selectSidebarExpandedWidth = createSelector((state) => {
  return state.uiLayout.sidebarExpandedWidth;
});

export const selectIsCollapsed = createSelector((state) => {
  return state.uiLayout.sidebarCollapsed;
});

export const selectWidthBeforeCollapse = createSelector((state) => {
  return state.uiLayout.sidebarWidthBeforeCollapse;
});

export const selectEffectiveWidth = createSelector((state) => {
  return state.uiLayout.sidebarCollapsed ? 0 : state.uiLayout.sidebarWidth;
});

export const selectPanelVisibilityFlag = createSelector<
  [wsId: string, key: keyof PanelVisibilityState],
  boolean
>((state, wsId, key) => {
  const visibility = state.uiLayout.panelVisibility.byWorkspaceId[wsId];
  return visibility ? visibility[key] : defaultPanelVisibility[key];
});

// Layout settings selectors
export const selectSpacesSidebarWidth = createSelector((state) => {
  return state.uiLayout.spacesSidebarWidth;
});

export const selectSpacesSidebarCollapsed = createSelector((state) => {
  return state.uiLayout.spacesSidebarCollapsed;
});

export const selectTabbedSidebarPinned = createSelector((state) => {
  return state.uiLayout.tabbedSidebarPinned;
});

export const selectSidebarSide = createSelector((state) => {
  return state.uiLayout.sidebarSide;
});

// Bottom dock selectors
export const selectBottomDockIsExpanded = createSelector((state) => {
  return state.uiLayout.bottomDock.isExpanded;
});

export const selectBottomDockViewMode = createSelector<[], DockViewMode>((state) => {
  return state.uiLayout.bottomDock.viewMode;
});

export const selectBottomDockActiveTerminalId = createSelector<[], string | null>((state) => {
  return state.uiLayout.bottomDock.activeTerminalId;
});

export const selectBottomDockHeight = createSelector((state) => {
  return state.uiLayout.bottomDock.height;
});

export const selectResizablePanelSize = createSelector<[key: string], number | undefined>((state, key) => {
  return state.uiLayout.resizablePanelSizes[key];
});

export const selectResizablePanelGroupLayout = createSelector<[
  key: string,
], ResizablePanelGroupLayoutState | undefined>((state, key) => {
  return state.uiLayout.resizablePanelGroupLayouts[key];
});

export const selectCollapsiblePanelCollapsed = createSelector<[key: string], boolean | undefined>((state, key) => {
  return state.uiLayout.collapsiblePanelCollapsed[key];
});

export const selectWorkspaceSidebarPanelLayout = createSelector<[], WorkspaceSidebarPanelLayoutState>((state) => {
  return state.uiLayout.workspaceSidebarPanelLayout;
});