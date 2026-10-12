import type { SidebarNavState } from './sidebar-nav-types';

export const getMultiSelectSidebarSelectedTabIds = (
  state: { sidebarNav: SidebarNavState },
  workspaceId: string,
): string[] => state.sidebarNav.multiSelectSelectedTabIdsByWorkspaceId[workspaceId] ?? ['overview'];
