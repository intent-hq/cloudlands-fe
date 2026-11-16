import {
  faFolderPlus,
  faFolderTree,
  faLayerGroup,
  faPen,
  faRightFromBracket,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
import { m } from '$shared/paraglide/messages.js';
import {
  findWorkspaceTabGroup,
  type WorkspaceTabGroup,
  type WorkspaceTabGroupColor,
} from '$store/renderer/slices/tab-state/tab-groups';
import {
  workspaceTabGroupColorLabel,
  workspaceTabGroupColorValue,
  workspaceTabGroupDisplayName,
} from './workspace-tab-group-labels';

const PICKER_COLORS = [
  'blue',
  'lightBlue',
  'turquoise',
  'green',
  'lightGreen',
  'yellow',
  'purple',
  'pink',
  'beige',
  'orange',
  'red',
  'grey',
] as const satisfies readonly WorkspaceTabGroupColor[];

/** Group by project; without `run` the entry shows disabled because nothing would change. */
export interface WorkspaceTabGroupByProject {
  run?: () => void;
}

export interface WorkspaceTabGroupEntriesOptions {
  groups: readonly WorkspaceTabGroup[];
  workspaceId: string;
  onCreateGroup: () => void;
  onAddToGroup: (groupId: string) => void;
  onRemoveFromGroup: () => void;
  groupByProject?: WorkspaceTabGroupByProject;
}

/** Tab context-menu entries that put a tab into, or take it out of, a group. */
export function buildWorkspaceTabGroupEntries({
  groups,
  workspaceId,
  onCreateGroup,
  onAddToGroup,
  onRemoveFromGroup,
  groupByProject,
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
  if (groupByProject) entries.push(groupByProjectEntry(groupByProject));
  return entries;
}

function groupByProjectEntry({ run }: WorkspaceTabGroupByProject): SidebarMenuEntry {
  return {
    id: 'tab-group-by-project',
    label: m.layout_workspaceTabGroup_groupByProject_label(),
    icon: faFolderTree,
    onClick: run ?? (() => {}),
    disabled: !run,
  };
}

export interface WorkspaceTabGroupMenuOptions {
  group: WorkspaceTabGroup;
  onRename: () => void;
  onSetColor: (color: WorkspaceTabGroupColor) => void;
  onUngroup: () => void;
  onCloseGroup: () => void;
  groupByProject?: WorkspaceTabGroupByProject;
}

/** Context menu for a group chip. */
export function buildWorkspaceTabGroupMenu({
  group,
  onRename,
  onSetColor,
  onUngroup,
  onCloseGroup,
  groupByProject,
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
      onClick: () => {},
      selection: 'single',
      presentation: 'swatches',
      submenu: PICKER_COLORS.map((color) => ({
        id: `tab-group-color-${color}`,
        label: workspaceTabGroupColorLabel(color),
        swatch: workspaceTabGroupColorValue(color),
        checked: group.color === color,
        closeOnSelect: true,
        onClick: () => onSetColor(color),
      })),
    },
    { type: 'separator' },
    ...(groupByProject ? [groupByProjectEntry(groupByProject)] : []),
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
