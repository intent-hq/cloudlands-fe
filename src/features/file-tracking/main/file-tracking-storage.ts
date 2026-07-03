/**
 * File Tracking Storage Service (in-memory)
 *
 * Local JSON persistence (file-tracking.json, stage-transitions.json,
 * agent-attributions.json) has been retired — the daemon owns durable
 * file-tracking state (PROTOCOL §5.19). This in-memory adapter only backs the
 * legacy main-process pipeline until it is fully removed.
 */

import type { TrackedChange, StageTransition, AgentAttribution } from '../types';
import { Logger } from '$lib/utils/logger';
import { getBlob, isGitRepository } from '../../../shared/git/git-blob-storage';

const logger = new Logger({ category: 'FileTrackingStorage' });

/**
 * In-memory storage for file tracking data.
 * Implements singleton pattern per workspace.
 *
 * @class FileTrackingStorage
 * @example
 * ```typescript
 * const storage = FileTrackingStorage.getInstance('workspace-123');
 * const changes = await storage.loadTrackedChanges();
 * await storage.saveTrackedChanges(updatedChanges);
 * ```
 */
export class FileTrackingStorage {
  /** @property {Map<string, FileTrackingStorage>} instances - Map of workspace ID to storage instance */
  private static instances = new Map<string, FileTrackingStorage>();

  /** @property {string} workspaceId - Unique identifier for the workspace */
  private workspaceId: string;
  /** @property {string | null} workspacePath - Repo root path for git blob resolution */
  private workspacePath: string | null = null;
  /** @property {boolean} isGitRepo - Cached result of isGitRepository check */
  private isGitRepo: boolean = false;

  /** In-memory tracked changes for this workspace */
  private trackedChanges: TrackedChange[] = [];
  /** In-memory stage transitions for this workspace */
  private transitions: StageTransition[] = [];
  /** In-memory agent attributions for this workspace */
  private attributions = new Map<string, AgentAttribution>();

  private constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  /**
   * Get or create a singleton instance for a workspace.
   */
  static getInstance(workspaceId: string): FileTrackingStorage {
    let instance = FileTrackingStorage.instances.get(workspaceId);
    if (!instance) {
      logger.debug('Creating new FileTrackingStorage instance', { workspaceId });
      instance = new FileTrackingStorage(workspaceId);
      FileTrackingStorage.instances.set(workspaceId, instance);
    }
    return instance;
  }

  /**
   * Cleanup a specific workspace instance.
   * Called when workspace is deleted to prevent memory leaks.
   */
  static cleanupWorkspace(workspaceId: string): void {
    const instance = FileTrackingStorage.instances.get(workspaceId);
    if (instance) {
      instance.cleanup();
    }
  }

  /**
   * Clear all singleton instances (for testing or shutdown)
   */
  static clearAllInstances(): void {
    for (const [, instance] of FileTrackingStorage.instances) {
      instance.cleanup();
    }
    FileTrackingStorage.instances.clear();
  }

  /**
   * Drop in-memory state and remove from singleton instances
   */
  public cleanup(): void {
    this.trackedChanges = [];
    this.transitions = [];
    this.attributions = new Map();
    FileTrackingStorage.instances.delete(this.workspaceId);
    logger.debug('FileTrackingStorage cleaned up', { workspaceId: this.workspaceId });
  }

  /**
   * Set the workspace path (repo root) for git blob resolution.
   * Must be called before resolveContent() can resolve SHAs.
   */
  async setWorkspacePath(workspacePath: string): Promise<void> {
    this.workspacePath = workspacePath;
    this.isGitRepo = await isGitRepository(workspacePath);
  }

  /**
   * Get the cached isGitRepository result.
   * @returns true if the workspace is inside a git repository
   */
  getIsGitRepo(): boolean {
    return this.isGitRepo;
  }

  /**
   * Load tracked changes from the in-memory store
   */
  async loadTrackedChanges(): Promise<TrackedChange[]> {
    return this.trackedChanges;
  }

  /**
   * Save tracked changes to the in-memory store
   */
  async saveTrackedChanges(changes: TrackedChange[]): Promise<void> {
    this.trackedChanges = this.deduplicateChanges(changes);
  }

  /**
   * Deduplicate changes by keeping only the latest change per file per stage per commit
   * For committed changes, we keep all commits (different commitHash values)
   * For other stages, we keep only the latest change per file per stage
   */
  private deduplicateChanges(changes: TrackedChange[]): TrackedChange[] {
    const changeMap = new Map<string, TrackedChange>();

    for (const change of changes) {
      // For committed changes, include commitHash in the key to preserve all commits
      // For other stages, use file:stage as key to keep only the latest
      const key = change.commitHash
        ? `${change.file}:${change.stage}:${change.commitHash}`
        : `${change.file}:${change.stage}`;

      const existing = changeMap.get(key);
      if (!existing || change.attribution.timestamp > existing.attribution.timestamp) {
        changeMap.set(key, change);
      }
    }

    return Array.from(changeMap.values());
  }

  /**
   * Resolve blob SHAs to inline content for a single TrackedChange on demand.
   * Call this only when content is actually needed (e.g., for diff viewing).
   *
   * If the change already has content populated (oldContent, newContent, diff),
   * those fields are left as-is. Only missing content with a corresponding SHA is resolved.
   *
   * @param change - The tracked change to resolve content for
   * @returns A new TrackedChange with content fields populated from git blobs
   */
  async resolveContent(change: TrackedChange): Promise<TrackedChange> {
    if (!change.content) return change;
    if (!this.workspacePath || !this.isGitRepo) return change;

    // Clone the content to avoid mutating the cached object
    const resolvedContent = { ...change.content };
    let resolved = false;

    if (resolvedContent.oldContentSha && resolvedContent.oldContent == null) {
      const content = await getBlob(resolvedContent.oldContentSha, this.workspacePath);
      if (content !== null) {
        resolvedContent.oldContent = content;
        resolved = true;
      }
    }
    if (resolvedContent.newContentSha && resolvedContent.newContent == null) {
      const content = await getBlob(resolvedContent.newContentSha, this.workspacePath);
      if (content !== null) {
        resolvedContent.newContent = content;
        resolved = true;
      }
    }
    if (resolvedContent.diffSha && resolvedContent.diff == null) {
      const content = await getBlob(resolvedContent.diffSha, this.workspacePath);
      if (content !== null) {
        resolvedContent.diff = content;
        resolved = true;
      }
    }

    if (!resolved) return change;

    return { ...change, content: resolvedContent };
  }

  /**
   * Load stage transitions history from the in-memory store
   */
  async loadTransitions(): Promise<StageTransition[]> {
    return this.transitions;
  }

  /**
   * Save stage transitions history to the in-memory store
   */
  async saveTransitions(transitions: StageTransition[]): Promise<void> {
    this.transitions = transitions;
  }

  /**
   * Load agent attributions from the in-memory store
   */
  async loadAttributions(): Promise<Map<string, AgentAttribution>> {
    return new Map(this.attributions);
  }

  /**
   * Save agent attributions to the in-memory store
   */
  async saveAttributions(attributions: Map<string, AgentAttribution>): Promise<void> {
    this.attributions = new Map(attributions);
  }
}
