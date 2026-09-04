/**
 * Utilities for checking running agents / active background hooks and showing warnings
 */

import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
import type { BackgroundHook } from '$features/hooks/background-hooks-service';
import { backendRequest } from '$lib/client/live/backend-transport';
import { constructPrUrl } from '$lib/components/workspace/sidebar/sidebar-changes-utils';
import { PullRequestStatus, type PullRequestInfo } from '$shared/types';
import { selectBackgroundHooks } from '$store/renderer/slices/background-hooks/background-hooks-selectors';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import type {
  LocalChangesWarning,
  OpenPrWarningItem,
} from '$store/renderer/slices/workspace-operations/workspace-operations-types';
import { store as appStore } from '$store/renderer/store';

/**
 * Get the names of agents currently running in a workspace
 * @param workspaceId - The workspace ID to check
 * @returns Array of agent names that are currently streaming
 */
function getRunningAgentNames(workspaceId: string): string[] {
  const streamingAgentIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId);

  // Get all agents for this workspace from Redux
  const agents = selectAllWorkspaceAgents.select(appStore.state, workspaceId);

  // Look up agent names from the Redux store
  const agentNames: string[] = [];
  for (const agentId of streamingAgentIds) {
    const agent = agents.find((a) => a.id === agentId);

    // Use agent name if available, otherwise fall back to truncated ID
    if (agent?.name) {
      agentNames.push(agent.name);
    } else {
      agentNames.push(agentId.substring(0, 8));
    }
  }

  return agentNames;
}

/** Hook wire states that count as active work (PROTOCOL §5.40). */
const ACTIVE_HOOK_STATES: ReadonlySet<BackgroundHook['state']> = new Set(['scheduled', 'running']);

/**
 * Get the names of active (scheduled/running) background hooks in a workspace.
 * Reads the background-hooks slice when a live subscription backs the
 * workspace's entry (present and not `stale` — entries are retained
 * stale-marked across workspace switches), otherwise falls back to an
 * on-demand `hook.list`. Fetch failures fail open (no hooks reported) so
 * archive/delete is never blocked by a read.
 * @param workspaceId - The workspace ID to check
 * @returns Array of active hook names
 */
export async function getActiveHookNames(workspaceId: string): Promise<string[]> {
  let hooks: BackgroundHook[];
  const entry = appStore.state.backgroundHooks.byWorkspaceId[workspaceId];
  if (entry && !entry.stale) {
    hooks = selectBackgroundHooks.select(appStore.state, workspaceId);
  } else {
    try {
      const { listHooks } = await import('$features/hooks/background-hooks-service');
      hooks = await listHooks(workspaceId);
    } catch {
      return [];
    }
  }
  return hooks
    .filter((hook) => ACTIVE_HOOK_STATES.has(hook.state))
    .map((hook) => hook.name || hook.hookId.substring(0, 8));
}

export type {
  LocalChangesWarning,
  OpenPrWarningItem,
} from '$store/renderer/slices/workspace-operations/workspace-operations-types';

/**
 * Collect the workspace's unmerged PRs (status Open/Draft) from the Redux
 * workspace slice: union of `pullRequests` and `activePullRequest`, deduped
 * by url (fallback number). `isDraft: true` is reported as status Draft.
 * A missing wire `url` is constructed from the workspace's repository
 * owner/name (as the sidebar PR presentation does via `constructPrUrl`).
 * @param workspaceId - The workspace ID to check
 */
export function getOpenPrItems(workspaceId: string): OpenPrWarningItem[] {
  const workspace = selectWorkspaceById.select(appStore.state, workspaceId);
  if (!workspace) return [];
  const pool: PullRequestInfo[] = [
    ...(workspace.pullRequests ?? []),
    ...(workspace.activePullRequest ? [workspace.activePullRequest] : []),
  ];
  const seen = new Set<string>();
  const items: OpenPrWarningItem[] = [];
  for (const pr of pool) {
    if (pr.status !== PullRequestStatus.Open && pr.status !== PullRequestStatus.Draft) continue;
    const url =
      pr.url || constructPrUrl(pr.number, workspace.repositoryOwner, workspace.repositoryName);
    const key = url || String(pr.number);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      number: pr.number,
      title: pr.title,
      url,
      status: pr.isDraft || pr.status === PullRequestStatus.Draft ? 'Draft' : 'Open',
      ...(pr.mergeConflicts !== undefined ? { mergeConflicts: pr.mergeConflicts } : {}),
    });
  }
  return items;
}

/**
 * Per-call timeout for the `workspace.localChanges` preflight, shorter than
 * the transport's 30s default so a slow daemon read (large worktree, cold
 * disk) cannot hold the Archive/Delete click open. Fails open: a timeout
 * rejects → `getLocalChanges` returns `null` → the local-changes warning is
 * simply omitted; the other warnings (agents, hooks, open PRs) are unaffected.
 */
const LOCAL_CHANGES_TIMEOUT_MS = 10_000;

/**
 * Fetch the workspace's local git work (unpushed commits / uncommitted
 * changes per root) via `workspace.localChanges`, bounded by
 * `LOCAL_CHANGES_TIMEOUT_MS`. Fails open: any error (including a timeout or
 * an older daemon without the method) yields `null` so archive/delete is
 * never blocked by the read.
 * @param workspaceId - The workspace ID to check
 */
export async function getLocalChanges(workspaceId: string): Promise<LocalChangesWarning | null> {
  try {
    return await backendRequest<LocalChangesWarning>(
      'workspace.localChanges',
      { workspaceId },
      { timeoutMs: LOCAL_CHANGES_TIMEOUT_MS },
    );
  } catch {
    return null;
  }
}

/** Streaming agent names, active hook names, open PRs, and local changes for one workspace, for gating. */
export interface ActiveWorkNames {
  agentNames: string[];
  hookNames: string[];
  openPrs: OpenPrWarningItem[];
  /** `null` when not requested (bulk flows) or when the RPC failed. */
  localChanges: LocalChangesWarning | null;
}

/**
 * Collect the in-flight work (streaming agents and active background hooks)
 * that a workspace archive/delete would stop, plus its unmerged (Open/Draft)
 * PRs and — only when `includeLocalChanges` is set — its local git changes.
 * Bulk flows leave it off so they never fan out `workspace.localChanges`.
 * @param workspaceId - The workspace ID to check
 */
export async function getActiveWorkNames(
  workspaceId: string,
  { includeLocalChanges = false }: { includeLocalChanges?: boolean } = {},
): Promise<ActiveWorkNames> {
  const [hookNames, localChanges] = await Promise.all([
    getActiveHookNames(workspaceId),
    includeLocalChanges ? getLocalChanges(workspaceId) : Promise.resolve(null),
  ]);
  return {
    agentNames: getRunningAgentNames(workspaceId),
    hookNames,
    openPrs: getOpenPrItems(workspaceId),
    localChanges,
  };
}
