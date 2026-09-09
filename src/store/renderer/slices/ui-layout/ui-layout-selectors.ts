import { store } from '../../store';
import {
  defaultPanelVisibility,
  type PanelVisibilityState,
  type ResizablePanelGroupLayoutState,
} from './ui-layout-slice';

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

export const selectResizablePanelSize = store.createSelector<[key: string], number | undefined>(
  (state, key) => {
    return state.uiLayout.resizablePanelSizes[key];
  },
);

export const selectResizablePanelSizeHydrated = store.createSelector<[key: string], boolean>(
  (state, key) => state.uiLayout.hydratedResizablePanelSizes[key] === true,
);

export const selectResizablePanelGroupLayout = store.createSelector<
  [key: string],
  ResizablePanelGroupLayoutState | undefined
>((state, key) => {
  return state.uiLayout.resizablePanelGroupLayouts[key];
});

export const selectCollapsiblePanelCollapsed = store.createSelector<
  [key: string],
  boolean | undefined
>((state, key) => {
  return state.uiLayout.collapsiblePanelCollapsed[key];
});
