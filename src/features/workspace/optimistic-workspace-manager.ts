/**
 * Optimistic workspace management
 * Handles optimistic UI updates for workspace creation
 */

import { createLogger } from '$lib/utils/client-logger';
import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceId as WorkspaceIdFn } from '$shared/types/branded-ids';

const logger = createLogger('OptimisticWorkspaceManager');

interface OptimisticWorkspace extends Partial<Workspace> {
  id: WorkspaceId;
  name: string;
  isOptimistic: true;
  repoPath?: string;
  branch?: string;
}

type OptimisticEvent = 'resolved' | 'failed' | 'removed';
type OptimisticListener = (
  tempId: string,
  event: OptimisticEvent,
  workspace?: Workspace | null,
  error?: Error,
) => void;

class OptimisticWorkspaceManager {
  private optimisticWorkspaces: Map<string, OptimisticWorkspace> = new Map();
  private pendingCreations: Set<string> = new Set();
  private listeners: Set<OptimisticListener> = new Set();

  createOptimisticWorkspace(name: string, repoPath?: string): string {
    const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const optimisticWorkspace: OptimisticWorkspace = {
      id: WorkspaceIdFn(tempId),
      name,
      repoPath,
      isOptimistic: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.optimisticWorkspaces.set(tempId, optimisticWorkspace);
    this.pendingCreations.add(tempId);

    logger.info('Created optimistic workspace', { tempId, name });
    return tempId;
  }

  resolveOptimisticWorkspace(tempId: string, realWorkspace: Workspace) {
    if (this.optimisticWorkspaces.has(tempId)) {
      this.optimisticWorkspaces.delete(tempId);
      this.pendingCreations.delete(tempId);
      logger.info('Resolved optimistic workspace', { tempId, realId: realWorkspace.id });

      // Notify any listeners about successful resolution
      this.notifyListeners(tempId, 'resolved', realWorkspace);
    }
  }

  /**
   * Handle failed workspace creation
   * Cleans up optimistic workspace and notifies listeners
   */
  failOptimisticWorkspace(tempId: string, error: Error) {
    if (this.optimisticWorkspaces.has(tempId)) {
      this.optimisticWorkspaces.delete(tempId);
      this.pendingCreations.delete(tempId);
      logger.error('Failed to create optimistic workspace', { tempId, error: error.message });

      // Notify any listeners about the failure
      this.notifyListeners(tempId, 'failed', null, error);
    }
  }

  removeOptimisticWorkspace(tempId: string) {
    if (this.optimisticWorkspaces.has(tempId)) {
      this.optimisticWorkspaces.delete(tempId);
      this.pendingCreations.delete(tempId);
      logger.info('Removed optimistic workspace', { tempId });

      // Notify any listeners about removal
      this.notifyListeners(tempId, 'removed', null);
    }
  }

  isOptimistic(workspaceId: string): boolean {
    return this.optimisticWorkspaces.has(workspaceId);
  }

  // Alias for compatibility
  isOptimisticId(workspaceId: string): boolean {
    return this.isOptimistic(workspaceId);
  }

  isPending(workspaceId: string): boolean {
    return this.pendingCreations.has(workspaceId);
  }

  // Get transition data for optimistic workspaces
  getTransition(
    workspaceId: string,
  ): { config?: { title?: string; repositoryPath?: string; branch?: string } } | null {
    const workspace = this.optimisticWorkspaces.get(workspaceId);
    if (!workspace) return null;

    return {
      config: {
        title: workspace.name,
        repositoryPath: workspace.repoPath,
        branch: workspace.branch || 'main',
      },
    };
  }

  getOptimisticWorkspace(workspaceId: string): OptimisticWorkspace | undefined {
    return this.optimisticWorkspaces.get(workspaceId);
  }

  getAllOptimisticWorkspaces(): OptimisticWorkspace[] {
    return Array.from(this.optimisticWorkspaces.values());
  }

  clearAll() {
    this.optimisticWorkspaces.clear();
    this.pendingCreations.clear();
    this.listeners.clear();
    logger.info('Cleared all optimistic workspaces');
  }

  /**
   * Add a listener for optimistic workspace events
   */
  addListener(listener: OptimisticListener): () => void {
    this.listeners.add(listener);
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners about an event
   */
  private notifyListeners(
    tempId: string,
    event: OptimisticEvent,
    workspace?: Workspace | null,
    error?: Error,
  ) {
    this.listeners.forEach((listener) => {
      try {
        listener(tempId, event, workspace, error);
      } catch (err) {
        logger.error('Error in optimistic workspace listener', { error: err });
      }
    });
  }
}

export const optimisticWorkspaceManager = new OptimisticWorkspaceManager();
