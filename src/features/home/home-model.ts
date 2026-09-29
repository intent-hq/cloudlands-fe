import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

export type HomeFilter = 'all' | 'attention' | 'running' | 'unread' | 'archived';
export interface HomeRepository {
  key: string;
  name: string;
  owner?: string;
  path?: string;
}

export function needsAttention(workspace: Workspace): boolean {
  return (
    workspace.attention === 'review_required' ||
    workspace.displayStatus === 'needs_attention' ||
    workspace.displayStatus === 'pr_ready' ||
    workspace.displayStatus === 'blocked' ||
    workspace.displayStatus === 'failed'
  );
}

export function matchesHomeFilter(workspace: Workspace, filter: HomeFilter): boolean {
  if (workspace.status === WorkspaceStatusEnum.Deleted || workspace.pendingDeleteAt) return false;
  if (filter === 'archived') return workspace.status === WorkspaceStatusEnum.Archived;
  if (workspace.status === WorkspaceStatusEnum.Archived) return false;
  switch (filter) {
    case 'attention':
      return needsAttention(workspace);
    case 'running':
      return workspace.activity === 'agent_running' || workspace.displayStatus === 'in_progress';
    case 'unread':
      return workspace.attention === 'unread';
    default:
      return true;
  }
}
