import {
  resolveWorkspaceStatusState,
  type WorkspaceStatusPresentationInput,
} from '$lib/components/workspace/utils/workspace-status-presentation';

/** Header status groups, highest priority first. Other states never count as updates. */
const DOCK_STATUS_GROUP_ORDER = [
  'failed',
  'blocked',
  'needs_attention',
  'in_progress',
  'unread',
] as const;

type DockStatusGroupStatus = (typeof DOCK_STATUS_GROUP_ORDER)[number];

export interface DockStatusGroup {
  status: DockStatusGroupStatus;
  count: number;
}

/**
 * Count workspaces per status with the same resolver as each row's badge, so the
 * compact header shows exactly the dots the rows show. Zero groups are omitted.
 */
export function dockStatusGroups(
  items: readonly { workspace: WorkspaceStatusPresentationInput }[],
): DockStatusGroup[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const status = resolveWorkspaceStatusState(item.workspace);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return DOCK_STATUS_GROUP_ORDER.flatMap((status) => {
    const count = counts.get(status) ?? 0;
    return count > 0 ? [{ status, count }] : [];
  });
}
