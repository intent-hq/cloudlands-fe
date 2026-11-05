import {
  applyWorkspaceTabMove,
  findWorkspaceTabGroup,
  resolveMovedWorkspaceTabGroups,
  type WorkspaceTabGroup,
} from '$store/renderer/slices/tab-state/tab-groups';
import {
  getReleasedWorkspaceTabMove,
  proposeWorkspaceTabOrder,
} from '$lib/components/workspace/utils/workspace-tab-drag';

/** Where a tab sits inside the outline of the open group. */
export type WorkspaceTabGroupEdge = 'middle' | 'end';

export type WorkspaceTabStripItem =
  | {
      kind: 'tab';
      key: string;
      workspaceId: string;
      group?: { id: string; color: WorkspaceTabGroup['color']; edge: WorkspaceTabGroupEdge };
      /** In a collapsed group: kept in the strip at zero width so the change can animate. */
      hidden: boolean;
    }
  | { kind: 'group'; key: string; group: WorkspaceTabGroup; open: boolean };

export const workspaceTabGroupItemKey = (groupId: string) => `tab-group:${groupId}`;

/**
 * Lays out the strip: each group gets a header chip before its first tab.
 * Only `openGroupId` shows its tabs; the tabs of every other group are marked
 * hidden behind their chip.
 */
export function buildWorkspaceTabStripItems(
  order: readonly string[],
  groups: readonly WorkspaceTabGroup[],
  openGroupId: string | null | undefined,
): WorkspaceTabStripItem[] {
  const openGroup = groups.find((group) => group.id === openGroupId);
  const items: WorkspaceTabStripItem[] = [];
  const placedGroups = new Set<string>();
  for (const workspaceId of order) {
    const group = findWorkspaceTabGroup(groups, workspaceId);
    if (group && !placedGroups.has(group.id)) {
      placedGroups.add(group.id);
      items.push({
        kind: 'group',
        key: workspaceTabGroupItemKey(group.id),
        group,
        open: group === openGroup,
      });
    }
    items.push({
      kind: 'tab',
      key: workspaceId,
      workspaceId,
      group: group
        ? {
            id: group.id,
            color: group.color,
            edge: group.workspaceIds.at(-1) === workspaceId ? 'end' : 'middle',
          }
        : undefined,
      hidden: group !== undefined && group !== openGroup,
    });
  }
  return items;
}

export interface WorkspaceTabGroupToggle {
  openGroupId: string | null;
  /** Tab to select so the current tab is never hidden; null keeps the selection. */
  selectWorkspaceId: string | null;
}

/**
 * What a click on a group chip does. A collapsed group opens; it selects its
 * last selected tab only when the current tab sits in the group that will
 * collapse. The open group collapses; when it holds the current tab, the
 * nearest tab outside it is selected, and with no such tab nothing happens.
 */
export function resolveWorkspaceTabGroupToggle(
  order: readonly string[],
  groups: readonly WorkspaceTabGroup[],
  groupId: string,
  currentTabId: string | null | undefined,
  openGroupId: string | null,
): WorkspaceTabGroupToggle | null {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) return null;
  const currentGroup = findWorkspaceTabGroup(groups, currentTabId);
  if (openGroupId !== groupId) {
    const hidesCurrent = currentGroup !== undefined && currentGroup !== group;
    return {
      openGroupId: groupId,
      selectWorkspaceId: hidesCurrent
        ? (group.lastActiveWorkspaceId ?? group.workspaceIds[0] ?? null)
        : null,
    };
  }
  if (currentGroup !== group) return { openGroupId: null, selectWorkspaceId: null };
  const members = new Set(group.workspaceIds);
  const firstIndex = order.findIndex((id) => members.has(id));
  const after = order.slice(firstIndex).find((id) => !members.has(id));
  const before = order
    .slice(0, firstIndex)
    .reverse()
    .find((id) => !members.has(id));
  const outside = after ?? before;
  return outside ? { openGroupId: null, selectWorkspaceId: outside } : null;
}

/**
 * Strip items for the rendered order. The open group is fixed for the drag,
 * so a dragged tab never collapses its group mid-drag; membership follows the
 * proposed drop position.
 */
export function layoutWorkspaceTabStrip(
  order: readonly string[],
  groups: readonly WorkspaceTabGroup[],
  openGroupId: string | null,
  draggedWorkspaceId: string | null,
) {
  const renderedGroups = draggedWorkspaceId
    ? resolveMovedWorkspaceTabGroups(order, groups, draggedWorkspaceId)
    : groups;
  const items = buildWorkspaceTabStripItems(order, renderedGroups, openGroupId);
  const tabIds = items.flatMap((item) =>
    item.kind === 'tab' && !item.hidden ? [item.workspaceId] : [],
  );
  return { items, tabIds };
}

/**
 * Applies a drop slot among the visible tabs to the full tab order, so hidden
 * tabs of collapsed groups keep their place next to their group.
 */
export function proposeGroupedWorkspaceTabOrder(
  visibleOrder: readonly string[],
  fullOrder: readonly string[],
  draggedId: string,
  insertionIndex: number,
): string[] {
  const nextVisibleOrder = proposeWorkspaceTabOrder([...visibleOrder], draggedId, insertionIndex);
  const move = getReleasedWorkspaceTabMove([...visibleOrder], nextVisibleOrder, draggedId);
  return move
    ? applyWorkspaceTabMove(fullOrder, draggedId, move.targetId, move.placement)
    : [...fullOrder];
}

/**
 * Strip-slot attributes that drive workspace-tab-groups.css: group membership,
 * the collapsed state, the outline segment and the group color.
 */
export function workspaceTabGroupSlotAttributes(item: WorkspaceTabStripItem) {
  const hidden = item.kind === 'tab' && item.hidden;
  const edge = item.kind === 'group' ? (item.open ? 'start' : undefined) : item.group?.edge;
  return {
    'data-tab-group-member': item.kind === 'tab' && item.group ? '' : undefined,
    'data-tab-group-hidden': hidden ? '' : undefined,
    'data-tab-group-edge': edge,
    style: item.group ? `--tab-group-color: var(--tab-group-${item.group.color})` : undefined,
    inert: hidden,
  };
}
