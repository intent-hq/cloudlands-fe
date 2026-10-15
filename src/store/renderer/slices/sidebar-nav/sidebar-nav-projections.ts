import type { SidebarNavState } from './sidebar-nav-types';

export const getMultiSelectSidebarSelectedTabIds = (
  state: { sidebarNav: SidebarNavState },
  workspaceId: string,
): string[] => state.sidebarNav.multiSelectSelectedTabIdsByWorkspaceId[workspaceId] ?? ['overview'];

export const getPinnedWorkspaceIds = (state: { sidebarNav: SidebarNavState }) =>
  state.sidebarNav.pinnedWorkspaceIds;

export const getChiefActiveAgentId = (state: { sidebarNav: SidebarNavState }): string | null =>
  state.sidebarNav.chiefActiveAgentId;

export const getWorkspaceNoteOrder = (
  state: { sidebarNav: SidebarNavState },
  workspaceId: string,
): string[] => state.sidebarNav.noteOrderByWorkspaceId[workspaceId] ?? [];

export const getWorkspaceCollapsedNoteIds = (
  state: { sidebarNav: SidebarNavState },
  workspaceId: string,
): string[] => state.sidebarNav.collapsedNoteIdsByWorkspaceId[workspaceId] ?? [];
