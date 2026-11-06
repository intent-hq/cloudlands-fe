import {
  faFolderPlus,
  faFolderTree,
  faLayerGroup,
  faPalette,
  faPen,
  faRightFromBracket,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
import { m } from '$shared/paraglide/messages.js';
import {
  WORKSPACE_TAB_GROUP_COLORS,
  findWorkspaceTabGroup,
  type WorkspaceTabGroup,
  type WorkspaceTabGroupColor,
} from '$store/renderer/slices/tab-state/tab-groups';
import {
  workspaceTabGroupColorLabel,
  workspaceTabGroupDisplayName,
} from './workspace-tab-group-labels';

export interface WorkspaceTabGroupEntriesOptions {
  groups: readonly WorkspaceTabGroup[];
  workspaceId: string;
  onCreateGroup: () => void;
  onAddToGroup: (groupId: string) => void;
  onRemoveFromGroup: () => void;
  /** Omitted when grouping by project would change nothing. */
  onGroupByProject?: () => void;
}

/** Tab context-menu entries that put a tab into, or take it out of, a group. */
export function buildWorkspaceTabGroupEntries({
  groups,
  workspaceId,
  onCreateGroup,
  onAddToGroup,
  onRemoveFromGroup,
  onGroupByProject,
}: WorkspaceTabGroupEntriesOptions): SidebarMenuEntry[] {
  const currentGroup = findWorkspaceTabGroup(groups, workspaceId);
  const otherGroups = groups.filter((group) => group !== currentGroup);
  const entries: SidebarMenuEntry[] = [
    {
      id: 'tab-group-new',
      label: m.layout_workspaceTabGroup_addToNew_label(),
      icon: faFolderPlus,
      onClick: onCreateGroup,
    },
  ];
  if (otherGroups.length > 0) {
    entries.push({
      id: 'tab-group-add',
      label: m.layout_workspaceTabGroup_addToGroup_label(),
      onClick: () => {},
      submenu: otherGroups.map((group) => ({
        id: `tab-group-add-${group.id}`,
        label: workspaceTabGroupDisplayName(group),
        onClick: () => onAddToGroup(group.id),
      })),
    });
  }
  if (currentGroup) {
    entries.push({
      id: 'tab-group-remove',
      label: m.layout_workspaceTabGroup_remove_label(),
      icon: faRightFromBracket,
      onClick: onRemoveFromGroup,
    });
  }
  if (onGroupByProject) entries.push(groupByProjectEntry(onGroupByProject));
  return entries;
}

function groupByProjectEntry(onClick: () => void): SidebarMenuEntry {
  return {
    id: 'tab-group-by-project',
    label: m.layout_workspaceTabGroup_groupByProject_label(),
    icon: faFolderTree,
    onClick,
  };
}

export interface WorkspaceTabGroupMenuOptions {
  group: WorkspaceTabGroup;
  onRename: () => void;
  onSetColor: (color: WorkspaceTabGroupColor) => void;
  onUngroup: () => void;
  onCloseGroup: () => void;
  /** Omitted when grouping by project would change nothing. */
  onGroupByProject?: () => void;
}

/** Context menu for a group chip. */
export function buildWorkspaceTabGroupMenu({
  group,
  onRename,
  onSetColor,
  onUngroup,
  onCloseGroup,
  onGroupByProject,
}: WorkspaceTabGroupMenuOptions): SidebarMenuEntry[] {
  return [
    {
      id: 'tab-group-rename',
      label: m.layout_workspaceTabGroup_rename_label(),
      icon: faPen,
      onClick: onRename,
    },
    {
      id: 'tab-group-color',
      label: m.layout_workspaceTabGroup_color_label(),
      icon: faPalette,
      onClick: () => {},
      selection: 'single',
      submenu: WORKSPACE_TAB_GROUP_COLORS.map((color) => ({
        id: `tab-group-color-${color}`,
        label: workspaceTabGroupColorLabel(color),
        checked: group.color === color,
        closeOnSelect: true,
        onClick: () => onSetColor(color),
      })),
    },
    { type: 'separator' },
    ...(onGroupByProject ? [groupByProjectEntry(onGroupByProject)] : []),
    {
      id: 'tab-group-ungroup',
      label: m.layout_workspaceTabGroup_ungroup_label(),
      icon: faLayerGroup,
      onClick: onUngroup,
    },
    {
      id: 'tab-group-close',
      label: m.layout_workspaceTabGroup_closeGroup_label(),
      icon: faXmark,
      onClick: onCloseGroup,
    },
  ];
}
