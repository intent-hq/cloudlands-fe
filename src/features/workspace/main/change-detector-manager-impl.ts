import { WorkspaceId as WorkspaceIdBrand } from '$shared/types/branded-ids';
import { ChangeDetectorRefactored as ChangeDetector } from './change-detector-refactored';
import {
  DiffChunk,
  FileChange,
} from '$shared/types/change-detector.types';
import { DiffSummaryRepository } from './diff-summary.repository';
import { EventEmitter } from 'events';
import { gitService } from '../../git/main/git.service';
import {
  getAllChangeHistory,
  getChangeHistoryForWorkspace,
  setChangeHistoryForWorkspace,
  bulkSetChangeHistory,
} from './change-history-persistence';
import { Logger } from '../../../shared/logger';

const logger = new Logger('ChangeDetectorManager');

import {
  CURRENT_DIFF_SUMMARY_VERSION,
  type DiffSummaryFileAction,
  type WorkspaceDiffSummary,
  type WorkspaceDiffSummaryFile,
} from '../../../shared/types';

interface WorkspaceInfo {
  id: string;
  worktreePath?: string;
  repositoryPath?: string;
  environmentConfig?: {
    type: string;
    ssh?: any;
    workspace_path?: string;
  };
}

/**
 * Manages change detectors for all active workspaces
 */
export class ChangeDetectorManager extends EventEmitter {
  private detectors: Map<string, any> = new Map();
  private pendingDetectors: Map<string, Promise<void>> = new Map(); // Track pending detector creations
  private changeHistory: Map<string, DiffChunk[]> = new Map();
  private maxHistoryPerWorkspace: number = 100;
  private readonly diffSummaryRepository: DiffSummaryRepository;
  private changeDebounceTimers: Map<string, NodeJS.Timeout> = new Map();

  // Debounce timer for saving change history to avoid repeated disk writes
  private saveHistoryDebounceTimer: NodeJS.Timeout | null = null;
  private readonly SAVE_DEBOUNCE_MS = 5000; // Save at most once every 5 seconds

  private static readonly DIFF_SUMMARY_FILE_LIMIT = 10;
  private static readonly ACTION_PRIORITY: Record<DiffSummaryFileAction, number> = {
    delete: 3,
    create: 2,
    rename: 1,
    modify: 0,
  };

  // PERF: Only load history for workspaces that are actively monitored
  // History is loaded per-workspace on demand, not all at once

  constructor(
    diffSummaryRepository: DiffSummaryRepository = new DiffSummaryRepository(),
  ) {
    super();
    this.diffSummaryRepository = diffSummaryRepository;
    // PERF: DO NOT load change history on startup - it was loading 548 workspaces
    // worth of data (potentially GB of diffs) causing immediate OOM crashes.
    // History is now loaded lazily only when getHistory() or getAllChanges() is called.
    // Performance optimization: Removed automatic backfill on startup
    // Diff summaries are now loaded on-demand when workspace is opened
    // void this.backfillDiffSummariesFromHistory();
  }

  /**
   * Backfill diff summary for a single workspace on-demand
   * Called when workspace is opened to avoid startup performance hit
   */
  async backfillWorkspaceDiffSummary(workspaceId: string): Promise<void> {
    const history = this.changeHistory.get(workspaceId);
    if (!history || history.length === 0) {
      await this.diffSummaryRepository.delete(WorkspaceIdBrand(workspaceId));
      return;
    }

    const latestChunk = history[history.length - 1];
    await this.persistDiffSummary(workspaceId, latestChunk);
  }

  /**
   * Start monitoring a workspace
   */
  async startMonitoring(workspace: WorkspaceInfo): Promise<void> {
    // Use worktreePath if available, otherwise fall back to repositoryPath
    const workspacePath = workspace.worktreePath || workspace.repositoryPath;

    if (!workspacePath) {
      logger.info(
        `[ChangeDetectorManager] Workspace ${workspace.id} has no worktree or repository path, skipping monitoring`,
      );
      return;
    }

    // Update workspace object to ensure both paths are set
    if (!workspace.worktreePath && workspace.repositoryPath) {
      workspace.worktreePath = workspace.repositoryPath;
      logger.info(
        `[ChangeDetectorManager] Using repositoryPath as worktreePath for workspace ${workspace.id}`,
      );
    }

    // Check if detector already exists
    if (this.detectors.has(workspace.id)) {
      logger.info(`[ChangeDetectorManager] Already monitoring workspace ${workspace.id}`);
      return;
    }

    // Check if detector creation is already in progress
    const pendingCreation = this.pendingDetectors.get(workspace.id);
    if (pendingCreation) {
      logger.info(
        `[ChangeDetectorManager] Detector creation already in progress for workspace ${workspace.id}`,
      );
      await pendingCreation;
      return;
    }

    // Create a promise to track this detector creation
    const creationPromise = this.createDetector(workspace);
    this.pendingDetectors.set(workspace.id, creationPromise);

    try {
      await creationPromise;
    } finally {
      // Clean up the pending promise
      this.pendingDetectors.delete(workspace.id);
    }
  }

  /**
   * Internal method to create and start a detector
   */
  private async createDetector(workspace: WorkspaceInfo): Promise<void> {
    const createStart = Date.now();
    // These should be defined since we check them in startMonitoring
    if (!workspace.worktreePath || !workspace.repositoryPath) {
      throw new Error(`Missing worktreePath or repositoryPath for workspace ${workspace.id}`);
    }

    // Backfill diff summary for this workspace on-demand (performance optimization)
    const backfillStart = Date.now();
    await this.backfillWorkspaceDiffSummary(workspace.id);
    logger.info('[ChangeDetectorManager] backfillWorkspaceDiffSummary completed', {
      workspaceId: workspace.id,
      durationMs: Date.now() - backfillStart,
    });

    const isRemote = workspace.environmentConfig?.type === 'remote';

    // Remote-workspace monitoring retires in P3-5.1 — the remote change
    // detection path is off; remote-configured workspaces skip monitoring
    // instead of throwing so open flows continue to work.
    if (isRemote) {
      logger.info(
        `[ChangeDetectorManager] Skipping monitoring for remote-configured workspace ${workspace.id} (remote change detection retired)`,
      );
      return;
    }

    logger.debug(
      `[ChangeDetectorManager] Starting monitoring for workspace ${workspace.id} (local)`,
    );

    // Get debug mode setting from store or environment variable
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const debugMode = process.env.VERBOSE_CHANGE_DETECTOR === 'true';

    // Use ChangeDetectorRefactored for local workspaces
    // FSEvents-based file watching with adaptive polling fallback (intervals from CHANGE_DETECTION_CONFIG)
    const detector: any = new ChangeDetector({
      workspaceId: workspace.id,
      workspacePath: workspace.worktreePath,
      disableFileWatcher: false,
      gitPollingOnly: false,
    });

    logger.debug(
      `[ChangeDetectorManager] Using FSEvents-based file watching with polling fallback for workspace ${workspace.id}`,
    );

    // Listen for changes
    detector.on('changes', (diffChunk: DiffChunk) => {
      this.handleChanges(workspace.id, diffChunk);
    });

    // Forward activity-log-event from individual detectors so workspace.ipc.ts
    // can dispatch them into Redux via mainDispatch(emitWorkspaceEvent).
    detector.on('activity-log-event', (event: any) => {
      this.emit('activity-log-event', { workspaceId: workspace.id, event });
    });

    detector.on('error', (error: Error) => {
      logger.error(
        `[ChangeDetectorManager] Error in detector for workspace ${workspace.id}:`,
        error,
      );
      this.emit('detector-error', { workspaceId: workspace.id, error });
    });

    // Auto-cleanup when the detector discovers its workspace directory was deleted
    detector.on('workspace-deleted', () => {
      logger.info(
        `[ChangeDetectorManager] Workspace directory deleted, cleaning up detector for ${workspace.id}`,
      );
      this.detectors.delete(workspace.id);
      this.pendingDetectors.delete(workspace.id);
      this.unloadHistory(workspace.id);
      const timer = this.changeDebounceTimers.get(workspace.id);
      if (timer) {
        clearTimeout(timer);
        this.changeDebounceTimers.delete(workspace.id);
      }
      this.emit('detector-removed', { workspaceId: workspace.id, reason: 'directory-deleted' });
    });

    // Add detector to map BEFORE starting to prevent race conditions
    // This ensures that if startMonitoring is called again before start() completes,
    // the second call will see the detector in the map and return early
    this.detectors.set(workspace.id, detector);

    logger.info(`[ChangeDetectorManager] Added detector to map for workspace ${workspace.id}`, {
      detectorCount: this.detectors.size,
      detectorKeys: Array.from(this.detectors.keys()),
    });

    try {
      const detectorStartTime = Date.now();
      await detector.start();

      logger.info(
        `[ChangeDetectorManager] Monitoring started for workspace ${workspace.id} using ChangeDetector`,
        {
          detectorCount: this.detectors.size,
          detectorKeys: Array.from(this.detectors.keys()),
          detectorStartDurationMs: Date.now() - detectorStartTime,
          totalCreateDurationMs: Date.now() - createStart,
        },
      );
    } catch (error) {
      logger.error(
        `[ChangeDetectorManager] Failed to start monitoring for workspace ${workspace.id}:`,
        (error as Error).message || error,
      );

      // Remove from map on failure
      this.detectors.delete(workspace.id);

      logger.warn(
        `[ChangeDetectorManager] Removed detector from map due to failure for workspace ${workspace.id}`,
        {
          detectorCount: this.detectors.size,
          detectorKeys: Array.from(this.detectors.keys()),
        },
      );

      // Emit error but don't crash the app
      this.emit('detector-error', { workspaceId: workspace.id, error });
    }
  }

  /**
   * Stop monitoring a workspace
   */
  async stopMonitoring(workspaceId: string): Promise<void> {
    const detector = this.detectors.get(workspaceId);
    if (!detector) {
      // Also check and remove from pending detectors
      this.pendingDetectors.delete(workspaceId);
      return;
    }

    logger.info(`[ChangeDetectorManager] Stopping monitoring for workspace ${workspaceId}`);

    // Clear any pending debounce timer
    const timer = this.changeDebounceTimers.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      this.changeDebounceTimers.delete(workspaceId);
    }

    await detector.stop();
    this.detectors.delete(workspaceId);

    // Also remove from pending detectors if it exists
    this.pendingDetectors.delete(workspaceId);

    // PERF: Unload history from memory when workspace closes (keeps on disk)
    this.unloadHistory(workspaceId);

    logger.info(`[ChangeDetectorManager] Monitoring stopped for workspace ${workspaceId}`);
  }

  /**
   * Get change detector for a workspace
   */
  getChangeDetector(workspaceId: string): any {
    return this.detectors.get(workspaceId);
  }

  /**
   * Get change detector for a workspace (alias for getChangeDetector)
   */
  getDetector(workspaceId: string): any {
    return this.getChangeDetector(workspaceId);
  }

  /**
   * Stop all detectors
   */
  async stopAll(): Promise<void> {
    logger.info('[ChangeDetectorManager] Stopping all detectors');

    const promises = Array.from(this.detectors.keys()).map((id) => this.stopMonitoring(id));

    await Promise.all(promises);

    logger.info('[ChangeDetectorManager] All detectors stopped');
  }

  /**
   * Dispose all resources and clean up
   */
  async dispose(): Promise<void> {
    logger.info('[ChangeDetectorManager] Disposing all resources');

    // Stop all detectors
    await this.stopAll();

    // Clear all debounce timers
    for (const timer of this.changeDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.changeDebounceTimers.clear();

    // Clear save history debounce timer and save immediately
    if (this.saveHistoryDebounceTimer) {
      clearTimeout(this.saveHistoryDebounceTimer);
      this.saveHistoryDebounceTimer = null;
    }
    // Save any pending changes before disposing
    void this.doSaveChangeHistory();

    // Clear all pending detectors
    this.pendingDetectors.clear();

    // Dispose each detector
    for (const detector of this.detectors.values()) {
      if ('dispose' in detector && typeof detector.dispose === 'function') {
        detector.dispose();
      }
    }

    // Clear all maps
    this.detectors.clear();
    this.changeHistory.clear();

    // Remove all event listeners
    this.removeAllListeners();

    logger.info('[ChangeDetectorManager] All resources disposed');
  }

  /**
   * Handle detected changes with debouncing
   */
  private handleChanges(workspaceId: string, diffChunk: DiffChunk): void {
    // Add null check to prevent undefined data issues
    if (!diffChunk) {
      logger.warn(
        `[ChangeDetectorManager] Received undefined diffChunk for workspace ${workspaceId}`,
      );
      return;
    }

    // Check if we're still monitoring this workspace (prevent processing during deletion)
    if (!this.detectors.has(workspaceId)) {
      logger.debug(`[ChangeDetectorManager] Ignoring changes for stopped workspace ${workspaceId}`);
      return;
    }

    // Clear existing debounce timer for this workspace
    const existingTimer = this.changeDebounceTimers.get(workspaceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set up debounced processing
    const timer = setTimeout(() => {
      this.processChanges(workspaceId, diffChunk);
      this.changeDebounceTimers.delete(workspaceId);
    }, 100); // OPTIMIZED: 100ms debounce for snappier UX

    this.changeDebounceTimers.set(workspaceId, timer);
  }

  /**
   * Process changes after debouncing
   */
  private processChanges(workspaceId: string, diffChunk: DiffChunk): void {
    logger.debug(`[ChangeDetectorManager] Processing changes for workspace ${workspaceId}`);
    logger.debug(`[ChangeDetectorManager] Changes detected in workspace ${workspaceId}:`, {
      source: diffChunk.provenance?.source,
      fileCount: diffChunk.files?.length || 0,
      files: diffChunk.files?.map((f) => `${f.action}: ${f.path}`) || [],
    });

    if (diffChunk.provenance?.source === 'agent') {
      logger.info(
        `[ChangeDetectorManager] Agent changes detected from ${diffChunk.provenance.agentName} (turn ${(diffChunk.provenance as any).turnNumber})`,
      );
    }

    // Clear git service cache so next status call gets fresh data
    gitService.clearStatusCache(WorkspaceIdBrand(workspaceId));
    logger.debug(`[ChangeDetectorManager] Cleared git cache for workspace ${workspaceId}`);

    // Add to history
    this.addToHistory(workspaceId, diffChunk);
    logger.debug('[ChangeDetectorManager] Added diffChunk to history');

    void this.persistDiffSummary(workspaceId, diffChunk);

    // Emit to IPC
    logger.debug('[ChangeDetectorManager] Emitting workspace-changes event');
    this.emit('workspace-changes', {
      workspaceId,
      diffChunk,
    });

    // Save to store
    this.saveChangeHistory();
    logger.debug('[ChangeDetectorManager] Saved change history');
  }

  // Note: handleActivityLogEvent was removed — activity-log-event events are
  // now forwarded by each detector listener (see startMonitoring) and dispatched
  // into Redux via workspace.ipc.ts → mainDispatch(emitWorkspaceEvent).

  /**
   * Add diff chunk to history
   */
  private addToHistory(workspaceId: string, diffChunk: DiffChunk): void {
    let history = this.changeHistory.get(workspaceId);
    if (!history) {
      history = [];
      this.changeHistory.set(workspaceId, history);
    }

    history.push(diffChunk);

    // Limit history size
    if (history.length > this.maxHistoryPerWorkspace) {
      history.shift();
    }
  }

  /**
   * Get change history for a workspace
   * PERF: Only loads history for the specific workspace requested
   */
  async getHistory(workspaceId: string, limit?: number): Promise<DiffChunk[]> {
    // PERF: Load history for this specific workspace if not in memory
    if (!this.changeHistory.has(workspaceId)) {
      await this.loadWorkspaceHistory(workspaceId);
    }
    const history = this.changeHistory.get(workspaceId) || [];
    if (limit) {
      return history.slice(-limit);
    }
    return history;
  }

  /**
   * Get all changes for a workspace
   * PERF: Only loads history for the specific workspace requested
   */
  async getAllChanges(workspaceId: string): Promise<DiffChunk[]> {
    // PERF: Load history for this specific workspace if not in memory
    if (!this.changeHistory.has(workspaceId)) {
      await this.loadWorkspaceHistory(workspaceId);
    }
    return this.changeHistory.get(workspaceId) || [];
  }

  /**
   * Clear history for a workspace (from memory and disk)
   */
  async clearHistory(workspaceId: string): Promise<void> {
    this.changeHistory.delete(workspaceId);
    await this.saveWorkspaceHistory(workspaceId, []);
  }

  /**
   * Unload history for a workspace from memory (keeps on disk)
   * PERF: Called when workspace is closed to free memory
   */
  unloadHistory(workspaceId: string): void {
    this.changeHistory.delete(workspaceId);
    logger.debug('[ChangeDetectorManager] Unloaded history from memory', { workspaceId });
  }

  /**
   * Capture file snapshots before agent makes changes
   */
  async captureFileSnapshots(workspaceId: string, filePaths: string[]): Promise<void> {
    const detector = this.detectors.get(workspaceId);
    if (!detector) {
      logger.warn(
        `[ChangeDetectorManager] No detector for workspace ${workspaceId}, cannot capture snapshots`,
      );
      return;
    }

    await detector.captureFileSnapshots(filePaths);
  }

  /**
   * Mark an agent as actively modifying files in a workspace
   */
  markAgentActive(
    workspaceId: string,
    agentName: string,
    durationMs?: number,
    sessionId?: string,
    turnNumber?: number,
  ): boolean {
    logger.info(
      `[ChangeDetectorManager] markAgentActive called for workspace ${workspaceId}, agent ${agentName}`,
      {
        detectorsCount: this.detectors.size,
        hasDetector: this.detectors.has(workspaceId),
        detectorKeys: Array.from(this.detectors.keys()),
      },
    );

    const detector = this.detectors.get(workspaceId);
    if (!detector) {
      logger.warn(
        `[ChangeDetectorManager] No detector for workspace ${workspaceId}, cannot mark agent active`,
      );
      return false;
    }

    const markFn = (detector as any).markAgentActive;

    if (typeof markFn === 'function') {
      logger.info(
        `[ChangeDetectorManager] Calling markAgentActive on detector for workspace ${workspaceId}`,
      );
      markFn.call(detector, agentName, durationMs, sessionId, turnNumber);
      return true;
    }

    logger.warn(
      `[ChangeDetectorManager] Detector for workspace ${workspaceId} does not support markAgentActive`,
    );
    return false;
  }

  /**
   * Start tracking agent execution for a workspace
   */
  startAgentExecution(
    workspaceId: string,
    agentName: string,
    sessionId?: string,
    turnNumber?: number,
  ): boolean {
    const detector = this.detectors.get(workspaceId);
    if (!detector) {
      logger.warn(`[ChangeDetectorManager] No detector for workspace ${workspaceId}`);
      return false;
    }

    const startFn = (detector as any).startAgentExecution;
    if (typeof startFn === 'function') {
      startFn.call(detector, agentName, sessionId, turnNumber);
      return true;
    }

    logger.debug('startAgentExecution: Detector does not support this method', {
      workspaceId,
      agentName,
      detectorType: detector.constructor?.name,
    });
    return false;
  }

  /**
   * Mark files as modified by the agent
   */
  markAgentModifiedFiles(workspaceId: string, files: string[]): boolean {
    const detector = this.detectors.get(workspaceId);
    if (!detector) {
      logger.debug('markAgentModifiedFiles: No detector for workspace', {
        workspaceId,
        fileCount: files.length,
      });
      return false;
    }

    const markFn = (detector as any).markAgentModifiedFiles;
    if (typeof markFn === 'function') {
      markFn.call(detector, files);
      return true;
    }

    logger.debug('markAgentModifiedFiles: Detector does not support this method', {
      workspaceId,
      detectorType: detector.constructor?.name,
    });
    return false;
  }

  /**
   * Stop agent execution and emit queued changes
   */
  async stopAgentExecution(workspaceId: string): Promise<boolean> {
    const detector = this.detectors.get(workspaceId);
    if (!detector) {
      logger.debug('stopAgentExecution: No detector for workspace', { workspaceId });
      return false;
    }

    const stopFn = (detector as any).stopAgentExecution;
    if (typeof stopFn === 'function') {
      await stopFn.call(detector);
      return true;
    }

    logger.debug('stopAgentExecution: Detector does not support this method', {
      workspaceId,
      detectorType: detector.constructor?.name,
    });
    return false;
  }

  /**
   * Track agent changes explicitly
   */
  async trackAgentChanges(
    workspaceId: string,
    files: FileChange[],
    agentName: string,
    messageId?: string,
    threadId?: string,
    turnNumber?: number,
    sessionId?: string,
    model?: string,
    temperature?: number,
    reasoning?: string,
  ): Promise<DiffChunk | null> {
    logger.info(
      `[ChangeDetectorManager] trackAgentChanges called for workspace ${workspaceId}, agent ${agentName}, ${files.length} files`,
    );

    const detector = this.detectors.get(workspaceId);
    if (!detector) {
      logger.error(
        `[ChangeDetectorManager] No detector for workspace ${workspaceId}, cannot track agent changes`,
      );
      return null;
    }

    logger.info(
      `[ChangeDetectorManager] Found detector for workspace ${workspaceId}, calling trackAgentChanges`,
    );

    const diffChunk = await detector.trackAgentChanges(
      files,
      agentName,
      messageId,
      threadId,
      turnNumber,
      sessionId,
      model,
      temperature,
      reasoning,
    );

    logger.info(
      `[ChangeDetectorManager] trackAgentChanges returned diffChunk with id: ${diffChunk?.id}`,
    );

    this.addToHistory(workspaceId, diffChunk);
    logger.debug(`[ChangeDetectorManager] Added diffChunk to history for workspace ${workspaceId}`);

    this.saveChangeHistory();
    // Note: saveChangeHistory is debounced, actual save log is at debug level

    if (diffChunk) {
      void this.persistDiffSummary(workspaceId, diffChunk);
    }

    return diffChunk;
  }

  /**
   * Get current uncommitted changes for a workspace
   */
  async getCurrentChanges(workspaceId: string): Promise<DiffChunk | null> {
    const detector = this.detectors.get(workspaceId);
    if (!detector) {
      logger.debug('getCurrentChanges: No detector for workspace', { workspaceId });
      return null;
    }

    return await detector.getCurrentChanges();
  }

  /**
   * Trigger an immediate git check for a workspace
   * Use this when you know changes have happened (e.g., after file edit, terminal command, etc.)
   */
  triggerImmediateCheck(workspaceId: string, reason?: string): void {
    // Log current state of detectors for debugging
    logger.debug('triggerImmediateCheck called', {
      workspaceId,
      reason,
      hasDetector: this.detectors.has(workspaceId),
      detectorKeys: Array.from(this.detectors.keys()),
      detectorCount: this.detectors.size,
    });

    const detector = this.detectors.get(workspaceId);
    if (!detector) {
      logger.warn('No detector found for workspace', {
        workspaceId,
        availableDetectors: Array.from(this.detectors.keys()),
      });
      return;
    }

    // Call triggerImmediateCheck on the detector
    // Both ChangeDetectorRefactored and legacy ChangeDetector should have this method
    if (typeof detector.triggerImmediateCheck === 'function') {
      detector.triggerImmediateCheck(reason);
    } else {
      logger.warn('Detector does not support immediate check', {
        workspaceId,
        detectorType: detector.constructor.name,
      });
    }
  }
  private async persistDiffSummary(workspaceId: string, diffChunk: DiffChunk): Promise<void> {
    try {
      if (!diffChunk?.files || diffChunk.files.length === 0) {
        await this.diffSummaryRepository.delete(WorkspaceIdBrand(workspaceId));
        logger.debug(
          `[ChangeDetectorManager] Cleared diff summary for workspace ${workspaceId} (no files)`,
        );
        return;
      }

      const summary = this.buildDiffSummary(diffChunk);

      if (
        summary.totalFiles === 0 &&
        summary.totalAdditions === 0 &&
        summary.totalDeletions === 0
      ) {
        await this.diffSummaryRepository.delete(WorkspaceIdBrand(workspaceId));
        logger.debug(
          `[ChangeDetectorManager] Cleared diff summary for workspace ${workspaceId} (empty summary)`,
        );
        return;
      }

      await this.diffSummaryRepository.save(WorkspaceIdBrand(workspaceId), summary);
      logger.debug(`[ChangeDetectorManager] Saved diff summary for workspace ${workspaceId}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(
        `[ChangeDetectorManager] Failed to persist diff summary for workspace ${workspaceId}`,
        err,
      );
    }
  }

  private buildDiffSummary(diffChunk: DiffChunk): WorkspaceDiffSummary {
    const aggregates = new Map<string, WorkspaceDiffSummaryFile>();
    const files = Array.isArray(diffChunk.files) ? diffChunk.files : [];

    for (const file of files) {
      if (!file || !file.path) {
        continue;
      }

      const additions = Math.max(0, file.additions ?? 0);
      const deletions = Math.max(0, file.deletions ?? 0);
      const action = this.normalizeDiffAction(file.action);

      const existing = aggregates.get(file.path);
      if (existing) {
        existing.additions += additions;
        existing.deletions += deletions;
        existing.action = this.resolveDiffActionPriority(existing.action, action);
      } else {
        aggregates.set(file.path, {
          path: file.path,
          action,
          additions,
          deletions,
        });
      }
    }

    const aggregateValues = Array.from(aggregates.values());

    let totalAdditions = 0;
    let totalDeletions = 0;
    for (const entry of aggregateValues) {
      totalAdditions += entry.additions;
      totalDeletions += entry.deletions;
    }

    aggregateValues.sort((a, b) => {
      const aMagnitude = a.additions + a.deletions;
      const bMagnitude = b.additions + b.deletions;
      return bMagnitude - aMagnitude;
    });

    const filesForSummary = aggregateValues.slice(0, ChangeDetectorManager.DIFF_SUMMARY_FILE_LIMIT);

    return {
      schemaVersion: CURRENT_DIFF_SUMMARY_VERSION,
      updatedAt: diffChunk.timestamp ?? new Date().toISOString(),
      totalFiles: aggregateValues.length,
      totalAdditions,
      totalDeletions,
      files: filesForSummary,
    };
  }

  private normalizeDiffAction(action?: FileChange['action'] | string): DiffSummaryFileAction {
    if (!action) {
      return 'modify';
    }

    const normalized = String(action).toLowerCase();

    if (
      normalized === 'create' ||
      normalized === 'add' ||
      normalized === 'added' ||
      normalized === 'new'
    ) {
      return 'create';
    }

    if (normalized === 'delete' || normalized === 'remove' || normalized === 'removed') {
      return 'delete';
    }

    if (normalized === 'rename' || normalized === 'renamed') {
      return 'rename';
    }

    return 'modify';
  }

  private resolveDiffActionPriority(
    current: DiffSummaryFileAction,
    incoming: DiffSummaryFileAction,
  ): DiffSummaryFileAction {
    return ChangeDetectorManager.ACTION_PRIORITY[incoming] >
      ChangeDetectorManager.ACTION_PRIORITY[current]
      ? incoming
      : current;
  }

  private async backfillDiffSummariesFromHistory(): Promise<void> {
    if (this.changeHistory.size === 0) {
      return;
    }

    for (const [workspaceId, history] of this.changeHistory.entries()) {
      if (!Array.isArray(history) || history.length === 0) {
        await this.diffSummaryRepository.delete(WorkspaceIdBrand(workspaceId));
        continue;
      }

      const latestChunk = history[history.length - 1];
      await this.persistDiffSummary(workspaceId, latestChunk);
    }
  }

  /**
   * PERF: Strip large content fields from DiffChunks before storing
   * This prevents storing GB of file contents in history
   */
  private stripLargeContent(chunks: DiffChunk[]): DiffChunk[] {
    return chunks.map((chunk) => ({
      ...chunk,
      files: chunk.files.map((file) => ({
        ...file,
        // PERF: Remove large content fields - keep only metadata and small diffs
        diff: file.diff && file.diff.length > 5000 ? undefined : file.diff,
        content: undefined, // Always strip full content
        oldContent: undefined, // Always strip old content
      })),
    }));
  }

  /**
   * PERF: Load history for a SINGLE workspace from disk
   * Only loads what's needed, not all 500+ workspaces
   */
  private async loadWorkspaceHistory(workspaceId: string): Promise<void> {
    try {
      const stored = await getChangeHistoryForWorkspace(workspaceId);
      if (stored.length > 0) {
        this.changeHistory.set(workspaceId, stored);
        logger.debug('[ChangeDetectorManager] Loaded history for workspace', {
          workspaceId,
          chunks: stored.length,
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('[ChangeDetectorManager] Error loading workspace history:', err);
    }
  }

  /**
   * PERF: Save history for a SINGLE workspace to disk
   * Reads existing data, updates just this workspace, writes back
   */
  private async saveWorkspaceHistory(workspaceId: string, chunks: DiffChunk[]): Promise<void> {
    try {
      const stripped = chunks.length === 0 ? [] : this.stripLargeContent(chunks);
      await setChangeHistoryForWorkspace(workspaceId, stripped);
      logger.debug('[ChangeDetectorManager] Saved history for workspace', {
        workspaceId,
        chunks: chunks.length,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('[ChangeDetectorManager] Error saving workspace history:', err);
    }
  }

  /**
   * Save change history to store (debounced to avoid repeated disk writes)
   * PERF: Only saves workspaces currently in memory
   */
  private saveChangeHistory(): void {
    // Clear any existing debounce timer
    if (this.saveHistoryDebounceTimer) {
      clearTimeout(this.saveHistoryDebounceTimer);
    }

    // Schedule the save with debouncing
    this.saveHistoryDebounceTimer = setTimeout(() => {
      this.saveHistoryDebounceTimer = null;
      void this.doSaveChangeHistory();
    }, this.SAVE_DEBOUNCE_MS);
  }

  /**
   * Actually save change history to store (called after debounce)
   * PERF: Only saves workspaces currently in memory, preserves others on disk
   */
  private async doSaveChangeHistory(): Promise<void> {
    try {
      // Push only the workspaces we have in memory (stripped) to the daemon;
      // the persistence layer preserves other workspaces already on disk.
      const stripped: [string, DiffChunk[]][] = [];
      for (const [workspaceId, chunks] of this.changeHistory.entries()) {
        stripped.push([workspaceId, this.stripLargeContent(chunks)]);
      }
      await bulkSetChangeHistory(stripped);
      const allHistory = await getAllChangeHistory();
      logger.debug('[ChangeDetectorManager] Change history saved to disk', {
        inMemory: this.changeHistory.size,
        onDisk: Object.keys(allHistory).length,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('[ChangeDetectorManager] Error saving change history:', err);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    activeDetectors: number;
    totalWorkspaces: number;
    totalChanges: number;
    } {
    let totalChanges = 0;
    for (const history of this.changeHistory.values()) {
      totalChanges += history.length;
    }

    return {
      activeDetectors: this.detectors.size,
      totalWorkspaces: this.changeHistory.size,
      totalChanges,
    };
  }

  /**
   * Check if a workspace is being monitored
   */
  isMonitoring(workspaceId: string): boolean {
    return this.detectors.has(workspaceId);
  }

  /**
   * Get list of monitored workspace IDs
   */
  getMonitoredWorkspaces(): string[] {
    return Array.from(this.detectors.keys());
  }

  /**
   * Add a timeline entry to a workspace
   */
  addTimelineEntry(
    workspaceId: string,
    eventType: string,
    description: string,
    actor?: { type: string; name?: string; id?: string; email?: string },
    metadata?: any,
  ): void {
    try {
      logger.info(`[ChangeDetectorManager] addTimelineEntry called for workspace ${workspaceId}`);
      logger.info('[ChangeDetectorManager] Timeline entry details:', {
        eventType,
        description,
        actor: actor?.name || actor?.type,
        metadataKeys: metadata ? Object.keys(metadata) : [],
      });

      // Emit timeline update event
      this.emit('timeline-entry-added', {
        workspaceId,
        eventType,
        description,
        actor,
        metadata,
      });

      logger.info(
        `[ChangeDetectorManager] Timeline entry emitted for workspace ${workspaceId}: ${eventType}`,
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('[ChangeDetectorManager] Error adding timeline entry:', err);
    }
  }
}

// Export singleton instance
export const changeDetectorManager = new ChangeDetectorManager(new DiffSummaryRepository());
