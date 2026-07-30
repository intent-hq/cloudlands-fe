import type { Workspace, WorkspaceDisplayStatus } from '$shared/types';
import { PullRequestStatus } from '$shared/types';

/**
 * Display status for a workspace (BE-owned or derived from PR/task state).
 * Re-exported from the canonical wire definition in `$shared/types`
 * (`WORKSPACE_DISPLAY_STATUS_VALUES`) so component consumers keep importing
 * from here.
 */
export type { WorkspaceDisplayStatus } from '$shared/types';

/**
 * Grouping status for sidebar status view — extends WorkspaceDisplayStatus with 'idle'.
 * Workspaces with in_progress or not_started base status that have no active agents
 * are demoted to 'idle'.
 */
export type GroupingStatus = WorkspaceDisplayStatus | 'idle';

/**
 * Determines whether a workspace has active agents running. A workspace is considered
 * running if either:
 * - workspace.activity === 'agent_running' (BE-derived from agent manager)
 * - OR streamingAgentIds.length > 0 (FE-tracked active streams)
 */
export function isWorkspaceRunning(
  workspace: Workspace,
  streamingAgentIds: string[],
): boolean {
  return workspace.activity === 'agent_running' || streamingAgentIds.length > 0;
}

/**
 * Whether the workspace's wire PR fields report an open or draft PR. This reads
 * the workspace object only (prStatus / activePullRequest / pullRequests) — it
 * is a PR-stage check, not a re-derivation of displayStatus.
 */
function hasOpenOrDraftPullRequest(workspace: Workspace): boolean {
  const isOpenOrDraft = (status?: PullRequestStatus | null) =>
    status === PullRequestStatus.Open || status === PullRequestStatus.Draft;
  return (
    isOpenOrDraft(workspace.prStatus) ||
    isOpenOrDraft(workspace.activePullRequest?.status) ||
    (workspace.pullRequests ?? []).some((pr) => isOpenOrDraft(pr.status))
  );
}

/**
 * Computes the grouping status for the sidebar status view. Running workspaces
 * (activity === 'agent_running' || streaming agents > 0) are UNCONDITIONALLY
 * grouped under 'in_progress', overriding every base status including pr_merged.
 *
 * Not-running workspaces follow the existing grouping rules:
 * - PR states and 'complete' keep their status (never demoted to idle)
 * - 'in_progress' or 'not_started' with an open/draft PR on the wire → 'pr_open'
 *   (PR-stage workspaces never land in idle; the daemon's displayStatus does not
 *   carry PR stage, so it comes from the workspace's PR fields)
 * - 'in_progress' or 'not_started' with zero active agents → 'idle'
 *
 * @param workspace - The workspace to group
 * @param baseStatus - The base display status (from PR/task state)
 * @param streamingAgentIds - Array of streaming agent IDs for this workspace
 * @returns The grouping status for sidebar display
 */
export function getWorkspaceGroupingStatus(
  workspace: Workspace,
  baseStatus: WorkspaceDisplayStatus,
  streamingAgentIds: string[],
): GroupingStatus {
  const running = isWorkspaceRunning(workspace, streamingAgentIds);

  // Running workspaces ALWAYS go to in_progress, unconditionally overriding
  // every base status (in_progress, not_started, complete, pr_open, pr_ready, pr_merged)
  if (running) {
    return 'in_progress';
  }

  // Not running: PR states and complete always keep their status, never go to idle
  if (
    baseStatus === 'pr_merged' ||
    baseStatus === 'pr_open' ||
    baseStatus === 'pr_ready' ||
    baseStatus === 'complete'
  ) {
    return baseStatus;
  }

  // Not running + in_progress or not_started: an open/draft PR on the wire
  // keeps the workspace in the PR Open group; otherwise demoted to idle
  if (baseStatus === 'in_progress' || baseStatus === 'not_started') {
    if (hasOpenOrDraftPullRequest(workspace)) {
      return 'pr_open';
    }
    return 'idle';
  }

  return baseStatus;
}
