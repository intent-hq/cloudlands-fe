/**
 * Pure utility functions extracted from SidebarChangesPanel.svelte
 * for testability and reuse.
 */

import type { TrackedChange, CommitInfo } from '$features/file-tracking/types';
import type { PullRequestInfo } from '$shared/types';
import type {
  AgentChangeGroup,
  PRInfo,
  UIFileChange,
} from '$lib/components/file-tracking/accept-changes/types';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';

/**
 * Validate a git branch name according to git-check-ref-format rules.
 * Returns an error message if invalid, undefined if valid.
 */
export function getBranchNameValidationError(name: string): string | undefined {
  if (!name || name.trim().length === 0) {
    return m.workspace_sidebarHeader_branchEmpty_error();
  }
  if (/[\s~^:\\?*\[\\]/.test(name)) {
    return m.workspace_sidebarHeader_branchInvalidChars_error();
  }
  if (name.includes('@{')) {
    return m.workspace_sidebarChanges_branchAtBrace_error({ seq: '@{' });
  }
  if (name === '@') {
    return m.workspace_sidebarChanges_branchAt_error({ symbol: '@' });
  }
  if (name.startsWith('.')) {
    return m.workspace_sidebarHeader_branchStartsDot_error();
  }
  if (name.endsWith('.lock')) {
    return m.workspace_sidebarHeader_branchEndsLock_error();
  }
  if (name.includes('..')) {
    return m.workspace_sidebarHeader_branchDoubleDot_error();
  }
  if (name.startsWith('/') || name.endsWith('/')) {
    return m.workspace_sidebarHeader_branchSlashEnds_error();
  }
  if (name.includes('//')) {
    return m.workspace_sidebarHeader_branchDoubleSlash_error();
  }
  if (name.startsWith('-')) {
    return m.workspace_sidebarHeader_branchStartsDash_error();
  }
  if (name.endsWith('.')) {
    return m.workspace_sidebarChanges_branchEndsPeriod_error();
  }
  // Per-component validation: each slash-separated component must not start with '.' or end with '.lock'
  const components = name.split('/');
  for (const component of components) {
    if (component.startsWith('.')) {
      return m.workspace_sidebarChanges_branchComponentStartsDot_error();
    }
    if (component.endsWith('.lock')) {
      return m.workspace_sidebarChanges_branchComponentEndsLock_error();
    }
  }
  if (name.length > 250) {
    return m.workspace_sidebarHeader_branchTooLong_error();
  }
  return undefined;
}

/** Construct the correct PR URL from repository info and PR number. */
export function constructPrUrl(
  prNumber: number,
  repoOwner: string | undefined,
  repoName: string | undefined,
  fallbackUrl?: string,
): string {
  if (repoOwner && repoName) {
    return `https://github.com/${repoOwner}/${repoName}/pull/${prNumber}`;
  }
  return fallbackUrl || '';
}

/** Convert PullRequestStatus enum string to PRDisplayStatus. */
export function toPRDisplayStatus(status: string): 'open' | 'merged' | 'closed' | 'draft' {
  if (status === 'Open') return 'open';
  if (status === 'Merged') return 'merged';
  if (status === 'Draft') return 'draft';
  return 'closed';
}

/** Generate a unique key for an agent change group in a section. */
export function getGroupKey(group: AgentChangeGroup, section: 'unstaged' | 'staged'): string {
  return `${section}:${group.agentId ?? 'manual'}`;
}

/** Get the number of unpushed commits from commitIndex to the end of the array. */
export function getCommitsToPushCount(allCommits: CommitInfo[], commitIndex: number): number {
  if (allCommits.length === 0 || commitIndex >= allCommits.length) return 0;
  const clampedIndex = Math.max(0, commitIndex);
  let count = 0;
  for (let i = clampedIndex; i < allCommits.length; i++) {
    if (!allCommits[i].isPushed) {
      count++;
    }
  }
  return count;
}

/** Get the number of pushed commits from index 0 to commitIndex (inclusive). */
export function getCommitsToUndoCount(allCommits: CommitInfo[], commitIndex: number): number {
  if (allCommits.length === 0 || commitIndex < 0) return 0;
  const clampedIndex = Math.min(commitIndex, allCommits.length - 1);
  let count = 0;
  for (let i = 0; i <= clampedIndex; i++) {
    if (allCommits[i].isPushed) {
      count++;
    }
  }
  return count;
}

/** Get the number of unpushed (local) commits from index 0 to commitIndex (inclusive). */
export function getLocalCommitsToUndoCount(
  allCommits: CommitInfo[],
  commitIndex: number,
): number {
  if (allCommits.length === 0 || commitIndex < 0) return 0;
  const clampedIndex = Math.min(commitIndex, allCommits.length - 1);
  let count = 0;
  for (let i = 0; i <= clampedIndex; i++) {
    if (!allCommits[i].isPushed) {
      count++;
    }
  }
  return count;
}

/** Get tooltip text for the push button at a given commit index. */
export function getPushTooltip(
  allCommits: CommitInfo[],
  commitIndex: number,
  hasPR: boolean,
  branchName: string | undefined,
): string {
  const count = getCommitsToPushCount(allCommits, commitIndex);
  const branchSuffix = branchName ? ` (origin/${branchName})` : '';
  if (hasPR) {
    return count === 1
      ? m.workspace_sidebarChanges_addToPr_one({ suffix: branchSuffix })
      : m.workspace_sidebarChanges_addToPr_many({
          count: formatInteger(count),
          suffix: branchSuffix,
        });
  }
  return count === 1
    ? m.workspace_sidebarChanges_pushToRemote_one({ suffix: branchSuffix })
    : m.workspace_sidebarChanges_pushToRemote_many({
        count: formatInteger(count),
        suffix: branchSuffix,
      });
}

/** Get tooltip text for the undo push button at a given commit index. */
export function getUndoTooltip(
  allCommits: CommitInfo[],
  commitIndex: number,
  branchName: string | undefined,
): string {
  const count = getCommitsToUndoCount(allCommits, commitIndex);
  const branchSuffix = branchName ? ` (origin/${branchName})` : '';
  return count === 1
    ? m.workspace_sidebarChanges_undoPush_one({ suffix: branchSuffix })
    : m.workspace_sidebarChanges_undoPush_many({
        count: formatInteger(count),
        suffix: branchSuffix,
      });
}



/** Get tooltip text for the undo commit button (local commits). */
export function getUndoCommitTooltip(allCommits: CommitInfo[], commitIndex: number): string {
  const count = getLocalCommitsToUndoCount(allCommits, commitIndex);
  return count === 1
    ? m.workspace_sidebarChanges_undoCommit_one()
    : m.workspace_sidebarChanges_undoCommit_many({ count: formatInteger(count) });
}

/** Check if a commit at the given index can be amended. Only HEAD (index 0) can. */
export function canAmendCommit(allCommits: CommitInfo[], index: number): boolean {
  return index === 0 && allCommits.length > 0;
}

/** Check if a file should be highlighted as active. */
export function isFileActive(
  filePath: string,
  isStaged: boolean,
  activeFilePath: string | null | undefined,
  activeFileStaged: boolean | null | undefined,
): boolean {
  if (!activeFilePath) return false;
  if (activeFileStaged === null || activeFileStaged === undefined) return false;
  return filePath === activeFilePath && isStaged === activeFileStaged;
}

/** Check if a file is selected in the multi-select set. */
export function isFileSelected(
  path: string,
  staged: boolean,
  selectedFiles: Set<string>,
): boolean {
  const key = `${staged ? 'staged' : 'unstaged'}:${path}`;
  return selectedFiles.has(key);
}

/** Check if a file is focused for keyboard navigation. */
export function isFileFocused(
  path: string,
  staged: boolean,
  focusedFile: { path: string; staged: boolean } | null,
): boolean {
  return focusedFile?.path === path && focusedFile?.staged === staged;
}

/**
 * Aggregate PR files from pushed commits.
 * Deduplicates by path and accumulates additions/deletions across commits.
 * Commits are sorted oldest-first so newer values accumulate properly.
 */
export function aggregatePRFiles(pushedCommits: CommitInfo[]): UIFileChange[] {
  if (pushedCommits.length === 0) return [];

  const fileMap = new Map<string, { additions: number; deletions: number }>();
  const sortedCommits = [...pushedCommits].sort((a, b) => a.timestamp - b.timestamp);

  for (const commit of sortedCommits) {
    for (const file of commit.files ?? []) {
      const existing = fileMap.get(file.path);
      if (existing) {
        fileMap.set(file.path, {
          additions: existing.additions + (file.additions || 0),
          deletions: existing.deletions + (file.deletions || 0),
        });
      } else {
        fileMap.set(file.path, {
          additions: file.additions || 0,
          deletions: file.deletions || 0,
        });
      }
    }
  }

  return Array.from(fileMap.entries()).map(([path, stats]) => ({
    path,
    additions: stats.additions,
    deletions: stats.deletions,
    staged: false,
  }));
}

/**
 * Compute total file-change statistics across unstaged, staged, and committed changes.
 * Returns { totalFilesChanged, totalAdditions, totalDeletions }.
 */
export function computeTotalStats(
  unstagedChanges: TrackedChange[],
  stagedChanges: TrackedChange[],
  allCommits: CommitInfo[],
): { totalFilesChanged: number; totalAdditions: number; totalDeletions: number } {
  const uniquePaths = new Set<string>();
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const change of unstagedChanges) {
    uniquePaths.add(change.relativePath);
    totalAdditions += change.stats?.additions || 0;
    totalDeletions += change.stats?.deletions || 0;
  }
  for (const change of stagedChanges) {
    uniquePaths.add(change.relativePath);
    totalAdditions += change.stats?.additions || 0;
    totalDeletions += change.stats?.deletions || 0;
  }
  for (const commit of allCommits) {
    for (const file of commit.files || []) {
      uniquePaths.add(file.path);
      totalAdditions += file.additions || 0;
      totalDeletions += file.deletions || 0;
    }
  }

  return { totalFilesChanged: uniquePaths.size, totalAdditions, totalDeletions };
}

/**
 * Map workspace pull requests to PRInfo[] for display.
 * Falls back to activePullRequest if workspace.pullRequests is empty.
 */
export function mapWorkspacePRs(
  workspacePRs: PullRequestInfo[] | undefined,
  activePR: PullRequestInfo | null | undefined,
  buildPrUrl: (prNumber: number, fallbackUrl?: string) => string,
  getDisplayTitle: (pr: PullRequestInfo) => string,
): PRInfo[] {
  if (workspacePRs && workspacePRs.length > 0) {
    return workspacePRs.map((pr) => ({
      number: pr.number,
      title: getDisplayTitle(pr),
      url: buildPrUrl(pr.number, pr.url),
      htmlUrl: buildPrUrl(pr.number, pr.url),
      status: toPRDisplayStatus(pr.status),
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    }));
  }
  if (activePR) {
    return [{
      number: activePR.number,
      title: getDisplayTitle(activePR),
      url: buildPrUrl(activePR.number, activePR.url),
      htmlUrl: buildPrUrl(activePR.number, activePR.url),
      status: toPRDisplayStatus(activePR.status),
      createdAt: activePR.createdAt,
      updatedAt: activePR.updatedAt,
    }];
  }
  return [];
}

/** Check if an agent group is collapsed. */
export function isAgentGroupCollapsed(
  agentId: string | null,
  collapsedAgentGroups: Set<string>,
): boolean {
  return collapsedAgentGroups.has(agentId ?? 'manual');
}

/** Convert a TrackedChange to a UIFileChange for the FileRow component. */
export function toUIFileChange(change: TrackedChange, staged: boolean): UIFileChange {
  return {
    path: change.relativePath,
    additions: change.stats.additions,
    deletions: change.stats.deletions,
    staged,
    status: change.status as 'added' | 'modified' | 'deleted' | 'renamed' | undefined,
    attribution: change.attribution?.agent
      ? {
          agentId: change.attribution.agent.agentId,
          agentName: change.attribution.agent.agentName,
          sessionId: change.attribution.agent.sessionId,
          turnNumber: change.attribution.agent.turnNumber,
          timestamp: change.attribution.timestamp,
        }
      : undefined,
  };
}
