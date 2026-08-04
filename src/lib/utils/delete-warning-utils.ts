/**
 * Utilities for checking running agents / active background hooks and showing warnings
 */

import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
import type { BackgroundHook } from '$features/hooks/background-hooks-service';
import { selectBackgroundHooks } from '$store/renderer/slices/background-hooks/background-hooks-selectors';
import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import { store as appStore } from '$store/renderer/store';

/**
 * Get the names of agents currently running in a workspace
 * @param workspaceId - The workspace ID to check
 * @returns Array of agent names that are currently streaming
 */
export function getRunningAgentNames(workspaceId: string): string[] {
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

/**
 * Check if a workspace has any running agents
 * @param workspaceId - The workspace ID to check
 * @returns true if the workspace has running agents, false otherwise
 */
export function hasRunningAgents(workspaceId: string): boolean {
  const streamingAgentIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId);
  return streamingAgentIds.length > 0;
}

/** Hook wire states that count as active work (PROTOCOL §5.40). */
const ACTIVE_HOOK_STATES: ReadonlySet<BackgroundHook['state']> = new Set(['scheduled', 'running']);

/**
 * Get the names of active (scheduled/running) background hooks in a workspace.
 * Reads the background-hooks slice when a live subscription is open for the
 * workspace, otherwise falls back to an on-demand `hook.list`. Fetch failures
 * fail open (no hooks reported) so archive/delete is never blocked by a read.
 * @param workspaceId - The workspace ID to check
 * @returns Array of active hook names
 */
export async function getActiveHookNames(workspaceId: string): Promise<string[]> {
  let hooks: BackgroundHook[];
  if (appStore.state.backgroundHooks.byWorkspaceId[workspaceId]) {
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

/** Streaming agent names + active hook names for one workspace, for gating. */
export interface ActiveWorkNames {
  agentNames: string[];
  hookNames: string[];
}

/**
 * Collect the names of in-flight work (streaming agents and active background
 * hooks) that a workspace archive/delete would stop.
 * @param workspaceId - The workspace ID to check
 */
export async function getActiveWorkNames(workspaceId: string): Promise<ActiveWorkNames> {
  return {
    agentNames: getRunningAgentNames(workspaceId),
    hookNames: await getActiveHookNames(workspaceId),
  };
}
