import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

export type HomeFilter =
  'all' | 'attention' | 'running' | 'blocked' | 'unread' | 'archived' | 'retired';
export interface HomeRepository {
  key: string;
  name: string;
  owner?: string;
  path?: string;
}

export type HomeTriageGroup = 'needs-you' | 'running' | 'blocked' | 'done' | 'idle';
export type HomeTriageInput = Pick<Workspace, 'displayStatus' | 'activity' | 'attention'>;

/** Mutually exclusive Home groups based only on daemon-owned structured signals. */
export function getHomeTriageGroup(workspace: HomeTriageInput): HomeTriageGroup {
  if (workspace.displayStatus === 'blocked' || workspace.displayStatus === 'failed') {
    return 'blocked';
  }
  if (
    workspace.attention === 'review_required' ||
    workspace.displayStatus === 'needs_attention' ||
    workspace.displayStatus === 'pr_ready'
  ) {
    return 'needs-you';
  }
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
  // Retired rows (PROTOCOL §5.1) show only under their own opt-in chip.
  if (filter === 'retired') return workspace.status === WorkspaceStatusEnum.Retired;
  if (
    workspace.status === WorkspaceStatusEnum.Archived ||
    workspace.status === WorkspaceStatusEnum.Retired
  ) {
    return false;
  }
  switch (filter) {
    case 'attention':
      return needsAttention(workspace);
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

export function hasRetiredWorkspaces(workspaces: readonly Workspace[]): boolean {
  return workspaces.some((workspace) => workspace.status === WorkspaceStatusEnum.Retired);
}

/**
 * The live list never carries retired rows (strict `includeRetired` opt-in,
 * PROTOCOL §5.1), so an ordinary list refresh drops the ones the Retired chip
 * loaded. Reload them when that happens while the chip is selected.
 */
export function shouldReloadRetiredWorkspaces(
  filter: HomeFilter,
  hadRetired: boolean,
  hasRetired: boolean,
): boolean {
  return filter === 'retired' && hadRetired && !hasRetired;
}
