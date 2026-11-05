export const WORKSPACE_TAB_GROUP_COLORS = [
  'blue',
  'green',
  'purple',
  'orange',
  'pink',
  'grey',
] as const;

export type WorkspaceTabGroupColor = (typeof WORKSPACE_TAB_GROUP_COLORS)[number];

export interface WorkspaceTabGroup {
  id: string;
  /** Empty when the group has no name. */
  name: string;
  color: WorkspaceTabGroupColor;
  /** Members in strip order; always a contiguous run of the tab order. */
  workspaceIds: string[];
  /** Member to select when the group is opened from its chip. */
  lastActiveWorkspaceId?: string;
}

export function isWorkspaceTabGroupColor(value: unknown): value is WorkspaceTabGroupColor {
  return (WORKSPACE_TAB_GROUP_COLORS as readonly unknown[]).includes(value);
}

/** Keeps only well-formed groups from persisted, untrusted storage. */
export function parsePersistedWorkspaceTabGroups(value: unknown): WorkspaceTabGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): WorkspaceTabGroup[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const group = candidate as Record<string, unknown>;
    if (typeof group.id !== 'string' || !isWorkspaceTabGroupColor(group.color)) return [];
    if (!Array.isArray(group.workspaceIds)) return [];
    return [
      {
        id: group.id,
        name: typeof group.name === 'string' ? group.name : '',
        color: group.color,
        workspaceIds: group.workspaceIds.filter((id): id is string => typeof id === 'string'),
        lastActiveWorkspaceId:
          typeof group.lastActiveWorkspaceId === 'string' ? group.lastActiveWorkspaceId : undefined,
      },
    ];
  });
}

export function findWorkspaceTabGroup(
  groups: readonly WorkspaceTabGroup[],
  workspaceId: string | null | undefined,
): WorkspaceTabGroup | undefined {
  if (!workspaceId) return undefined;
  return groups.find((group) => group.workspaceIds.includes(workspaceId));
}

/** The first color not used by an existing group, cycling once all are taken. */
export function nextWorkspaceTabGroupColor(
  groups: readonly WorkspaceTabGroup[],
): WorkspaceTabGroupColor {
  const used = new Set(groups.map((group) => group.color));
  return (
    WORKSPACE_TAB_GROUP_COLORS.find((color) => !used.has(color)) ??
    WORKSPACE_TAB_GROUP_COLORS[groups.length % WORKSPACE_TAB_GROUP_COLORS.length]
  );
}

/**
 * Drops unknown and duplicate members, sorts members into tab order and
 * removes empty groups.
 */
export function normalizeWorkspaceTabGroups(
  order: readonly string[],
  groups: readonly WorkspaceTabGroup[],
): WorkspaceTabGroup[] {
  const position = new Map(order.map((id, index) => [id, index]));
  const seen = new Set<string>();
  return groups.flatMap((group) => {
    const workspaceIds = group.workspaceIds
      .filter((id) => position.has(id) && !seen.has(id))
      .sort((left, right) => position.get(left)! - position.get(right)!);
    workspaceIds.forEach((id) => seen.add(id));
    if (workspaceIds.length === 0) return [];
    const lastActiveWorkspaceId =
      group.lastActiveWorkspaceId && workspaceIds.includes(group.lastActiveWorkspaceId)
        ? group.lastActiveWorkspaceId
        : undefined;
    return [{ ...group, workspaceIds, lastActiveWorkspaceId }];
  });
}

/**
 * Updates group membership after `movedId` lands at its position in `order`.
 * A tab dropped between two members of one group joins that group. A grouped
 * tab dropped away from every other member of its group leaves the group.
 */
export function resolveMovedWorkspaceTabGroups(
  order: readonly string[],
  groups: readonly WorkspaceTabGroup[],
  movedId: string,
): WorkspaceTabGroup[] {
  const index = order.indexOf(movedId);
  if (index < 0) return normalizeWorkspaceTabGroups(order, groups);
  const previousGroup = findWorkspaceTabGroup(groups, order[index - 1]);
  const nextGroup = findWorkspaceTabGroup(groups, order[index + 1]);
  const ownGroup = findWorkspaceTabGroup(groups, movedId);
  let targetGroupId = ownGroup?.id;
  if (previousGroup && previousGroup === nextGroup && previousGroup !== ownGroup) {
    targetGroupId = previousGroup.id;
  } else if (ownGroup && ownGroup.workspaceIds.length > 1) {
    const touchesOwnGroup = previousGroup === ownGroup || nextGroup === ownGroup;
    if (!touchesOwnGroup) targetGroupId = undefined;
  }
  const nextGroups = groups.map((group) => {
    const withoutMoved = group.workspaceIds.filter((id) => id !== movedId);
    return {
      ...group,
      workspaceIds: group.id === targetGroupId ? [...withoutMoved, movedId] : withoutMoved,
    };
  });
  return normalizeWorkspaceTabGroups(order, nextGroups);
}

/** Moves `workspaceId` so it sits directly after `targetId` in `order`. */
export function placeWorkspaceTabAfter(
  order: readonly string[],
  workspaceId: string,
  targetId: string,
): string[] {
  if (workspaceId === targetId) return [...order];
  const remaining = order.filter((id) => id !== workspaceId);
  const targetIndex = remaining.indexOf(targetId);
  if (targetIndex < 0) return [...order];
  remaining.splice(targetIndex + 1, 0, workspaceId);
  return remaining;
}

/** Applies a released drag move to a full tab order. */
export function applyWorkspaceTabMove(
  order: readonly string[],
  workspaceId: string,
  targetId: string,
  placement: 'before' | 'after',
): string[] {
  if (workspaceId === targetId) return [...order];
  const remaining = order.filter((id) => id !== workspaceId);
  const targetIndex = remaining.indexOf(targetId);
  if (targetIndex < 0) return [...order];
  remaining.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, workspaceId);
  return remaining;
}
