import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

export type HomeFilter =
  'all' | 'attention' | 'pr-ready' | 'running' | 'blocked' | 'unread' | 'archived';
export interface HomeRepository {
  key: string;
  name: string;
  owner?: string;
  path?: string;
}

export type HomeTriageGroup = 'needs-you' | 'pr-ready' | 'running' | 'blocked' | 'done' | 'idle';
export type HomeTriageInput = Pick<Workspace, 'displayStatus' | 'activity' | 'attention'>;

/** Mutually exclusive Home groups based only on daemon-owned structured signals. */
export function getHomeTriageGroup(workspace: HomeTriageInput): HomeTriageGroup {
  if (workspace.displayStatus === 'blocked' || workspace.displayStatus === 'failed') {
    return 'blocked';
  }
  if (workspace.attention === 'review_required' || workspace.displayStatus === 'needs_attention') {
    return 'needs-you';
  }
  if (workspace.displayStatus === 'pr_ready') return 'pr-ready';
  if (workspace.activity === 'agent_running' || workspace.displayStatus === 'in_progress') {
    return 'running';
  }
  if (workspace.displayStatus === 'complete' || workspace.displayStatus === 'pr_merged') {
    return 'done';
  }
  return 'idle';
}

export function needsAttention(workspace: HomeTriageInput): boolean {
  const group = getHomeTriageGroup(workspace);
  return group === 'needs-you' || group === 'blocked';
}

export function matchesHomeFilter(workspace: Workspace, filter: HomeFilter): boolean {
  if (workspace.status === WorkspaceStatusEnum.Deleted || workspace.pendingDeleteAt) return false;
  if (filter === 'archived') return workspace.status === WorkspaceStatusEnum.Archived;
  if (workspace.status === WorkspaceStatusEnum.Archived) return false;
  switch (filter) {
    case 'attention':
      return needsAttention(workspace);
    case 'pr-ready':
      return getHomeTriageGroup(workspace) === 'pr-ready';
    case 'running':
      return getHomeTriageGroup(workspace) === 'running';
    case 'blocked':
      return getHomeTriageGroup(workspace) === 'blocked';
    case 'unread':
      return workspace.attention === 'unread';
    default:
      return true;
  }
}
