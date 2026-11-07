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

function isWorkspaceTabGroupColor(value: unknown): value is WorkspaceTabGroupColor {
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

/**
 * The expanded group: the group of the current tab when it has one (a selected
 * tab is never hidden), otherwise the group the user last opened.
 */
export function resolveOpenWorkspaceTabGroupId(
  groups: readonly WorkspaceTabGroup[],
  currentTabId: string | null,
  openTabGroupId: string | null | undefined,
): string | null {
  const currentGroup = findWorkspaceTabGroup(groups, currentTabId);
  if (currentGroup) return currentGroup.id;
  return groups.some((group) => group.id === openTabGroupId) ? (openTabGroupId ?? null) : null;
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
      .sort((left, right) => (position.get(left) ?? 0) - (position.get(right) ?? 0));
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

export interface WorkspaceTabProject {
  /** Stable project identity, such as `owner/name` or the repository path. */
  key: string;
  /** Group name for the project. */
  name: string;
}

export interface WorkspaceTabProjectLayout {
  workspaceStacks: string[][];
  groups: WorkspaceTabGroup[];
}

const PROJECT_GROUP_PREFIX = 'project:';
const projectGroupId = (projectKey: string) => `${PROJECT_GROUP_PREFIX}${projectKey}`;

/** True for a group made by grouping tabs by project. */
export function isWorkspaceTabProjectGroup(group: WorkspaceTabGroup): boolean {
  return group.id.startsWith(PROJECT_GROUP_PREFIX);
}

/**
 * Sorts stacks so each project's tabs sit together, in order of each project's
 * first tab, and rebuilds one group per project that has two or more tabs.
 * Groups made by hand keep their tabs and move as one unit. A stack follows
 * its first tab. Project groups from an earlier run keep their name and color.
 */
export function layoutWorkspaceTabsByProject(
  workspaceStacks: readonly (readonly string[])[],
  groups: readonly WorkspaceTabGroup[],
  projects: Readonly<Record<string, WorkspaceTabProject>>,
): WorkspaceTabProjectLayout {
  const manualGroups = groups.filter((group) => !isWorkspaceTabProjectGroup(group));
  const stackKey = (stack: readonly string[]) => {
    const manualGroup = findWorkspaceTabGroup(manualGroups, stack[0]);
    if (manualGroup) return `group:${manualGroup.id}`;
    const project = projects[stack[0] ?? ''];
    return project ? projectGroupId(project.key) : `tab:${stack[0]}`;
  };
  const buckets = new Map<string, string[][]>();
  for (const stack of workspaceStacks) {
    const key = stackKey(stack);
    buckets.set(key, [...(buckets.get(key) ?? []), [...stack]]);
  }
  const previous = new Map(groups.map((group) => [group.id, group]));
  const planned = [...buckets].flatMap(([id, stacks]) => {
    const workspaceIds = stacks.flat();
    const project = projects[workspaceIds[0] ?? ''];
    if (!project || !id.startsWith(PROJECT_GROUP_PREFIX) || workspaceIds.length < 2) return [];
    return [{ id, project, workspaceIds, previous: previous.get(id) }];
  });
  const colored = [
    ...manualGroups,
    ...planned.flatMap((plan) => (plan.previous ? [plan.previous] : [])),
  ];
  const projectGroups = planned.map(({ id, project, workspaceIds, previous: earlier }) => {
    const group: WorkspaceTabGroup = {
      id,
      name: earlier?.name ?? project.name,
      color: earlier?.color ?? nextWorkspaceTabGroupColor(colored),
      workspaceIds,
      lastActiveWorkspaceId: earlier?.lastActiveWorkspaceId,
    };
    if (!earlier) colored.push(group);
    return group;
  });
  const nextStacks = [...buckets.values()].flat();
  const order = nextStacks.flat();
  const nextGroups = normalizeWorkspaceTabGroups(order, [...manualGroups, ...projectGroups]).sort(
    (left, right) => order.indexOf(left.workspaceIds[0]) - order.indexOf(right.workspaceIds[0]),
  );
  return { workspaceStacks: nextStacks, groups: nextGroups };
}

/**
 * Moves every member of `groupId` as one block before or after `targetId`. A
 * target inside another group snaps to that group's edge, so groups stay
 * contiguous. Returns null when nothing moves.
 */
export function moveWorkspaceTabGroupInStacks(
  workspaceStacks: readonly (readonly string[])[],
  groups: readonly WorkspaceTabGroup[],
  groupId: string,
  targetId: string,
  placement: 'before' | 'after',
): string[][] | null {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group || group.workspaceIds.includes(targetId)) return null;
  const targetGroup = findWorkspaceTabGroup(groups, targetId);
  const anchorId = targetGroup
    ? ((placement === 'before' ? targetGroup.workspaceIds[0] : targetGroup.workspaceIds.at(-1)) ??
      targetId)
    : targetId;
  const members = new Set(group.workspaceIds);
  const split = (keep: (id: string) => boolean) =>
    workspaceStacks.map((stack) => stack.filter(keep)).filter((stack) => stack.length > 0);
  const moved = split((id) => members.has(id));
  const rest = split((id) => !members.has(id));
  const anchorIndex = rest.findIndex((stack) => stack.includes(anchorId));
  if (moved.length === 0 || anchorIndex < 0) return null;
  rest.splice(anchorIndex + (placement === 'after' ? 1 : 0), 0, ...moved);
  const before = workspaceStacks.flat().join('\0');
  return rest.flat().join('\0') === before ? null : rest;
}
