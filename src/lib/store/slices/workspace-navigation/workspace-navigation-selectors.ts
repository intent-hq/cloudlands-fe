import { createSelector } from "../../utils/create-selector";
import {
  createWorkspaceNavigationState,
  type WorkspaceNavigationDrawerState,
  type WorkspaceNavigationMainPanelState,
  type WorkspaceNavigationNavigationState,
  type WorkspaceNavigationWorkspaceState,
} from "./workspace-navigation-slice";

export const selectWorkspaceNavigationState = createSelector<
  [wsId: string],
  WorkspaceNavigationWorkspaceState
>((state, wsId) => {
  return state.workspaceNavigation.byWorkspaceId[wsId] ?? createWorkspaceNavigationState(wsId);
});

export const selectWorkspaceNavigationMainPanel = createSelector<
  [wsId: string],
  WorkspaceNavigationMainPanelState
>((state, wsId) => {
  return selectWorkspaceNavigationState.select(state, wsId).mainPanel;
});

export const selectWorkspaceNavigationDrawer = createSelector<
  [wsId: string],
  WorkspaceNavigationDrawerState
>((state, wsId) => {
  return selectWorkspaceNavigationState.select(state, wsId).drawer;
});

export const selectWorkspaceNavigationHistory = createSelector<
  [wsId: string],
  WorkspaceNavigationNavigationState
>((state, wsId) => {
  return selectWorkspaceNavigationState.select(state, wsId).navigation;
});
