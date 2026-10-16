import {
  workspaceReminderStatus,
  workspaceReminderDismissed,
} from '$shared/utils/workspace-attention-reminder';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import type { RepositoryGroup } from '$lib/components/workspace/utils/workspace-grouping';

export type HomeFilter =
  'all' | 'attention' | 'pr-ready' | 'running' | 'blocked' | 'unread' | 'archived';
export interface HomeRepository {
  key: string;
  name: string;
  owner?: string;
  path?: string;
}

/** Local repositories participate in the same sidebar ordering as organizations. */
export function groupHomeRepositoriesForSidebar(
  repositoryGroups: RepositoryGroup[],
  labels: { unknownRepository: string; localFolder: string },
) {
  const groups: { key: string; owner?: string; label: string; items: RepositoryGroup[] }[] = [];
  const unassigned: RepositoryGroup[] = [];
  for (const repo of repositoryGroups) {
    if (repo.key === labels.unknownRepository) {
      unassigned.push(repo);
      continue;
    }
    const key = repo.owner ? `org:${repo.owner.toLowerCase()}` : 'local';
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      group = {
        key,
        owner: repo.owner,
        label: repo.owner || labels.localFolder,
        items: [],
      };
      groups.push(group);
    }
    group.items.push(repo);
  }
  const count = (items: RepositoryGroup[]) =>
    items.reduce(
      (total, repo) =>
        total + repo.workspaces.filter((workspace) => matchesHomeFilter(workspace, 'all')).length,
      0,
    );
  groups.sort((a, b) => count(b.items) - count(a.items) || a.label.localeCompare(b.label));
  for (const group of groups) {
    group.items.sort((a, b) => count([b]) - count([a]) || a.label.localeCompare(b.label));
  }
  return { groups, unassigned };
}

export type HomeTriageGroup = 'needs-you' | 'pr-ready' | 'running' | 'blocked' | 'done' | 'idle';
export type HomeTriageInput = Pick<
  Workspace,
  'displayStatus' | 'activity' | 'attention' | 'attentionReminder'
>;

/** Mutually exclusive Home groups based only on daemon-owned structured signals. */
export function getHomeTriageGroup(workspace: HomeTriageInput): HomeTriageGroup {
  const status = workspaceReminderStatus(workspace);
  if (workspace.displayStatus === 'blocked' || workspace.displayStatus === 'failed') {
    return 'blocked';
  }
  if (
    (!workspaceReminderDismissed(workspace) && workspace.attention === 'review_required') ||
    status === 'needs_attention'
  ) {
    return 'needs-you';
  }
  if (status === 'pr_ready') return 'pr-ready';
  if (workspace.activity === 'agent_running' || status === 'in_progress') {
    return 'running';
  }
  if (status === 'complete' || status === 'pr_merged') {
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
