/**
 * Shared utility for grouping and sorting workspaces by repository.
 *
 * Both SpacesListOverlay and SpacesSidebar use the same algorithm:
 *   1. Build an order-index map (position in the pre-sorted input → recency rank)
 *   2. Bucket workspaces into groups via a caller-supplied key function
 *   3. Sort workspaces inside each group by their order index (most-recent first)
 *   4. Sort groups by the lowest (most-recent) order index among their members
 */

/**
 * Minimal information returned by a grouping key function.
 * Callers can extend this with extra fields (e.g. `isGithub`, `owner`).
 */
export interface GroupKeyInfo {
  /** Unique key used to bucket workspaces (e.g. "owner/repo") */
  key: string;
  /** Human-readable label for the group */
  label: string;
}

/**
 * A group of workspaces sharing the same group key, plus any extra
 * metadata returned by the `getGroupKey` function.
 */
export interface WorkspaceGroup<W, K extends GroupKeyInfo = GroupKeyInfo> {
  /** The group-key metadata (key, label, and any extras) */
  groupKey: K;
  /** Workspaces in this group, sorted most-recent-first */
  workspaces: W[];
}

/**
 * Groups an already-ordered list of workspaces and returns sorted groups.
 *
 * @param workspaces  Workspaces pre-sorted by recency (index 0 = most recent).
 *                    The ordering can come from any source (timestamps, a
 *                    persisted drag-order, etc.) – this function only cares
 *                    about the *position* in the array.
 * @param getId       Returns a stable unique ID for a workspace (used to build
 *                    the order-index map).
 * @param getGroupKey Returns group-key metadata for a workspace.
 * @returns           Groups sorted by most-recent workspace, each group's
 *                    workspaces sorted most-recent-first.
 */
export function groupAndSortWorkspaces<W, K extends GroupKeyInfo = GroupKeyInfo>({
  workspaces,
  getId,
  getGroupKey,
}: {
  workspaces: readonly W[];
  getId: (ws: W) => string;
  getGroupKey: (ws: W) => K;
}): WorkspaceGroup<W, K>[] {
  if (workspaces.length === 0) return [];

  // 1. Build order-index map (lower index = more recent)
  const orderIndex = new Map<string, number>();
  workspaces.forEach((ws, idx) => orderIndex.set(getId(ws), idx));

  // 2. Bucket into groups, preserving first-seen metadata
  const groupMap = new Map<string, { groupKey: K; workspaces: W[] }>();
  for (const ws of workspaces) {
    const key = getGroupKey(ws);
    let group = groupMap.get(key.key);
    if (!group) {
      group = { groupKey: key, workspaces: [] };
      groupMap.set(key.key, group);
    }
    group.workspaces.push(ws);
  }

  // 3. Sort workspaces within each group by recency (order index)
  for (const group of groupMap.values()) {
    group.workspaces.sort((a, b) => {
      const aIdx = orderIndex.get(getId(a)) ?? Infinity;
      const bIdx = orderIndex.get(getId(b)) ?? Infinity;
      return aIdx - bIdx;
    });
  }

  // 4. Sort groups by the most-recent workspace in each group
  const groups = Array.from(groupMap.values());
  groups.sort((a, b) => {
    const aMostRecent = Math.min(
      ...a.workspaces.map((ws) => orderIndex.get(getId(ws)) ?? Infinity),
    );
    const bMostRecent = Math.min(
      ...b.workspaces.map((ws) => orderIndex.get(getId(ws)) ?? Infinity),
    );
    return aMostRecent - bMostRecent;
  });

  return groups;
}

