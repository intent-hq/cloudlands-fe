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
    }
  | { kind: 'group'; key: string; group: WorkspaceTabGroup; open: boolean };

export const workspaceTabGroupItemKey = (groupId: string) => `tab-group:${groupId}`;

/**
 * Lays out the strip: each group gets a header chip before its first tab.
 * Only `openGroupId` (the group of the current tab) shows its tabs; the tabs
 * of every other group are hidden behind their chip.
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
    if (group && group !== openGroup) continue;
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
    });
  }
  return items;
}

/**
 * The tab to select when a group chip is activated. Opening a group selects
 * its last selected tab. Collapsing the open group selects the nearest tab
 * outside it, or returns null when every tab is in the group.
 */
export function getWorkspaceTabGroupToggleTarget(
  order: readonly string[],
  groups: readonly WorkspaceTabGroup[],
  groupId: string,
  currentTabId: string | null | undefined,
): string | null {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) return null;
  if (findWorkspaceTabGroup(groups, currentTabId) !== group) {
    return group.lastActiveWorkspaceId ?? group.workspaceIds[0] ?? null;
  }
  const members = new Set(group.workspaceIds);
  const firstIndex = order.findIndex((id) => members.has(id));
  const after = order.slice(firstIndex).find((id) => !members.has(id));
  const before = order
    .slice(0, firstIndex)
    .reverse()
    .find((id) => !members.has(id));
  return after ?? before ?? null;
}

/**
 * Strip items for the rendered order. The open group comes from the stored
 * groups, so a dragged tab never collapses its group mid-drag; membership
 * follows the proposed drop position.
 */
export function layoutWorkspaceTabStrip(
  order: readonly string[],
  groups: readonly WorkspaceTabGroup[],
  selectedWorkspaceId: string | null | undefined,
  draggedWorkspaceId: string | null,
) {
  const openGroupId = findWorkspaceTabGroup(groups, selectedWorkspaceId)?.id ?? null;
  const renderedGroups = draggedWorkspaceId
    ? resolveMovedWorkspaceTabGroups(order, groups, draggedWorkspaceId)
    : groups;
  const items = buildWorkspaceTabStripItems(order, renderedGroups, openGroupId);
  const tabIds = items.flatMap((item) => (item.kind === 'tab' ? [item.workspaceId] : []));
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
