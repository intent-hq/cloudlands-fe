/**
 * File Tracking Service
 *
 * Business logic for managing file changes through git workflow stages.
 * Supports both local and remote workspaces via SSH.
 */

import { FileTrackingStorage } from './file-tracking-storage';
import { ChangeStage } from '../types';
import type { TrackedChange, StageTransition, ChangeFilter } from './types';
import { Logger } from '$lib/utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import { TRACKING_CONFIG } from '../tracking.config';
import { remoteRPCManager } from '../../../shared/main/remote-rpc-manager';

// Centralized git environment to prevent credential prompts
import { gitEnv } from '../../../shared/git/git-env';

/**
 * Execute git command safely with proper argument escaping (local only)
 */
async function execGitCommandLocal(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, { cwd, env: gitEnv, windowsHide: true });

    let stderr = '';
    git.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    git.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Git command failed with code ${code}: ${stderr}`));
      } else {
        resolve();
      }
    });

    git.on('error', (err) => {
      reject(err);
    });
  });
}

const logger = new Logger({ category: 'FileTrackingService' });

/**
 * Service for managing file changes through git workflow stages.
 * Provides comprehensive tracking of file modifications, staging, and commits
 * with support for agent attribution and automatic cleanup.
 *
 * @class FileTrackingService
 * @example
 * ```typescript
 * const service = new FileTrackingService('workspace-123', '/path/to/workspace');
 *
 * // Track a new change
 * const change = await service.trackChange({
 *   file: 'src/app.ts',
 *   stage: ChangeStage.Unstaged,
 *   type: 'modified',
 *   timestamp: new Date(),
 *   agentId: 'agent-123'
 * });
 *
 * // Stage changes
 * await service.stageChanges([change.id]);
 *
 * // Get all changes
 * const changes = await service.getChanges();
 * ```
 */
export class FileTrackingService {
  /** @property {FileTrackingStorage} storage - Storage adapter for tracked changes */
  private storage: FileTrackingStorage;
  /** @property {string} workspaceId - Unique identifier for the workspace */
  private workspaceId: string;
  /** @property {string} workspacePath - File system path to the workspace */
  private workspacePath: string;
  /** @property {boolean} isRemote - Whether this is a remote workspace */
  private isRemote: boolean = false;

  // OPTIMIZED: Debounced saving to prevent excessive disk writes
  /** @property {TrackedChange[] | null} pendingChanges - Changes waiting to be saved */
  private pendingChanges: TrackedChange[] | null = null;
  /** @property {NodeJS.Timeout | null} saveDebounceTimer - Timer for debounced saves */
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  /** @property {number} SAVE_DEBOUNCE_DELAY - Delay in ms before saving pending changes */
  private readonly SAVE_DEBOUNCE_DELAY = TRACKING_CONFIG.fileTracking.saveDebounce;
  /** @property {(() => void) | null} saveCompleteCallback - Callback to invoke after save completes */
  private saveCompleteCallback: (() => void) | null = null;

  // Mutex for storage operations to prevent race conditions
  /** @property {Promise<void>} storageMutex - Mutex to serialize storage operations */
  private storageMutex: Promise<void> = Promise.resolve();

  // Cleanup and limits
  /** @property {NodeJS.Timeout | null} cleanupTimer - Timer for periodic cleanup */
  private cleanupTimer: NodeJS.Timeout | null = null;
  /** @property {number} MAX_TRACKED_FILES - Maximum number of files to track */
  private readonly MAX_TRACKED_FILES = TRACKING_CONFIG.fileTracking.maxTrackedFiles;
  /** @property {number} MAX_HISTORY_PER_FILE - Maximum history entries per file */
  private readonly MAX_HISTORY_PER_FILE = TRACKING_CONFIG.fileTracking.maxHistoryPerFile;
  /** @property {number} CLEANUP_INTERVAL - Interval between cleanup runs in ms */
  private readonly CLEANUP_INTERVAL = TRACKING_CONFIG.changeDetection.cleanupInterval;

  /**
   * Creates an instance of FileTrackingService.
   * Initializes storage and starts periodic cleanup timer.
   *
   * @param {string} workspaceId - The unique identifier of the workspace
   * @param {string} workspacePath - The file system path to the workspace
   * @param {boolean} [isRemote] - Whether this is a remote workspace
   */
  constructor(workspaceId: string, workspacePath: string, isRemote?: boolean) {
    this.workspaceId = workspaceId;
    this.workspacePath = workspacePath;
    this.storage = FileTrackingStorage.getInstance(workspaceId);
    // Fire-and-forget: isGitRepo defaults to false and is updated async
    void this.storage.setWorkspacePath(workspacePath);
    this.isRemote = !!isRemote;

    // Start periodic cleanup
    this.startCleanupTimer();
  }

  /**
   * Execute git command - works for both local and remote workspaces
   */
  private async execGitCommand(args: string[]): Promise<void> {
    if (this.isRemote) {
      // Execute via RPC for remote workspaces
      const rpcClient = await remoteRPCManager.getClient(this.workspaceId);
      const command = `cd "${this.workspacePath}" && git ${args.map((a) => `"${a}"`).join(' ')}`;
      await rpcClient.exec({ command, timeout: 30000 });
    } else {
      // Execute locally for local workspaces
      await execGitCommandLocal(args, this.workspacePath);
    }
  }

  /**
   * Acquire the storage mutex to serialize storage operations.
   * This prevents race conditions between concurrent read-modify-write operations.
   * @returns A release function to call when done with the operation
   */
  private async acquireStorageMutex(): Promise<() => void> {
    let release: () => void;
    const newMutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previousMutex = this.storageMutex;
    this.storageMutex = newMutex;
    await previousMutex;
    return release!;
  }

  /**
   * Start periodic cleanup of old tracked changes
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldChanges().catch((error) => {
        logger.error('Failed to cleanup old changes', error as Error);
      });
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Stop the cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Cleanup old tracked changes to enforce limits
   */
  private async cleanupOldChanges(): Promise<void> {
    // Acquire mutex to prevent race conditions with concurrent storage operations
    const release = await this.acquireStorageMutex();
    try {
      const changes = await this.storage.loadTrackedChanges();

      // Group changes by file
      const changesByFile = new Map<string, TrackedChange[]>();
      for (const change of changes) {
        const fileChanges = changesByFile.get(change.file) || [];
        fileChanges.push(change);
        changesByFile.set(change.file, fileChanges);
      }

      // Enforce per-file history limit
      let cleanedChanges: TrackedChange[] = [];
      for (const [, fileChanges] of changesByFile) {
        // Sort by timestamp (newest first)
        fileChanges.sort((a, b) => b.attribution.timestamp - a.attribution.timestamp);

        // Keep only the most recent changes up to the limit
        const keptChanges = fileChanges.slice(0, this.MAX_HISTORY_PER_FILE);
        cleanedChanges.push(...keptChanges);
      }

      // Enforce total file limit
      if (cleanedChanges.length > this.MAX_TRACKED_FILES) {
        // Sort all changes by timestamp (newest first)
        cleanedChanges.sort((a, b) => b.attribution.timestamp - a.attribution.timestamp);
        cleanedChanges = cleanedChanges.slice(0, this.MAX_TRACKED_FILES);
      }

      // Save cleaned changes if different
      if (cleanedChanges.length < changes.length) {
        await this.storage.saveTrackedChanges(cleanedChanges);
        logger.info('Cleaned up old tracked changes', {
          before: changes.length,
          after: cleanedChanges.length,
          removed: changes.length - cleanedChanges.length,
        });
      }
    } catch (error) {
      logger.error('Failed to cleanup old changes', error as Error);
    } finally {
      release();
    }
  }

  /**
   * Cleanup resources when service is destroyed.
   * Stops all timers and clears pending operations.
   *
   * @public
   * @returns {void}
   */
  public destroy(): void {
    this.stopCleanupTimer();
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
  }

  /**
   * Clear all tracked changes from storage.
   * Removes all change history for the workspace.
   *
   * @public
   * @returns {Promise<void>}
   * @throws {Error} If storage operation fails
   */
  async clearChanges(): Promise<void> {
    // Acquire mutex to prevent race conditions with concurrent storage operations
    const release = await this.acquireStorageMutex();
    try {
      await this.storage.saveTrackedChanges([]);
      logger.debug('Cleared all tracked changes', { workspaceId: this.workspaceId });
    } finally {
      release();
    }
  }

  /**
   * Clear tracked changes for a specific file.
   * Removes all tracked changes for the given file path from storage.
   *
   * @public
   * @param {string} filePath - The file path to clear changes for
   * @returns {Promise<void>}
   * @throws {Error} If storage operation fails
   */
  async clearFileChanges(filePath: string): Promise<void> {
    // Acquire mutex to prevent race conditions with concurrent storage operations
    const release = await this.acquireStorageMutex();
    try {
      const changes = await this.storage.loadTrackedChanges();
      const filteredChanges = changes.filter((c: TrackedChange) => c.file !== filePath);
      await this.storage.saveTrackedChanges(filteredChanges);
      logger.debug('Cleared tracked changes for file', { workspaceId: this.workspaceId, filePath });
    } finally {
      release();
    }
  }

  /**
   * Clear tracked changes for multiple files at once (batch operation).
   * Removes all tracked changes for the given file paths in a single operation.
   * OPTIMIZED: Single load/save cycle instead of one per file.
   *
   * @public
   * @param {string[]} filePaths - Array of file paths to clear changes for
   * @returns {Promise<void>}
   * @throws {Error} If storage operation fails
   */
  async clearFileChangesBatch(filePaths: string[]): Promise<void> {
    if (!filePaths || filePaths.length === 0) {
      return;
    }

    // Acquire mutex to prevent race conditions with concurrent storage operations
    const release = await this.acquireStorageMutex();
    try {
      const changes = await this.storage.loadTrackedChanges();
      const filePathSet = new Set(filePaths);
      const filteredChanges = changes.filter((c: TrackedChange) => !filePathSet.has(c.file));
      await this.storage.saveTrackedChanges(filteredChanges);
      logger.debug('Cleared tracked changes for files (batch)', {
        workspaceId: this.workspaceId,
        count: filePaths.length,
      });
    } finally {
      release();
    }
  }

  /**
   * Clear tracked changes for specific file:stage pairs.
   * This is more precise than clearFileChangesBatch - it only removes entries
   * that match both the file path AND the stage, allowing a file to have
   * its unstaged entry cleared while preserving its staged entry (or vice versa).
   *
   * @public
   * @param {Array<{file: string, stage: ChangeStage}>} entries - File:stage pairs to clear
   * @returns {Promise<void>}
   * @throws {Error} If storage operation fails
   */
  async clearFileStageEntriesBatch(
    entries: Array<{ file: string; stage: ChangeStage }>,
  ): Promise<void> {
    if (!entries || entries.length === 0) {
      return;
    }

    // Acquire mutex to prevent race conditions with concurrent storage operations
    const release = await this.acquireStorageMutex();
    try {
      const changes = await this.storage.loadTrackedChanges();
      // Create a set of file:stage keys to clear
      const keysToRemove = new Set(entries.map((e) => `${e.file}:${e.stage}`));
      const filteredChanges = changes.filter((c: TrackedChange) => {
        const key = `${c.file}:${c.stage}`;
        return !keysToRemove.has(key);
      });
      await this.storage.saveTrackedChanges(filteredChanges);
      logger.debug('Cleared tracked changes for file:stage pairs (batch)', {
        workspaceId: this.workspaceId,
        count: entries.length,
        removedCount: changes.length - filteredChanges.length,
      });
    } finally {
      release();
    }
  }

  /**
   * Track a new file change.
   * Creates a new tracked change with a unique ID and adds it to storage.
   * If a change already exists for the same file and stage, it will be updated.
   *
   * @public
   * @param {Omit<TrackedChange, 'id'>} change - The change to track (without ID)
   * @returns {Promise<TrackedChange>} The tracked change with generated ID
   * @throws {Error} If storage operation fails
   * @example
   * ```typescript
   * const trackedChange = await service.trackChange({
   *   file: 'src/app.ts',
   *   stage: ChangeStage.Unstaged,
   *   type: 'modified',
   *   timestamp: new Date(),
   *   agentId: 'agent-123',
   *   content: 'new file content',
   *   oldContent: 'old file content',
   *   additions: 10,
   *   deletions: 5
   * });
   * ```
   */
  async trackChange(change: Omit<TrackedChange, 'id'>): Promise<TrackedChange> {
    // Acquire mutex to prevent race conditions with concurrent storage operations
    const release = await this.acquireStorageMutex();
    try {
      const changes = await this.storage.loadTrackedChanges();

      // Check if this file is already tracked at this stage
      // A file can have BOTH staged and unstaged changes (e.g., when you edit a staged file)
      const existingIndex = changes.findIndex(
        (c: TrackedChange) => c.file === change.file && c.stage === change.stage,
      );

      let trackedChange: TrackedChange;

      if (existingIndex >= 0) {
        // Update existing change at the same stage, preserving the ID
        trackedChange = {
          ...changes[existingIndex],
          ...change,
          attribution: {
            ...changes[existingIndex].attribution,
            ...change.attribution,
            timestamp: Date.now(),
          },
        };
        changes[existingIndex] = trackedChange;
      } else {
        // No existing entry at this stage - create a new one
        // Note: We keep other stage entries for the same file because git allows
        // a file to have both staged and unstaged changes simultaneously
        trackedChange = {
          ...change,
          id: uuidv4(),
        };
        changes.push(trackedChange);
      }

      await this.storage.saveTrackedChanges(changes);

      logger.debug('Tracked file change', {
        file: trackedChange.file,
        stage: trackedChange.stage,
        workspaceId: this.workspaceId,
      });

      return trackedChange;
    } finally {
      release();
    }
  }

  /**
   * Track multiple changes at once (batch operation).
   * PERF: Single mutex acquisition and storage operation for all changes.
   * Much more efficient than calling trackChange() multiple times.
   *
   * @public
   * @param {Omit<TrackedChange, 'id'>[]} changesToTrack - Array of changes to track (without IDs)
   * @returns {Promise<TrackedChange[]>} Array of tracked changes with generated IDs
   * @throws {Error} If storage operation fails
   */
  async trackChangesBatch(changesToTrack: Omit<TrackedChange, 'id'>[]): Promise<TrackedChange[]> {
    if (!changesToTrack || changesToTrack.length === 0) {
      return [];
    }

    // Acquire mutex once for all changes
    const release = await this.acquireStorageMutex();
    try {
      const existingChanges = await this.storage.loadTrackedChanges();
      const trackedResults: TrackedChange[] = [];

      // Build lookup map for efficient duplicate detection
      // Use file:stage as key to allow same file in both staged and unstaged
      // (this happens when you edit a staged file - it has staged changes + new unstaged changes)
      const changeByFileAndStage = new Map<string, TrackedChange>();
      for (const existing of existingChanges) {
        const key = `${existing.file}:${existing.stage}`;
        changeByFileAndStage.set(key, existing);
      }

      for (const change of changesToTrack) {
        const key = `${change.file}:${change.stage}`;
        const existing = changeByFileAndStage.get(key);

        let trackedChange: TrackedChange;

        if (existing) {
          // Update existing change at the same stage, preserving the ID
          trackedChange = {
            ...existing,
            ...change,
            id: existing.id,
            attribution: {
              ...existing.attribution,
              ...change.attribution,
              timestamp: Date.now(),
            },
          };
        } else {
          // New change at this stage - generate new ID
          trackedChange = {
            ...change,
            id: uuidv4(),
          } as TrackedChange;
        }

        // Update our tracking map with file:stage key
        changeByFileAndStage.set(key, trackedChange);
        trackedResults.push(trackedChange);
      }

      // Convert map back to array - deduplicates by file:stage
      const finalChanges = Array.from(changeByFileAndStage.values());
      await this.storage.saveTrackedChanges(finalChanges);

      logger.debug('Tracked file changes (batch)', {
        count: changesToTrack.length,
        total: finalChanges.length,
        workspaceId: this.workspaceId,
      });

      return trackedResults;
    } finally {
      release();
    }
  }

  /**
   * Save multiple changes at once (bulk save).
   * OPTIMIZED: Debounced to prevent excessive disk writes.
   * Changes are batched and saved after a delay to improve performance.
   *
   * @public
   * @param {TrackedChange[]} changes - Array of changes to save
   * @param {(() => void) | undefined} onComplete - Optional callback to invoke after save completes
   * @returns {Promise<void>}
   * @example
   * ```typescript
   * await service.saveChanges([
   *   { id: '1', file: 'a.ts', stage: ChangeStage.Unstaged, ... },
   *   { id: '2', file: 'b.ts', stage: ChangeStage.Staged, ... }
   * ], () => {
   *   console.log('Save completed!');
   * });
   * ```
   */
  async saveChanges(changes: TrackedChange[], onComplete?: () => void): Promise<void> {
    if (!changes || changes.length === 0) {
      return;
    }

    // Store pending changes and callback
    this.pendingChanges = changes;
    this.saveCompleteCallback = onComplete || null;

    // Clear existing timer
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    // Set new debounce timer
    this.saveDebounceTimer = setTimeout(async () => {
      if (!this.pendingChanges) return;

      const changesToSave = this.pendingChanges;
      this.pendingChanges = null;
      const callback = this.saveCompleteCallback;
      this.saveCompleteCallback = null;

      logger.debug('Executing debounced bulk save', {
        count: changesToSave.length,
        workspaceId: this.workspaceId,
      });

      // Acquire mutex to prevent race conditions with concurrent storage operations
      const release = await this.acquireStorageMutex();
      try {
        // Load existing changes
        const existingChanges = await this.storage.loadTrackedChanges();

        logger.debug('Debounced save: loaded existing changes', {
          existingCount: existingChanges.length,
          newCount: changesToSave.length,
          workspaceId: this.workspaceId,
        });

        // Create a map for efficient lookup
        // For committed changes, include commitHash in the key to track each commit separately
        const changeMap = new Map(
          existingChanges.map((c: TrackedChange) => {
            const key = c.commitHash
              ? `${c.file}:${c.stage}:${c.commitHash}`
              : `${c.file}:${c.stage}`;
            return [key, c];
          }),
        );

        logger.debug('Debounced save: created map from existing changes', {
          mapSize: changeMap.size,
          workspaceId: this.workspaceId,
        });

        // Update or add new changes
        for (const change of changesToSave) {
          const key = change.commitHash
            ? `${change.file}:${change.stage}:${change.commitHash}`
            : `${change.file}:${change.stage}`;
          changeMap.set(key, change);
        }

        logger.debug('Debounced save: merged new changes into map', {
          mapSize: changeMap.size,
          workspaceId: this.workspaceId,
        });

        // Convert back to array and save
        const updatedChanges = Array.from(changeMap.values());
        await this.storage.saveTrackedChanges(updatedChanges);

        logger.debug('Debounced bulk save completed', {
          count: changesToSave.length,
          totalChanges: updatedChanges.length,
          workspaceId: this.workspaceId,
        });
      } finally {
        release();
      }

      // Invoke callback after save completes (outside mutex)
      if (callback) {
        callback();
      }
    }, this.SAVE_DEBOUNCE_DELAY);
  }

  /**
   * Force immediate save (bypasses debouncing).
   * Immediately saves any pending changes without waiting for the debounce delay.
   * Useful when you need to ensure changes are persisted immediately.
   *
   * @public
   * @returns {Promise<void>}
   * @throws {Error} If storage operation fails
   */
  async forceSave(): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }

    if (this.pendingChanges) {
      const changesToSave = this.pendingChanges;
      this.pendingChanges = null;

      logger.debug('Executing forced save', {
        count: changesToSave.length,
        workspaceId: this.workspaceId,
      });

      // Acquire mutex to prevent race conditions with concurrent storage operations
      const release = await this.acquireStorageMutex();
      try {
        // Load existing changes
        const existingChanges = await this.storage.loadTrackedChanges();

        // Create a map for efficient lookup
        // For committed changes, include commitHash in the key to track each commit separately
        const changeMap = new Map(
          existingChanges.map((c: TrackedChange) => {
            const key = c.commitHash
              ? `${c.file}:${c.stage}:${c.commitHash}`
              : `${c.file}:${c.stage}`;
            return [key, c];
          }),
        );

        // Update or add new changes
        for (const change of changesToSave) {
          const key = change.commitHash
            ? `${change.file}:${change.stage}:${change.commitHash}`
            : `${change.file}:${change.stage}`;
          changeMap.set(key, change);
        }

        // Convert back to array and save
        const updatedChanges = Array.from(changeMap.values());
        await this.storage.saveTrackedChanges(updatedChanges);

        logger.debug('Forced save completed', {
          count: changesToSave.length,
          totalChanges: updatedChanges.length,
          workspaceId: this.workspaceId,
        });
      } finally {
        release();
      }
    }
  }

  /**
   * Move changes to a new stage.
   * Transitions specified changes to a new stage and records the transition history.
   *
   * @public
   * @param {string[]} changeIds - IDs of changes to transition
   * @param {ChangeStage} toStage - Target stage for the changes
   * @param {Object} actor - Actor performing the transition
   * @param {string} actor.type - Type of actor ('agent' or 'user')
   * @param {string} actor.id - Unique identifier of the actor
   * @param {string} [actor.name] - Optional name of the actor
   * @param {any} [metadata] - Optional metadata for the transition
   * @returns {Promise<void>}
   * @throws {Error} If storage operation fails
   * @example
   * ```typescript
   * await service.transitionStage(
   *   ['change-1', 'change-2'],
   *   ChangeStage.Staged,
   *   { type: 'user', id: 'user-123', name: 'John Doe' }
   * );
   * ```
   */
  async transitionStage(
    changeIds: string[],
    toStage: ChangeStage,
    actor: { type: 'agent' | 'user'; id: string; name?: string },
    metadata?: any,
  ): Promise<void> {
    // Acquire mutex to prevent race conditions with concurrent storage operations
    const release = await this.acquireStorageMutex();
    try {
      const changes = await this.storage.loadTrackedChanges();
      const transitions = await this.storage.loadTransitions();

      for (const changeId of changeIds) {
        const change = changes.find((c: TrackedChange) => c.id === changeId);
        if (!change) continue;

        const fromStage = change.stage;
        change.stage = toStage;

        // Record the transition
        const transition: StageTransition = {
          id: uuidv4(),
          changeId: change.id,
          fromStage,
          toStage,
          timestamp: Date.now(),
          actor: {
            type: actor.type,
            id: actor.id,
            name: actor.name,
          },
        };

        transitions.push(transition);
      }

      await this.storage.saveTrackedChanges(changes);
      await this.storage.saveTransitions(transitions);

      logger.debug('Transitioned changes to new stage', {
        count: changeIds.length,
        toStage,
        workspaceId: this.workspaceId,
      });
    } finally {
      release();
    }
  }

  /**
   * Helper method for stage/unstage operations to reduce code duplication.
   * Handles the common logic of finding files, executing git commands, and updating storage.
   *
   * @private
   * @param {string[]} changeIds - IDs of changes to process
   * @param {ChangeStage} targetStage - The target stage (Staged or Unstaged)
   * @param {string[]} gitCommand - The git command to execute (e.g., ['add'] or ['reset', 'HEAD'])
   * @param {string} operationName - Name of the operation for logging (e.g., 'stage' or 'unstage')
   * @returns {Promise<void>}
   */
  private async executeStageOperation(
    changeIds: string[],
    targetStage: ChangeStage,
    gitCommand: string[],
    operationName: string,
  ): Promise<void> {
    // Extract file paths from changeIds that look like "git-{index}-{path}" or "git-path-{path}"
    // This handles frontend-generated synthetic IDs from both CodeChangesPanel and AcceptChangesPanel
    const filePathsFromIds = changeIds
      .filter((id) => id.startsWith('git-'))
      .map((id) => id.replace(/^git-(\d+-|path-)/, ''));

    // Acquire mutex to load changes safely
    let matchingChanges: TrackedChange[];
    let filesFromTracked: string[];

    const releaseLoad = await this.acquireStorageMutex();
    try {
      const changes = await this.storage.loadTrackedChanges();

      // Match changes by ID or by file path (for synthetic IDs)
      matchingChanges = changes.filter(
        (c: TrackedChange) =>
          changeIds.includes(c.id) ||
          filePathsFromIds.includes(c.file) ||
          filePathsFromIds.includes(c.relativePath || ''),
      );

      filesFromTracked = matchingChanges.map((c: TrackedChange) => c.file);
    } finally {
      releaseLoad();
    }

    // Find file paths from synthetic IDs that don't match any tracked changes
    // This handles the case where some files are tracked and some aren't
    const trackedPathsSet = new Set(
      matchingChanges.flatMap((c) => [c.file, c.relativePath || ''].filter(Boolean)),
    );
    const unmatchedSyntheticPaths = filePathsFromIds.filter((path) => !trackedPathsSet.has(path));

    // Combine files from tracked changes and unmatched synthetic paths
    const allFilesToProcess = [...new Set([...filesFromTracked, ...unmatchedSyntheticPaths])];

    if (allFilesToProcess.length === 0) {
      logger.debug(`No files to ${operationName}`, { changeIds });
      return;
    }

    // Execute git command for ALL files (outside mutex - can take time)
    try {
      await this.execGitCommand([...gitCommand, ...allFilesToProcess]);
    } catch (error) {
      logger.error(`Failed to ${operationName} files`, error as Error, {
        files: allFilesToProcess,
      });
      throw error;
    }

    // Acquire mutex to save changes safely
    const releaseSave = await this.acquireStorageMutex();
    try {
      // Reload changes in case they changed during git operation
      const currentChanges = await this.storage.loadTrackedChanges();

      // Build a set of files being moved to the target stage
      const filesToMove = new Set(matchingChanges.map((c) => c.file));

      // Also add files from synthetic paths
      for (const filePath of unmatchedSyntheticPaths) {
        filesToMove.add(filePath);
      }

      // Determine the source stage (opposite of target)
      const sourceStage =
        targetStage === ChangeStage.Staged ? ChangeStage.Unstaged : ChangeStage.Staged;

      // Build a map to track which files already have an entry at the target stage
      const existingAtTarget = new Map<string, TrackedChange>();
      for (const change of currentChanges) {
        if (change.stage === targetStage && filesToMove.has(change.file)) {
          existingAtTarget.set(change.file, change);
        }
      }

      // Process changes:
      // 1. If a file already exists at target stage, remove the source stage entry
      // 2. If a file doesn't exist at target stage, move the source stage entry to target
      const matchingIds = new Set(matchingChanges.map((c) => c.id));
      const updatedChanges: TrackedChange[] = [];

      for (const change of currentChanges) {
        if (matchingIds.has(change.id) && change.stage === sourceStage) {
          // This is a change we're moving
          if (existingAtTarget.has(change.file)) {
            // File already exists at target stage - skip this entry (remove it)
            // The target stage entry will remain
            continue;
          }
          // No existing entry at target stage - move this one
          updatedChanges.push({ ...change, stage: targetStage });
        } else {
          // Keep other changes as-is
          updatedChanges.push(change);
        }
      }

      // Create tracked changes for files that weren't tracked before
      const pathsNeedingNewChanges: string[] = [];
      for (const filePath of unmatchedSyntheticPaths) {
        // Check if a tracked change already exists for this path at the target stage
        const existingAtTargetStage = updatedChanges.find(
          (c) => (c.file === filePath || c.relativePath === filePath) && c.stage === targetStage,
        );

        if (existingAtTargetStage) {
          // Already exists at target stage, nothing to do
          continue;
        }

        // Check if a tracked change exists for this path at any stage
        const existingIdx = updatedChanges.findIndex(
          (c) => c.file === filePath || c.relativePath === filePath,
        );

        if (existingIdx >= 0) {
          // Update existing change to target stage
          updatedChanges[existingIdx] = {
            ...updatedChanges[existingIdx],
            stage: targetStage,
          };
        } else {
          // Need to create a new tracked change
          pathsNeedingNewChanges.push(filePath);
        }
      }

      // Create tracked changes only for files that don't have one
      const newChanges: TrackedChange[] = pathsNeedingNewChanges.map((filePath) => ({
        id: uuidv4(),
        file: filePath,
        relativePath: filePath,
        stage: targetStage,
        stats: { additions: 0, deletions: 0, binary: false },
        attribution: { manual: true, timestamp: Date.now() },
      }));

      // Save all changes (storage will also deduplicate as a safety net)
      await this.storage.saveTrackedChanges([...updatedChanges, ...newChanges]);
    } finally {
      releaseSave();
    }

    logger.debug(`${operationName} files successfully`, {
      count: allFilesToProcess.length,
      fromTracked: filesFromTracked.length,
      fromSynthetic: unmatchedSyntheticPaths.length,
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Stage changes (move from unstaged to staged) - OPTIMIZED for performance.
   * Executes git add command for the specified files and updates their stage.
   * Uses batched storage operations to minimize disk I/O.
   *
   * @public
   * @param {string[]} changeIds - IDs of changes to stage
   * @returns {Promise<void>}
   * @throws {Error} If git operation fails
   * @example
   * ```typescript
   * await service.stageChanges(['change-1', 'change-2']);
   * ```
   */
  async stageChanges(changeIds: string[]): Promise<void> {
    await this.executeStageOperation(changeIds, ChangeStage.Staged, ['add'], 'stage');
  }

  /**
   * Unstage changes (move from staged to unstaged) - OPTIMIZED for performance.
   * Executes git reset command for the specified files and updates their stage.
   * Uses batched storage operations to minimize disk I/O.
   *
   * @public
   * @param {string[]} changeIds - IDs of changes to unstage
   * @returns {Promise<void>}
   * @throws {Error} If git operation fails
   * @example
   * ```typescript
   * await service.unstageChanges(['change-1', 'change-2']);
   * ```
   */
  async unstageChanges(changeIds: string[]): Promise<void> {
    await this.executeStageOperation(changeIds, ChangeStage.Unstaged, ['reset', 'HEAD'], 'unstage');
  }

  /**
   * Get stage transitions history.
   * Retrieves all recorded stage transitions for the workspace.
   *
   * @public
   * @returns {Promise<StageTransition[]>} Array of stage transitions
   * @throws {Error} If storage operation fails
   */
  async getTransitions(): Promise<StageTransition[]> {
    return await this.storage.loadTransitions();
  }

  /**
   * Get changes filtered by criteria.
   * Retrieves tracked changes optionally filtered by stage, agent, or file pattern.
   *
   * @public
   * @param {ChangeFilter} [filter] - Optional filter criteria
   * @param {ChangeStage} [filter.stage] - Filter by change stage
   * @param {string} [filter.agentId] - Filter by agent ID
   * @param {string} [filter.filePattern] - Filter by file pattern (substring match)
   * @returns {Promise<TrackedChange[]>} Array of tracked changes matching the filter
   * @throws {Error} If storage operation fails
   * @example
   * ```typescript
   * // Get all changes
   * const allChanges = await service.getChanges();
   *
   * // Get only staged changes
   * const stagedChanges = await service.getChanges({ stage: ChangeStage.Staged });
   *
   * // Get changes by agent
   * const agentChanges = await service.getChanges({ agentId: 'agent-123' });
   * ```
   */
  async getChanges(filter?: ChangeFilter): Promise<{
    changes: TrackedChange[];
    truncated: boolean;
    totalCount: number;
  }> {
    let changes = await this.storage.loadTrackedChanges();
    const totalCount = changes.length;
    let truncated = false;

    // Apply limit to prevent OOM crashes from too many changes
    // If we have more than the max, trigger cleanup and apply limit
    if (changes.length > this.MAX_TRACKED_FILES) {
      truncated = true;
      logger.warn('Too many tracked changes, applying limit', {
        workspaceId: this.workspaceId,
        count: changes.length,
        limit: this.MAX_TRACKED_FILES,
      });
      // Trigger async cleanup to persist the reduced list
      this.cleanupOldChanges().catch((error) => {
        logger.error('Failed to cleanup old changes during getChanges', error as Error);
      });
      // Sort by timestamp (newest first) and take the most recent
      changes = changes
        .sort((a, b) => b.attribution.timestamp - a.attribution.timestamp)
        .slice(0, this.MAX_TRACKED_FILES);
    }

    if (!filter) return { changes, truncated, totalCount };

    const filteredChanges = changes.filter((change: TrackedChange) => {
      if (filter.stage && !filter.stage.includes(change.stage)) return false;
      if (filter.agentId && change.attribution?.agent?.agentId !== filter.agentId) return false;
      // sessionId and turnNumber are not part of AgentAttribution, skip these filters
      if (filter.filePattern && !change.file.includes(filter.filePattern)) return false;

      return true;
    });

    return { changes: filteredChanges, truncated, totalCount };
  }

  /**
   * Resolve blob SHAs to inline content for a single TrackedChange on demand.
   * Delegates to the storage layer's resolveContent() method.
   *
   * Call this only when content is actually needed (e.g., for diff viewing).
   * Most callers (listing changes, auto-commit, agent-commit) don't need content
   * and should NOT call this.
   *
   * @param change - The tracked change to resolve content for
   * @returns A new TrackedChange with content fields populated from git blobs
   */
  async resolveContent(change: TrackedChange): Promise<TrackedChange> {
    return this.storage.resolveContent(change);
  }

  /**
   * Get the cached isGitRepository result from storage.
   * @returns true if the workspace is inside a git repository
   */
  isGitRepo(): boolean {
    return this.storage.getIsGitRepo();
  }


  /**
   * Clear all tracked changes.
   * Removes all tracked changes from storage but preserves the workspace structure.
   *
   * @public
   * @returns {Promise<void>}
   * @example
   * ```typescript
   * // Clear all tracked changes for a workspace
   * await service.clearAllChanges();
   * ```
   */
  async clearAllChanges(): Promise<void> {
    // Acquire mutex to prevent race conditions with concurrent storage operations
    const release = await this.acquireStorageMutex();
    try {
      // Clear all changes and transitions
      await this.storage.saveTrackedChanges([]);
      await this.storage.saveTransitions([]);

      // Clear any pending changes
      this.pendingChanges = null;
      if (this.saveDebounceTimer) {
        clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = null;
      }

      logger.info('Cleared all tracked changes', { workspaceId: this.workspaceId });
    } catch (error) {
      logger.error('Failed to clear tracked changes', error as Error);
      throw error;
    } finally {
      release();
    }
  }

  /**
   * Cleanup resources.
   * OPTIMIZED: Ensure pending saves are completed before cleanup.
   * Forces save of any pending changes and clears all timers.
   * Consolidates cleanup and destroy operations to prevent resource leaks.
   *
   * @public
   * @returns {Promise<void>}
   * @example
   * ```typescript
   * // Clean up before shutting down
   * await service.cleanup();
   * ```
   */
  async cleanup(): Promise<void> {
    try {
      // Force save any pending changes first
      await this.forceSave();

      // Stop all timers (consolidates destroy() logic)
      this.destroy();

      // RPC client lifecycle is managed by remoteRPCManager - no cleanup needed here

      logger.debug('FileTrackingService cleaned up', { workspaceId: this.workspaceId });
    } catch (error) {
      logger.error('Error during FileTrackingService cleanup', error as Error);
    }
  }
}
