import { isWorkspaceDisplayStatus, type Workspace, type WorkspaceDisplayStatus } from '$shared/types';

/**
 * Display status for a workspace (BE-owned or derived from PR/task state).
 * Re-exported from the canonical wire definition in `$shared/types`
 * (`WORKSPACE_DISPLAY_STATUS_VALUES`) so component consumers keep importing
 * from here.
 */
export type { WorkspaceDisplayStatus } from '$shared/types';

/**
 * Grouping status for sidebar status view. `idle` is a first-class wire value
 * since intentd#793 (the daemon folds live agent activity into the
 * `displayStatus` derivation), so this is now an alias of the wire union —
 * kept for its many existing importers.
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
 * Computes the grouping status for the sidebar status view. Running workspaces
 * (activity === 'agent_running' || streaming agents > 0) are UNCONDITIONALLY
 * grouped under 'in_progress', overriding every base status including pr_merged.
 *
 * Not-running workspaces with a BE-sent `workspace.displayStatus` render it
 * VERBATIM (intentd#793 — the daemon already folds agent activity into the
 * derivation, so `idle` and `in_progress` are authoritative). The local
 * demotion only applies on the fallback path (older daemon, `displayStatus`
 * absent or unknown, so `baseStatus` is the local PR/task derivation):
 * - PR states and 'complete' keep their status (never demoted to idle)
 * - 'in_progress' or 'not_started' with zero active agents → 'idle'
 *
 * @param workspace - The workspace to group
 * @param baseStatus - The base display status (BE-sent, else local PR/task derivation)
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
  // every base status (idle, in_progress, not_started, complete, pr_open, pr_ready, pr_merged)
  if (running) {
    return 'in_progress';
  }

  // BE-sent displayStatus is consumed verbatim: the daemon owns the idle /
  // in_progress split since intentd#793, so the FE never re-demotes it.
  if (isWorkspaceDisplayStatus(workspace.displayStatus)) {
    return baseStatus;
  }

  // Local-derivation fallback (older daemon): PR states and complete always
  // keep their status, never go to idle
  if (
    baseStatus === 'pr_merged' ||
    baseStatus === 'pr_open' ||
    baseStatus === 'pr_ready' ||
    baseStatus === 'complete'
  ) {
    return baseStatus;
  }

  // Not running + in_progress or not_started → demoted to idle
  if (baseStatus === 'in_progress' || baseStatus === 'not_started') {
    return 'idle';
  }

  return baseStatus;
}
