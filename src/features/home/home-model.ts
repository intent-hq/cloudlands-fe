import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

export type HomeFilter =
  'all' | 'attention' | 'running' | 'waiting' | 'blocked' | 'unread' | 'archived' | 'retired';
export interface HomeRepository {
  key: string;
  name: string;
  owner?: string;
  path?: string;
}

export type HomeTriageGroup = 'needs-you' | 'running' | 'waiting' | 'blocked' | 'done' | 'idle';
export type HomeTriageInput = Pick<Workspace, 'displayStatus' | 'activity' | 'attention'> &
  Partial<Pick<Workspace, 'waiting' | 'scriptsRunning' | 'backgroundTasksRunning'>>;

/** An agent turn, a command-mode script run, or an agent's background task
 *  (e.g. a backgrounded shell) is in flight. */
function isHomeRunning(workspace: HomeTriageInput): boolean {
  return (
    workspace.activity === 'agent_running' ||
    workspace.displayStatus === 'in_progress' ||
    workspace.scriptsRunning === true ||
    workspace.backgroundTasksRunning === true
  );
}

/** Watching something external: the daemon's waiting flag (hooks, PR and
 *  script monitors, delegated agents) or a PR sitting in the merge queue. */
function isHomeWaiting(workspace: HomeTriageInput): boolean {
  return workspace.waiting === true || workspace.displayStatus === 'pr_queued';
}

/** Mutually exclusive Home groups based only on daemon-owned structured signals.
 *  Precedence: blocked > needs you > running > waiting > done > idle. */
export function getHomeTriageGroup(workspace: HomeTriageInput): HomeTriageGroup {
  const group = getHomeBaseTriageGroup(workspace);
  return (group === 'done' || group === 'idle') && isHomeWaiting(workspace) ? 'waiting' : group;
}

/** The triage group without the waiting overlay, for status chips that show
 *  waiting as a supplemental marker on the underlying state. */
export function getHomeBaseTriageGroup(
  workspace: HomeTriageInput,
): Exclude<HomeTriageGroup, 'waiting'> {
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
  if (isHomeRunning(workspace)) {
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
    case 'waiting':
      return getHomeTriageGroup(workspace) === 'waiting';
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
