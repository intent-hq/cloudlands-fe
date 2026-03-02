/**
 * Pure utility functions extracted from SidebarChangesPanel.svelte
 * for testability and reuse.
 */

import type { TrackedChange, CommitInfo } from '$features/file-tracking/types';
import type {
  AgentChangeGroup,
  UIFileChange,
} from '$lib/components/file-tracking/accept-changes/types';

/**
 * Validate a git branch name according to git-check-ref-format rules.
 * Returns an error message if invalid, undefined if valid.
 */
export function getBranchNameValidationError(name: string): string | undefined {
  if (!name || name.trim().length === 0) {
    return 'Branch name cannot be empty';
  }
  if (/[\s~^:\\?*\[\\]/.test(name)) {
    return 'Branch name contains invalid characters';
  }
  if (name.includes('@{')) {
    return 'Branch name cannot contain the sequence @{';
  }
  if (name === '@') {
    return 'Branch name cannot be @';
  }
  if (name.startsWith('.')) {
    return "Branch name cannot start with '.'";
  }
  if (name.endsWith('.lock')) {
    return "Branch name cannot end with '.lock'";
  }
  if (name.includes('..')) {
    return "Branch name cannot contain '..'";
  }
  if (name.startsWith('/') || name.endsWith('/')) {
    return 'Branch name cannot start or end with /';
  }
  if (name.includes('//')) {
    return 'Branch name cannot contain consecutive slashes';
  }
  if (name.startsWith('-')) {
    return "Branch name cannot start with '-'";
  }
  if (name.endsWith('.')) {
    return 'Branch name cannot end with a period';
  }
  // Per-component validation: each slash-separated component must not start with '.' or end with '.lock'
  const components = name.split('/');
  for (const component of components) {
    if (component.startsWith('.')) {
      return "Branch name component cannot start with '.'";
    }
    if (component.endsWith('.lock')) {
      return "Branch name component cannot end with '.lock'";
    }
  }
  if (name.length > 250) {
    return 'Branch name is too long (max 250 characters)';
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
  const commitWord = count === 1 ? 'commit' : 'commits';
  if (hasPR) {
    return count === 1
      ? `Add commit to PR${branchSuffix}`
      : `Add ${count} ${commitWord} to PR${branchSuffix}`;
  }
  return count === 1
    ? `Push commit to remote${branchSuffix}`
    : `Push ${count} ${commitWord} to remote${branchSuffix}`;
}

/** Get tooltip text for the undo push button at a given commit index. */
export function getUndoTooltip(
  allCommits: CommitInfo[],
  commitIndex: number,
  branchName: string | undefined,
): string {
  const count = getCommitsToUndoCount(allCommits, commitIndex);
  const branchSuffix = branchName ? ` (origin/${branchName})` : '';
  const commitWord = count === 1 ? 'commit' : 'commits';
  return count === 1
    ? `Undo push from remote${branchSuffix}`
    : `Undo ${count} ${commitWord} from remote${branchSuffix}`;
}



/** Get tooltip text for the undo commit button (local commits). */
export function getUndoCommitTooltip(allCommits: CommitInfo[], commitIndex: number): string {
  const count = getLocalCommitsToUndoCount(allCommits, commitIndex);
  const commitWord = count === 1 ? 'commit' : 'commits';
  return count === 1
    ? 'Undo commit (bring changes back to staging)'
    : `Undo ${count} ${commitWord} (bring changes back to staging)`;
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
