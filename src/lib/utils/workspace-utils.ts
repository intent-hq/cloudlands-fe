import type { Workspace } from '$shared/types';
import { PullRequestStatus } from '$shared/types';

/**
 * Represents the current stage of work in a workspace.
 */
export type WorkspaceStage = 'planning' | 'in-progress' | 'pr-open' | 'merged';

/**
 * Determine the current stage of a workspace based on its state.
 * Analyzes pull requests, code changes, and merge status to categorize the workspace.
 *
 * @param workspace - The workspace to analyze
 * @returns The current stage of the workspace
 * @example
 * ```typescript
 * const stage = getWorkspaceStage(workspace);
 * if (stage === 'pr-open') {
 *   console.log('Ready for review!');
 * }
 * ```
 */
export function getWorkspaceStage(workspace: Workspace): WorkspaceStage {
  // Check if PR is merged
  if (workspace.activePullRequest?.status === PullRequestStatus.Merged) {
    return 'merged';
  }

  // Check if PR is open
  if (
    workspace.activePullRequest ||
    workspace.pullRequests?.some(
      (pr) => pr.status === PullRequestStatus.Open || pr.status === PullRequestStatus.Draft,
    )
  ) {
    return 'pr-open';
  }

  // Check if there are code changes (diff summary, diffs, or changesets)
  const hasCodeChanges =
    (workspace.diffSummary?.totalFiles ?? 0) > 0 ||
    (workspace.diffs && workspace.diffs.length > 0) ||
    (workspace.changesets && workspace.changesets.length > 0);

  if (hasCodeChanges) {
    return 'in-progress';
  }

  // Default to planning stage
  return 'planning';
}

/**
 * Get a human-readable label for a workspace stage.
 *
 * @param stage - The workspace stage
 * @returns Display label for the stage
 * @example
 * ```typescript
 * const label = getStageLabel('pr-open');
 * // Returns: "PR Open"
 * ```
 */
export function getStageLabel(stage: WorkspaceStage): string {
  switch (stage) {
    case 'planning':
      return 'Planning';
    case 'in-progress':
      return 'In Progress';
    case 'pr-open':
      return 'PR Open';
    case 'merged':
      return 'Merged';
    default:
      return 'Unknown';
  }
}

/**
 * Get a descriptive explanation of what happens in each workspace stage.
 *
 * @param stage - The workspace stage
 * @returns Description of the stage
 * @example
 * ```typescript
 * const desc = getStageDescription('planning');
 * // Returns: "Defining requirements and planning implementation"
 * ```
 */
export function getStageDescription(stage: WorkspaceStage): string {
  switch (stage) {
    case 'planning':
      return 'Defining requirements and planning implementation';
    case 'in-progress':
      return 'Actively making code changes';
    case 'pr-open':
      return 'Pull request is open for review';
    case 'merged':
      return 'Changes have been merged';
    default:
      return '';
  }
}

/**
 * Information about a recently used repository.
 */
export interface RecentRepo {
  /** Absolute path to the repository */
  path: string;
  /** Repository name (typically the folder name) */
  name: string;
  /** ISO timestamp of when this repo was last used */
  updatedAt: string;
  /** GitHub organization or user who owns this repository */
  owner?: string;
}

/**
 * Extract unique repositories from workspaces, sorted by most recent updatedAt.
 *
 * Iterates through all workspaces, tracks the most recent `updatedAt` per repository path,
 * and returns a sorted array of unique repositories.
 *
 * @param workspaces - Array of workspaces to extract repos from
 * @param limit - Optional maximum number of repos to return (default: all)
 * @returns Array of unique repositories sorted by updatedAt descending
 * @example
 * ```typescript
 * const repos = getRecentRepos(workspaces, 5);
 * // Returns up to 5 most recently used repositories
 * ```
 */
export function getRecentRepos(workspaces: Workspace[], limit?: number): RecentRepo[] {
  if (!workspaces || workspaces.length === 0) {
    return [];
  }

  // Track the most recent workspace for each repository path
  const repoMap = new Map<string, RecentRepo>();

  for (const workspace of workspaces) {
    if (!workspace.repositoryPath) {
      continue;
    }

    const key = workspace.repositoryPath;
    const existing = repoMap.get(key);

    // Only update if this workspace is newer or it's the first occurrence
    if (!existing || workspace.updatedAt > existing.updatedAt) {
      repoMap.set(key, {
        path: workspace.repositoryPath,
        name:
          workspace.repositoryName || workspace.repositoryPath.split('/').pop() || 'Unknown',
        updatedAt: workspace.updatedAt,
        owner: workspace.repositoryOwner,
      });
    }
  }

  // Sort by most recently updated (descending)
  const sortedRepos = Array.from(repoMap.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  // Apply limit if specified
  return limit !== undefined ? sortedRepos.slice(0, limit) : sortedRepos;
}
