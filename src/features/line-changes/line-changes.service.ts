/**
 * Line Changes Service
 *
 * Service for calculating and managing line change statistics.
 * Integrates with git, file system, and agent changes.
 */

import { Logger } from '../../shared/logger';
import type { AgentId } from '$shared/types/branded-ids';
import { lineChangesStore, type FileLineChange } from './line-changes.store';
import { diffLines } from 'diff';
import type { WorkspaceId, SessionId } from '../../shared/types';

const logger = new Logger('LineChangesService');

export class LineChangesService {
  private static instance: LineChangesService;
  private updateTimers = new Map<string, NodeJS.Timeout>();
  private eventHandlers = new Map<string, (...args: any[]) => void>();
  private readonly DEBOUNCE_DELAY = 500;

  private constructor() {
    this.setupEventListeners();
  }

  static getInstance(): LineChangesService {
    if (!LineChangesService.instance) {
      LineChangesService.instance = new LineChangesService();
    }
    return LineChangesService.instance;
  }

  /**
   * Set up event listeners for workspace and agent changes
   */
  private setupEventListeners(): void {
    // Event listeners will be set up via IPC in the main process
    // This service is called directly from the change detector manager
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    // Event handlers are cleaned up via IPC in the main process
    this.eventHandlers.clear();

    // Clear all timers
    for (const timer of this.updateTimers.values()) {
      clearTimeout(timer);
    }
    this.updateTimers.clear();
  }

  /**
   * Handle workspace file changes
   */
  private handleWorkspaceChanges(workspaceId: WorkspaceId, diffChunk: any): void {
    logger.debug(`[LineChangesService] Handling workspace changes for ${workspaceId}`);

    const fileChanges: FileLineChange[] = [];

    if (diffChunk.files && Array.isArray(diffChunk.files)) {
      for (const file of diffChunk.files) {
        fileChanges.push({
          path: file.path,
          additions: file.additions || 0,
          deletions: file.deletions || 0,
          action: file.action || 'modify',
        });
      }
    }

    lineChangesStore.trackFileChanges(workspaceId, fileChanges);
    this.scheduleUpdate(`workspace:${workspaceId}`);
  }

  /**
   * Handle agent file changes
   */
  private handleAgentChanges(agentId: AgentId, changes: any[]): void {
    logger.debug(`[LineChangesService] Handling agent changes for ${agentId}`);

    const fileChanges: FileLineChange[] = [];

    for (const change of changes) {
      fileChanges.push({
        path: change.path || change.filePath,
        additions: change.additions || 0,
        deletions: change.deletions || 0,
        action: change.action || 'modify',
      });
    }

    lineChangesStore.trackFileChanges(agentId, fileChanges);
    this.scheduleUpdate(`agent:${agentId}`);
  }

  /**
   * Schedule a debounced update for an entity
   */
  private scheduleUpdate(key: string): void {
    // Clear existing timer
    const existingTimer = this.updateTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new update in 500ms
    const timer = setTimeout(() => {
      this.updateTimers.delete(key);
      // Trigger any UI updates by accessing the store
      if (key.startsWith('workspace:')) {
        const workspaceId = key.replace('workspace:', '');
        lineChangesStore.getWorkspaceStats(workspaceId as WorkspaceId);
      } else if (key.startsWith('agent:')) {
        const agentId = key.replace('agent:', '');
        lineChangesStore.getAgentStats(agentId as AgentId);
      }
    }, 500);

    this.updateTimers.set(key, timer);
  }

  /**
   * Calculate line changes from content diff
   */
  calculateContentDiff(
    oldContent: string,
    newContent: string,
  ): { additions: number; deletions: number } {
    const changes = diffLines(oldContent, newContent);
    let additions = 0;
    let deletions = 0;

    for (const change of changes) {
      if (change.added) {
        additions += change.count || 0;
      } else if (change.removed) {
        deletions += change.count || 0;
      }
    }

    return { additions, deletions };
  }
}

// Export singleton instance
export const lineChangesService = LineChangesService.getInstance();
