import { faArrowRight, faLayerGroup, faUserPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
import { m } from '$shared/paraglide/messages.js';

export type WorkspaceTabBulkCloseMode = 'others' | 'right';

export interface WorkspaceTabContextMenuOptions {
  order: string[];
  workspaceId: string;
  /** Owner-only: prepends the Share entry (multiplayer w4). */
  canShare: boolean;
  onShare: () => void;
  onClose: () => void;
  onCloseTabs: (workspaceIds: string[], focusWorkspaceId?: string) => void;
}

export function buildWorkspaceTabContextMenu({
  order,
  workspaceId,
  canShare,
  onShare,
  onClose,
  onCloseTabs,
}: WorkspaceTabContextMenuOptions): SidebarMenuEntry[] {
  const closeOthers = getWorkspaceTabBulkCloseIds(order, workspaceId, 'others');
  const closeRight = getWorkspaceTabBulkCloseIds(order, workspaceId, 'right');
  const share: SidebarMenuEntry[] = canShare
    ? [
        { id: 'share', label: m.workspace_share_menu_label(), icon: faUserPlus, onClick: onShare },
        { type: 'separator' },
      ]
    : [];
  return [
    ...share,
    { id: 'close', label: m.layout_panelTabBar_close_label(), icon: faXmark, onClick: onClose },
    { type: 'separator' },
    {
      id: 'close-others',
      label: m.layout_panelTabBar_closeAllOthers_label(),
      icon: faLayerGroup,
      disabled: closeOthers.length === 0,
      onClick: () => onCloseTabs(closeOthers, workspaceId),
    },
    {
      id: 'close-right',
      label: m.layout_panelTabBar_closeTabsToRight_label(),
      icon: faArrowRight,
      disabled: closeRight.length === 0,
      onClick: () => onCloseTabs(closeRight),
    },
  ];
}

export function getWorkspaceTabBulkCloseIds(
  order: string[],
  workspaceId: string,
  mode: WorkspaceTabBulkCloseMode,
): string[] {
  const index = order.indexOf(workspaceId);
  if (index < 0) return [];
  return mode === 'right'
    ? order.slice(index + 1)
    : order.filter((candidate) => candidate !== workspaceId);
}
