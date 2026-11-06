import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
import { store as appStore } from '$store/renderer/store';
import {
  layoutWorkspaceTabsByProject,
  nextWorkspaceTabGroupColor,
} from '$store/renderer/slices/tab-state/tab-groups';
import {
  selectOpenWorkspaceTabGroupId,
  selectWorkspaceTabGroups,
  selectWorkspaceTabGroupsEnabled,
  selectWorkspaceTabOrder,
} from '$store/renderer/slices/tab-state/tab-state-selectors';
import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  addWorkspaceTabToGroup,
  createWorkspaceTabGroup,
  groupWorkspaceTabsByProject,
  removeWorkspaceTabFromGroup,
  setOpenWorkspaceTabGroup,
  ungroupWorkspaceTabGroup,
  updateWorkspaceTabGroup,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import {
  buildWorkspaceTabGroupEntries,
  buildWorkspaceTabGroupMenu,
} from './workspace-tab-group-actions';
import { resolveWorkspaceTabGroupToggle } from './workspace-tab-group-items';
import { resolveWorkspaceTabProjects } from './workspace-tab-projects';

export type WorkspaceTabMenuTarget =
  { kind: 'tab'; workspaceId: string } | { kind: 'group'; groupId: string };

export interface WorkspaceTabGroupControllerDeps {
  getSelectedWorkspaceId: () => string | null | undefined;
  openWorkspace: (workspaceId: string) => void;
  closeWorkspaceTabs: (workspaceIds: string[]) => void;
  setEditingGroupId: (groupId: string | null) => void;
}

/** Tab-strip actions for tab groups: chip clicks, renames and menu entries. */
export function createWorkspaceTabGroupController({
  getSelectedWorkspaceId,
  openWorkspace,
  closeWorkspaceTabs,
  setEditingGroupId,
}: WorkspaceTabGroupControllerDeps) {
  const groups = () => selectWorkspaceTabGroups.select(appStore.state);

  function createGroupForTab(workspaceId: string) {
    const groupId = crypto.randomUUID();
    const color = nextWorkspaceTabGroupColor(groups());
    appStore.dispatch(createWorkspaceTabGroup(workspaceId, groupId, color));
    setEditingGroupId(groupId);
  }

  /** Regroups tabs by project, or undefined when that would change nothing. */
  function groupByProjectAction(): (() => void) | undefined {
    const state = appStore.state;
    const projects = resolveWorkspaceTabProjects(selectWorkspaceItems.select(state));
    const stacks = state.tabState.workspaceStacks;
    const layout = layoutWorkspaceTabsByProject(stacks, groups(), projects);
    const unchanged =
      JSON.stringify(layout.workspaceStacks) === JSON.stringify(stacks) &&
      JSON.stringify(layout.groups.map((group) => [group.id, group.workspaceIds])) ===
        JSON.stringify(groups().map((group) => [group.id, group.workspaceIds]));
    if (layout.groups.length === 0 || unchanged) return undefined;
    return () => appStore.dispatch(groupWorkspaceTabsByProject(projects));
  }

  return {
    /** Opens a collapsed group, or collapses the open one. */
    toggle(groupId: string) {
      const toggle = resolveWorkspaceTabGroupToggle(
        selectWorkspaceTabOrder.select(appStore.state),
        groups(),
        groupId,
        getSelectedWorkspaceId(),
        selectOpenWorkspaceTabGroupId.select(appStore.state),
      );
      if (!toggle) return;
      appStore.dispatch(setOpenWorkspaceTabGroup(toggle.openGroupId));
      if (toggle.selectWorkspaceId) openWorkspace(toggle.selectWorkspaceId);
    },
    /** Saves `name` and leaves rename mode; `null` cancels the rename. */
    finishRename(groupId: string, name: string | null) {
      if (name !== null) appStore.dispatch(updateWorkspaceTabGroup(groupId, { name }));
      setEditingGroupId(null);
    },
    /** True while the tab or group a context menu was opened for still exists. */
    hasMenuTarget(target: WorkspaceTabMenuTarget): boolean {
      return target.kind === 'tab'
        ? selectWorkspaceTabOrder.select(appStore.state).includes(target.workspaceId)
        : groups().some((group) => group.id === target.groupId);
    },
    /** The tab context menu: group entries first, then the tab's own `entries`. */
    tabMenu(workspaceId: string, entries: SidebarMenuEntry[]): SidebarMenuEntry[] {
      if (!selectWorkspaceTabGroupsEnabled.select(appStore.state)) return entries;
      const groupEntries = buildWorkspaceTabGroupEntries({
        groups: groups(),
        workspaceId,
        onCreateGroup: () => createGroupForTab(workspaceId),
        onAddToGroup: (groupId) => appStore.dispatch(addWorkspaceTabToGroup(workspaceId, groupId)),
        onRemoveFromGroup: () => appStore.dispatch(removeWorkspaceTabFromGroup(workspaceId)),
        onGroupByProject: groupByProjectAction(),
      });
      return [...groupEntries, { type: 'separator' }, ...entries];
    },
    groupMenu(groupId: string): SidebarMenuEntry[] {
      const group = groups().find((candidate) => candidate.id === groupId);
      if (!group) return [];
      return buildWorkspaceTabGroupMenu({
        group,
        onRename: () => setEditingGroupId(group.id),
        onSetColor: (color) => appStore.dispatch(updateWorkspaceTabGroup(group.id, { color })),
        onUngroup: () => appStore.dispatch(ungroupWorkspaceTabGroup(group.id)),
        onCloseGroup: () => closeWorkspaceTabs([...group.workspaceIds]),
        onGroupByProject: groupByProjectAction(),
      });
    },
  };
}
