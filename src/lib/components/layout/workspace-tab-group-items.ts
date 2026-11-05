import {
  findWorkspaceTabGroup,
  type WorkspaceTabGroup,
} from '$store/renderer/slices/tab-state/tab-groups';

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
