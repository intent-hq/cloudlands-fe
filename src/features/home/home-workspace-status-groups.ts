import {
  isWorkspaceDisplayStatus,
  WorkspaceStatusEnum,
  type Workspace,
  type WorkspaceDisplayStatus,
} from '$shared/types';
import { m } from '$shared/paraglide/messages.js';

const statusLabels: Record<WorkspaceDisplayStatus, () => string> = {
  failed: () => m.workspace_statusIcon_failed_label(),
  blocked: () => m.workspace_statusIcon_blocked_label(),
  needs_attention: () => m.workspace_statusIcon_needsAttention_label(),
  not_started: () => m.workspace_statusIcon_notStarted_label(),
  in_progress: () => m.workspace_statusIcon_inProgress_label(),
  idle: () => m.workspace_statusIcon_idle_label(),
  complete: () => m.workspace_statusIcon_complete_label(),
  pr_open: () => m.workspace_statusIcon_prOpen_label(),
  pr_ready: () => m.workspace_statusIcon_prReady_label(),
  pr_queued: () => m.workspace_statusIcon_prQueued_label(),
  pr_merged: () => m.workspace_statusIcon_prMerged_label(),
};

// The insertion order matches the detailed sidebar groups.
const statusOrder = Object.keys(statusLabels) as WorkspaceDisplayStatus[];

export function groupHomeWorkspacesByStatus(workspaces: readonly Workspace[]) {
  const buckets = new Map<WorkspaceDisplayStatus | 'archived', Workspace[]>();
  for (const workspace of workspaces) {
    if (workspace.status === WorkspaceStatusEnum.Deleted || workspace.pendingDeleteAt) continue;
    const status =
      workspace.status === WorkspaceStatusEnum.Archived
        ? 'archived'
        : isWorkspaceDisplayStatus(workspace.displayStatus)
          ? workspace.displayStatus
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
