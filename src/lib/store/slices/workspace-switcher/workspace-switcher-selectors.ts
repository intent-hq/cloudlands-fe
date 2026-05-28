import { WorkspaceStatusEnum } from "$shared/types";
import { createSelector } from "../../utils/create-selector";
import {
  selectActiveWorkspaceId,
  selectWorkspacesSortedByRecency,
  selectWorkspaceItems,
} from "../workspace/workspace-selectors";
import type { WorkspaceSwitcherState } from "./workspace-switcher-slice";

export const selectSwitcherState = createSelector((state): WorkspaceSwitcherState => {
  return state.workspaceSwitcher;
});

export const selectSwitcherWorkspaceIds = createSelector((state): string[] => {
  const switcher = state.workspaceSwitcher;
  if (switcher.selectionHandled) {
    return [];
  }

  const activeWorkspaceId = selectActiveWorkspaceId.select(state);
  const activeWorkspaces = selectWorkspaceItems
    .select(state)
    .filter((workspace) => workspace.status !== WorkspaceStatusEnum.Archived);
  const workspacesSortedByRecency = selectWorkspacesSortedByRecency.select(state, activeWorkspaces);
  const currentWorkspace = workspacesSortedByRecency.find(
    (workspace) => workspace.id === activeWorkspaceId,
  );
  const otherWorkspaces = workspacesSortedByRecency.filter(
    (workspace) => workspace.id !== activeWorkspaceId,
  );

  if (otherWorkspaces.length === 0) {
    return [];
  }

  const orderedWorkspaces = currentWorkspace
    ? [currentWorkspace, ...otherWorkspaces]
    : otherWorkspaces;

  return orderedWorkspaces.map((workspace) => workspace.id);
});

export const selectSelectedWorkspaceId = createSelector((state): string | null => {
  const workspaceIds = selectSwitcherWorkspaceIds.select(state);
  const { selectedIndex } = state.workspaceSwitcher;
  return workspaceIds[selectedIndex] ?? null;
});