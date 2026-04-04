/**
 * Utilities for checking running agents and showing warnings
 */

import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import { selectAllWorkspaceAgents } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';

/**
 * Get the names of agents currently running in a workspace
 * @param workspaceId - The workspace ID to check
 * @returns Array of agent names that are currently streaming
 */
export function getRunningAgentNames(workspaceId: string): string[] {
  const streamingAgentIds = activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId);

  // Get all agents for this workspace from Redux
  const agents = selectAllWorkspaceAgents.select(getReduxStore().getState(), workspaceId);

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
