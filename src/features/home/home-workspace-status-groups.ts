import {
  isWorkspaceDisplayStatus,
  WorkspaceStatusEnum,
  type Workspace,
  type WorkspaceDisplayStatus,
} from '$shared/types';
import { m } from '$shared/paraglide/messages.js';

const statusLabels = {
  needs_attention: () => m.workspace_statusIcon_needsAttention_label(),
  not_started: () => m.workspace_statusIcon_notStarted_label(),
  in_progress: () => m.workspace_statusIcon_inProgress_label(),
  pr_open: () => m.workspace_statusIcon_prOpen_label(),
  pr_ready: () => m.workspace_statusIcon_prReady_label(),
  pr_queued: () => m.workspace_statusIcon_prQueued_label(),
  pr_merged: () => m.workspace_statusIcon_prMerged_label(),
  inactive: () => m.home_board_done_idle(),
};

type StatusGroup = keyof typeof statusLabels;

const statusGroups: Record<WorkspaceDisplayStatus, StatusGroup> = {
  failed: 'needs_attention',
  blocked: 'needs_attention',
  needs_attention: 'needs_attention',
  not_started: 'not_started',
  in_progress: 'in_progress',
  idle: 'inactive',
  complete: 'inactive',
  pr_open: 'pr_open',
  pr_ready: 'pr_ready',
  pr_queued: 'pr_queued',
  pr_merged: 'pr_merged',
};

const statusOrder = Object.keys(statusLabels) as StatusGroup[];

export function groupHomeWorkspacesByStatus(workspaces: readonly Workspace[]) {
  const buckets = new Map<StatusGroup | 'archived', Workspace[]>();
  for (const workspace of workspaces) {
    if (workspace.status === WorkspaceStatusEnum.Deleted || workspace.pendingDeleteAt) continue;
    // A Retired workspace (its folder was purged, PROTOCOL §5.1) is archived.
    const status =
      workspace.status === WorkspaceStatusEnum.Archived ||
      workspace.status === WorkspaceStatusEnum.Retired
        ? 'archived'
        : isWorkspaceDisplayStatus(workspace.displayStatus)
          ? statusGroups[workspace.displayStatus]
          : 'not_started';
    const items = buckets.get(status) ?? [];
    items.push(workspace);
    buckets.set(status, items);
  }
  return [...statusOrder, 'archived' as const].flatMap((status) => {
    const items = buckets.get(status);
    return items?.length
      ? [
          {
            id: `status:${status}`,
            label: status === 'archived' ? m.home_filter_archived() : statusLabels[status](),
            items,
          },
        ]
      : [];
  });
}
