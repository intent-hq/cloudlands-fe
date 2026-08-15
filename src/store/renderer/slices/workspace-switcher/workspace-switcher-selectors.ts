import { WorkspaceStatusEnum } from '$shared/types';
import { store } from '../../store';
import {
  selectWorkspaceItems,
  selectWorkspacesSortedByRecency,
} from '../workspace/workspace-selectors';
import type { WorkspaceSwitcherState } from './workspace-switcher-slice';

export const selectSwitcherState = store.createSelector((state): WorkspaceSwitcherState => {
  return state.workspaceSwitcher;
});

export const selectSwitcherWorkspaceIds = store.createSelector<
  [activeWorkspaceId: string | null],
  string[]
>((state, activeWorkspaceId) => {
  if (state.workspaceSwitcher.selectionHandled) return [];
  const activeWorkspaces = selectWorkspaceItems
    .select(state)
    .filter((workspace) => workspace.status !== WorkspaceStatusEnum.Archived);
  const sorted = selectWorkspacesSortedByRecency.select(state, activeWorkspaces);
  const current = sorted.find((workspace) => workspace.id === activeWorkspaceId);
  const others = sorted.filter((workspace) => workspace.id !== activeWorkspaceId);
  if (others.length === 0) return [];
  return (current ? [current, ...others] : others).map((workspace) => workspace.id);
});

export const selectSelectedWorkspaceId = store.createSelector<
  [activeWorkspaceId: string | null],
  string | null
>(
  (state, activeWorkspaceId) =>
    selectSwitcherWorkspaceIds.select(state, activeWorkspaceId)[
      state.workspaceSwitcher.selectedIndex
    ] ?? null,
);
