/**
 * Registry for GitStateManager instances
 * Manages singleton instances per workspace
 */

import {
  GitStateManager,
  GitStateManagerConfig,
} from './main/git-state-manager';
import { Logger } from '../../shared/logger';

const logger = new Logger('GitStateManagerRegistry');

// Store for GitStateManager instances
const gitStateManagers = new Map<string, GitStateManager>();

/**
 * Get or create a GitStateManager for a workspace
 */
export function getGitStateManager(
  workspaceId: string,
  worktreePath?: string,
  config?: GitStateManagerConfig,
): GitStateManager | null {
  // Check if we already have an instance
  let manager = gitStateManagers.get(workspaceId);

  if (!manager && worktreePath) {
    // Create new instance
    logger.info(`Creating GitStateManager for workspace ${workspaceId}`);
    manager = new GitStateManager(workspaceId, worktreePath, config);
    gitStateManagers.set(workspaceId, manager);
  }

  return manager || null;
}

/**
 * Initialize GitStateManager for a workspace
 */
export async function initializeGitStateManager(
  workspaceId: string,
  worktreePath: string,
  config?: GitStateManagerConfig,
): Promise<GitStateManager> {
  const manager = getGitStateManager(workspaceId, worktreePath, config);
  if (!manager) {
    throw new Error(`Failed to create GitStateManager for workspace ${workspaceId}`);
  }
  return manager;
}

/**
 * Clean up GitStateManager for a workspace
 */
export async function cleanupGitStateManager(workspaceId: string): Promise<void> {
  const manager = gitStateManagers.get(workspaceId);
  if (manager) {
    logger.info(`Cleaning up GitStateManager for workspace ${workspaceId}`);
    await manager.cleanup();
    gitStateManagers.delete(workspaceId);
  }
}

/**
 * Get all active GitStateManagers
 */
export function getAllGitStateManagers(): Map<string, GitStateManager> {
  return new Map(gitStateManagers);
}
