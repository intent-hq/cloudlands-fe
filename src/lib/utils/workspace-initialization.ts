/**
 * Workspace Initialization Utilities
 *
 * Handles workspace creation, initial agent setup, and animation triggers
 */

import type { Workspace } from '$shared/types';

/**
 * Workspace initialization flags stored in sessionStorage
 */
export interface WorkspaceInitFlags {
  createAgent: boolean;
  showAnimation: boolean;
  initialPrompt: string | null;
}

/**
 * Get and clear workspace initialization flags
 * This ensures flags are only read once to prevent re-triggering on tab changes
 */
export function getAndClearInitFlags(workspaceId: string): WorkspaceInitFlags {
  const createAgentFlag = sessionStorage.getItem(`workspace-${workspaceId}-create-agent`);
  const showAnimationFlag = sessionStorage.getItem(`workspace-${workspaceId}-show-animation`);
  const initialPrompt = sessionStorage.getItem(`workspace-${workspaceId}-initial-prompt`);

  // Clear flags immediately to prevent re-triggering
  if (createAgentFlag) {
    sessionStorage.removeItem(`workspace-${workspaceId}-create-agent`);
  }
  if (showAnimationFlag) {
    sessionStorage.removeItem(`workspace-${workspaceId}-show-animation`);
  }
  // Keep initial prompt for animation component to read

  return {
    createAgent: createAgentFlag === 'true',
    showAnimation: showAnimationFlag === 'true',
    initialPrompt,
  };
}

/**
 * Set workspace initialization flags
 * Used by workspace creation flow
 */
export function setInitFlags(workspaceId: string, flags: Partial<WorkspaceInitFlags>) {
  if (flags.createAgent !== undefined) {
    sessionStorage.setItem(`workspace-${workspaceId}-create-agent`, String(flags.createAgent));
  }
  if (flags.showAnimation !== undefined) {
    sessionStorage.setItem(`workspace-${workspaceId}-show-animation`, String(flags.showAnimation));
  }
  if (flags.initialPrompt !== undefined && flags.initialPrompt !== null) {
    sessionStorage.setItem(`workspace-${workspaceId}-initial-prompt`, flags.initialPrompt);
  }
}

/**
 * Clear all initialization flags for a workspace
 */
export function clearInitFlags(workspaceId: string) {
  sessionStorage.removeItem(`workspace-${workspaceId}-create-agent`);
  sessionStorage.removeItem(`workspace-${workspaceId}-show-animation`);
  sessionStorage.removeItem(`workspace-${workspaceId}-initial-prompt`);
}

/**
 * Check if this is a new workspace that needs initialization
 */
export function isNewWorkspace(workspaceId: string, agentCount: number): boolean {
  // Check if workspace has been visited before
  const hasBeenVisited = localStorage.getItem(`workspace-visited-${workspaceId}`) === 'true';

  // New workspace if no agents and not visited
  return agentCount === 0 && !hasBeenVisited;
}

/**
 * Mark workspace as visited
 */
export function markWorkspaceVisited(workspaceId: string) {
  localStorage.setItem(`workspace-visited-${workspaceId}`, 'true');
}

/**
 * Determine if workspace creation animation should be shown
 */
export function shouldShowCreationAnimation(flags: WorkspaceInitFlags): boolean {
  // Only show animation if:
  // 1. Show animation flag is set
  // 2. There's an initial prompt (indicates coming from creation flow)
  // 3. Create agent flag is also set (double verification)
  return flags.showAnimation && flags.createAgent && !!flags.initialPrompt;
}
