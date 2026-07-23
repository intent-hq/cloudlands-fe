/**
 * Refactored Change Detector
 *
 * A simplified change detector that coordinates the modular components.
 * This replaces the monolithic 3500+ line ChangeDetector with a cleaner architecture.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/logger';
import { type WorkspaceEvent } from '../../events/types';
import { CHANGE_DETECTION_CONFIG } from './change-detection/detection.config';
import type { Actor } from '../../../shared/types';
import type {
  FileChange,
  DiffChunk,
} from '$shared/types/change-detector.types';

// Re-export types for compatibility
export type {
  FileChange,
  DiffChunk,
} from '$shared/types/change-detector.types';

// Import modular components
import {
  FileWatcher,
  ChangeProcessor,
  EventCoordinator,
  SnapshotManager,
  type GitStatus,
  type FileWatchEvent,
  type ProcessedChange,
} from './change-detection';
import { isBinaryExtension } from '../../../shared/binary-file-extensions';

/**
 * Maximum file size (in bytes) for reading content into memory for tracking.
 * Files larger than this will be tracked without inline content.
 */
const MAX_TRACKABLE_CONTENT_SIZE = 1 * 1024 * 1024; // 1 MB
import { GitOperationsSafe as GitOperations } from './change-detection/git-operations-safe-wrapper';

// Import performance monitor
import { PerformanceMonitor } from '../../file-tracking/performance-monitor';

// Import adaptive polling manager
import { AdaptivePollingManager } from './change-detection/adaptive-polling-manager';
import { isKeychainAccessSuppressed } from '../../../shared/git/keychain-suppression';
import { sendToWorkspaceWindows } from '../../system/main/system.ipc';

const logger = new Logger('ChangeDetector');

export interface ChangeDetectorOptions {
  workspaceId: string;
  workspacePath: string;
  isRemote?: boolean;
  gitPollingOnly?: boolean;
  disableFileWatcher?: boolean;
}

export interface ChangeDetectorStats {
  isRunning: boolean;
  gitPollingEnabled: boolean;
  fileWatcherEnabled: boolean;
  lastGitPoll: string | null;
  totalChangesDetected: number;
  totalEventsEmitted: number;
  currentActor: Actor | null;
}

export class ChangeDetectorRefactored extends EventEmitter {
  private workspaceId: string;
  private workspacePath: string;
  private isRemote: boolean;
  private isRunning: boolean = false;

  // Modular components
  private gitOps: GitOperations;
  private fileWatcher: FileWatcher;
  private changeProcessor: ChangeProcessor;
  private eventCoordinator: EventCoordinator;
  private snapshotManager: SnapshotManager;

  // Services
  private performanceMonitor: PerformanceMonitor;
  private adaptivePolling: AdaptivePollingManager;
  private thresholdExceededHandler: ((alerts: string[]) => void) | null = null;
  private resourcesCleanedUp = false;

  // Configuration
  private config = CHANGE_DETECTION_CONFIG;
  private gitPollingOnly: boolean;
  private disableFileWatcher: boolean;

  // Polling
  private gitPollingTimer: NodeJS.Timeout | null = null;
  private debouncedPollTimer: NodeJS.Timeout | null = null;
  private intervalChangedHandler: (({ newInterval }: { newInterval: number }) => void) | null =
    null;
  private fileWatcherActiveOnStart: boolean = false;
  private readonly DEBOUNCE_DELAY_MS = 300;
  private readonly FOLLOW_UP_POLL_INTERVAL_MS = 2000;
  private readonly FOLLOW_UP_POLL_WINDOW_MS = 15000;
  private lastGitPoll: string | null = null;
  private lastGitStatus: GitStatus | null = null;
  /**
   * Serialized form of the last processed git status. Used to short-circuit a
   * poll when the status is byte-identical to the previous one, avoiding the
   * expensive detectGitChanges() (batch diffs + file reads) and downstream
   * event dispatch when nothing actually changed.
   */
  private lastGitStatusSerialized: string | null = null;
  private gitPollErrorCount: number = 0;
  private lastActivityTime: number = Date.now();
  private isPollingGitStatus: boolean = false;
  private pollRequestedWhilePolling: boolean = false;
  private followUpPollTimer: NodeJS.Timeout | null = null;
  private followUpPollUntil: number = 0;
  private readonly IDLE_THRESHOLD = 60000; // 1 minute of inactivity
  private isIdle = false;

  // Statistics
  private stats = {
    totalChangesDetected: 0,
    totalEventsEmitted: 0,
  };

  constructor(options: ChangeDetectorOptions) {
    super();

    this.workspaceId = options.workspaceId;
    this.workspacePath = options.workspacePath;
    this.isRemote = options.isRemote || false;
    this.gitPollingOnly = options.gitPollingOnly ?? this.config.gitPollingOnly;
    this.disableFileWatcher = options.disableFileWatcher ?? this.config.disableFileWatcher;

    // Initialize components
    this.gitOps = new GitOperations(this.workspacePath);
    this.fileWatcher = new FileWatcher(this.workspaceId, this.workspacePath);
    this.changeProcessor = new ChangeProcessor(this.workspacePath, this.workspaceId);
    this.eventCoordinator = new EventCoordinator(this.workspaceId);
    this.snapshotManager = new SnapshotManager(this.workspacePath);
    this.performanceMonitor = PerformanceMonitor.getInstance();

    // Initialize adaptive polling with custom config for this workspace
    // Cap maxInterval at 15s so external changes (patches, git commands) are
    // detected within a reasonable time even when idle. The previous 45s max
    // (gitPollingIntervalLargeRepo * 3) caused unacceptable staleness.
    this.adaptivePolling = AdaptivePollingManager.getInstance({
      minInterval: this.config.gitPollingInterval,
      maxInterval: this.config.gitPollingIntervalLargeRepo, // 15 seconds max (was 45s)
      idleThreshold: this.IDLE_THRESHOLD,
    });

    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for components
   */
  private setupEventHandlers(): void {
    // File watcher events
    this.fileWatcher.on('file-change', (event: FileWatchEvent) => {
      this.handleFileWatchEvent(event);
    });

    this.fileWatcher.on('error', (error: Error) => {
      logger.error('File watcher error:', error);
      this.emit('error', error);
    });

    // When the OS file-event queue overflows (e.g. macOS FSEvents drop),
    // the FileWatcher emits 'rescan-required'.  We must re-poll git so that
    // any changes made while events were lost are still detected.
    this.fileWatcher.on('rescan-required', () => {
      logger.info('File watcher rescan required - triggering immediate git poll', {
        workspaceId: this.workspaceId,
      });
      // Invalidate git status cache so the poll reads fresh state from disk
      this.gitOps.invalidateCache();
      // Reset activity time so adaptive polling uses a short interval
      this.lastActivityTime = Date.now();
      this.adaptivePolling.recordActivity(1, true);
      this.triggerImmediateCheck('rescan-required').catch((error) => {
        logger.error('Failed to poll git status after rescan', error as Error, {
          workspaceId: this.workspaceId,
        });
      });
    });

    // Change processor events
    this.changeProcessor.on('changes-batch', (changes: ProcessedChange[]) => {
      this.handleChangesBatch(changes);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.changeProcessor.on('workspace-event', (event: WorkspaceEvent) => {
      this.stats.totalEventsEmitted++;
    });

    // Event coordinator events
    this.eventCoordinator.on('events-emitted', (events: WorkspaceEvent[]) => {
      this.emit('events-emitted', events);
    });

    // Forward activity-log-event from EventCoordinator
    this.eventCoordinator.on('activity-log-event', (data: any) => {
      this.emit('activity-log-event', data);
    });

    // Performance threshold events - trigger cleanup when memory is high
    this.thresholdExceededHandler = (alerts: string[]) => {
      const memoryAlert = alerts.find((a) => a.includes('Memory usage'));
      if (memoryAlert) {
        // Use debug level - PerformanceMonitor already logs the warning (throttled)
        logger.debug('Memory threshold exceeded, triggering cleanup', { alerts });
        this.triggerMemoryCleanup();
      }
    };
    this.performanceMonitor.on('threshold-exceeded', this.thresholdExceededHandler);
  }

  /**
   * Trigger memory cleanup when thresholds are exceeded
   */
  private triggerMemoryCleanup(): void {
    // Prune old snapshots (keep only last hour)
    const pruned = this.snapshotManager.pruneOldSnapshots(60 * 60 * 1000);
    if (pruned > 0) {
      logger.info('Pruned old snapshots during memory cleanup', { pruned });
    }

    // Emit event for other components to clean up
    this.emit('memory-cleanup-requested');

    // NOTE: Do NOT call global.gc() here. Multiple independent GC call sites
    // can trigger V8 garbage collection at unsafe moments while async resources
    // (child processes, streams) are being torn down, causing native SIGSEGV crashes
    // in AsyncWrap::~AsyncWrap().
  }

  /**
   * Start the change detector
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Change detector is already running');
      return;
    }

    const startTime = Date.now();
    try {
      logger.info('Starting change detector', {
        workspaceId: this.workspaceId,
        workspacePath: this.workspacePath,
        gitPollingOnly: this.gitPollingOnly,
      });

      // Initialize components
      const initStart = Date.now();
      await this.changeProcessor.initialize();
      logger.info('changeProcessor.initialize completed', {
        workspaceId: this.workspaceId,
        durationMs: Date.now() - initStart,
      });

      // Start performance monitoring
      this.performanceMonitor.start(5000);

      // Start file watcher if enabled
      if (!this.gitPollingOnly && !this.disableFileWatcher) {
        const watcherStart = Date.now();
        await this.fileWatcher.start();
        logger.info('fileWatcher.start completed', {
          workspaceId: this.workspaceId,
          durationMs: Date.now() - watcherStart,
        });
      }

      // Fall back to periodic git polling if file watcher is not active.
      // FileWatcher.start() may silently decline to start (e.g., if CHANGE_DETECTION_CONFIG
      // disables watching independently of the constructor options).
      // This ensures we always have at least one change detection mechanism.
      const fileWatcherActive = this.fileWatcher.getStats().isWatching;
      this.fileWatcherActiveOnStart = fileWatcherActive;
      if (fileWatcherActive) {
        this.performanceMonitor.incrementCounter('activeWatchers', 1);
      } else {
        logger.info('File watcher inactive after startup; using git polling fallback', {
          workspaceId: this.workspaceId,
          workspacePath: this.workspacePath,
        });
        this.startGitPolling();
        // Register interval change listener for git polling restarts.
        // Only needed when periodic polling is active.
        if (!this.intervalChangedHandler) {
          this.intervalChangedHandler = ({ newInterval }: { newInterval: number }) => {
            logger.debug('Polling interval changed - restarting git polling', { newInterval });
            if (this.isRunning && this.gitPollingTimer) {
              this.stopGitPolling();
              this.startGitPolling();
            }
          };
          this.adaptivePolling.on('intervalChanged', this.intervalChangedHandler);
        }
      }

      // Mark as running BEFORE taking snapshot so workspace is usable immediately
      this.isRunning = true;
      this.emit('started');

      logger.info('Change detector started successfully', {
        workspaceId: this.workspaceId,
        totalDurationMs: Date.now() - startTime,
      });

      // Take initial snapshot in background (non-blocking)
      // This allows the workspace to be usable immediately while snapshotting
      const snapshotStart = Date.now();
      this.takeInitialSnapshot()
        .then(() => {
          logger.info('takeInitialSnapshot completed (background)', {
            workspaceId: this.workspaceId,
            durationMs: Date.now() - snapshotStart,
          });
        })
        .catch((err) => {
          logger.warn('Background initial snapshot failed', {
            workspaceId: this.workspaceId,
            error: (err as Error).message,
          });
        });
    } catch (error) {
      logger.error('Failed to start change detector:', error);
      try {
        await this.cleanupRuntimeResources();
      } catch (cleanupError) {
        logger.warn('Failed to clean up after change detector startup failure', {
          workspaceId: this.workspaceId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
      throw error;
    }
  }

  /**
   * Stop the change detector
   */
  async stop(): Promise<void> {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      logger.info('Stopping change detector');
    }

    await this.cleanupRuntimeResources();

    if (!wasRunning) return;

    this.isRunning = false;
    this.emit('stopped');

    logger.info('Change detector stopped');
  }

  private async cleanupRuntimeResources(): Promise<void> {
    if (this.resourcesCleanedUp) return;
    this.resourcesCleanedUp = true;

    // Always clean up singleton listeners, even if start() failed before isRunning was set.
    if (this.thresholdExceededHandler) {
      this.performanceMonitor.off('threshold-exceeded', this.thresholdExceededHandler);
      this.thresholdExceededHandler = null;
    }

    if (this.intervalChangedHandler) {
      this.adaptivePolling.off('intervalChanged', this.intervalChangedHandler);
      this.intervalChangedHandler = null;
    }

    // Stop performance monitoring
    this.performanceMonitor.stop();

    // Stop git polling
    this.stopGitPolling();

    // Stop file watcher
    await this.fileWatcher.stop();
    if (this.fileWatcherActiveOnStart) {
      this.performanceMonitor.incrementCounter('activeWatchers', -1);
      this.fileWatcherActiveOnStart = false;
    }

    // Flush any pending events
    await this.eventCoordinator.flush();

    // Clean up components
    this.changeProcessor.destroy();
    await this.eventCoordinator.destroy();
  }

  /**
   * Start git polling
   */
  private startGitPolling(): void {
    if (this.gitPollingTimer) {
      return;
    }

    const poll = async () => {
      // Track idle state for logging, but don't skip polls.
      // The AdaptivePollingManager already increases the interval when idle,
      // so randomly skipping polls on top of that compounds the delay and
      // makes external change detection unacceptably slow (~90s worst case).
      const now = Date.now();
      const timeSinceActivity = now - this.lastActivityTime;

      if (timeSinceActivity > this.IDLE_THRESHOLD) {
        if (!this.isIdle) {
          this.isIdle = true;
          logger.info('Workspace is idle, adaptive polling handles interval', {
            workspaceId: this.workspaceId,
            timeSinceActivity,
          });
        }
      } else if (this.isIdle) {
        this.isIdle = false;
        logger.info('Workspace is active again', {
          workspaceId: this.workspaceId,
        });
      }

      try {
        await this.pollGitStatus();

        // Reset error count on success
        if (this.gitPollErrorCount > 0) {
          logger.info('Git polling recovered from errors', {
            previousErrorCount: this.gitPollErrorCount,
          });
          this.gitPollErrorCount = 0;
        }
      } catch (error) {
        logger.error('Git polling error:', error);
        this.gitPollErrorCount++;

        // Log warning if errors are accumulating
        if (this.gitPollErrorCount > 5) {
          logger.warn('Multiple git polling errors', {
            errorCount: this.gitPollErrorCount,
            workspaceId: this.workspaceId,
          });
        }
      }
    };

    // Initial poll
    poll();

    // Set up recurring poll with adaptive interval
    const currentInterval = this.adaptivePolling.getCurrentInterval();
    this.gitPollingTimer = setInterval(poll, currentInterval);

    logger.debug(`Git polling started (interval: ${currentInterval}ms)`);
  }

  /**
   * Stop git polling
   */
  private stopGitPolling(): void {
    if (this.debouncedPollTimer) {
      clearTimeout(this.debouncedPollTimer);
      this.debouncedPollTimer = null;
    }
    if (this.followUpPollTimer) {
      clearTimeout(this.followUpPollTimer);
      this.followUpPollTimer = null;
    }
    this.followUpPollUntil = 0;
    if (this.gitPollingTimer) {
      clearInterval(this.gitPollingTimer);
      this.gitPollingTimer = null;
      logger.debug('Git polling stopped');
    }
  }

  private scheduleFollowUpPolling(): void {
    this.followUpPollUntil = Math.max(
      this.followUpPollUntil,
      Date.now() + this.FOLLOW_UP_POLL_WINDOW_MS,
    );
    this.scheduleNextFollowUpPoll();
  }

  private scheduleNextFollowUpPoll(): void {
    if (this.followUpPollTimer || Date.now() >= this.followUpPollUntil) return;

    this.followUpPollTimer = setTimeout(() => {
      this.followUpPollTimer = null;
      if (!this.isRunning) return;

      this.pollGitStatus()
        .catch((error) => {
          logger.debug('Follow-up git poll failed', {
            workspaceId: this.workspaceId,
            error: (error as Error).message,
          });
        })
        .finally(() => {
          this.scheduleNextFollowUpPoll();
        });
    }, this.FOLLOW_UP_POLL_INTERVAL_MS);
  }

  /**
   * Poll git status for changes
   *
   * @param options.force When true, bypass the byte-identical short-circuit so a
   *   re-diff always runs. Used for explicit signals (file-save / watcher) where a
   *   same-path content edit can leave the git status string unchanged.
   */
  private async pollGitStatus(options: { force?: boolean } = {}): Promise<void> {
    const force = options.force ?? false;
    // Guard against concurrent executions
    if (this.isPollingGitStatus) {
      // Mark that a poll was requested so we re-poll after current one finishes
      this.pollRequestedWhilePolling = true;
      return;
    }
    this.isPollingGitStatus = true;

    try {
      // Auto-stop if workspace directory has been deleted.
      // This prevents orphaned detectors from polling forever after a workspace
      // is removed outside the normal delete flow (e.g. manual rm, crash).
      const fs = await import('fs');
      if (!fs.existsSync(this.workspacePath)) {
        logger.warn('Workspace directory no longer exists, auto-stopping change detector', {
          workspaceId: this.workspaceId,
          workspacePath: this.workspacePath,
        });
        // Clear pending-poll flag so the finally block doesn't schedule another poll
        // after we've stopped the detector.
        this.pollRequestedWhilePolling = false;
        // Release the polling guard before stopping so stop() can clean up
        this.isPollingGitStatus = false;
        await this.stop();
        this.emit('workspace-deleted', { workspaceId: this.workspaceId });
        return;
      }

      // Use workspace-specific timer key to avoid conflicts
      const timerKey = `gitPoll-${this.workspaceId}`;

      try {
        if (isKeychainAccessSuppressed(this.workspaceId)) {
          logger.debug('Skipping git poll - keychain access suppressed', {
            workspaceId: this.workspaceId,
          });
          return;
        }

        // Start performance timing
        this.performanceMonitor.startTimer(timerKey);
        const status = await this.gitOps.getStatus();
        this.lastGitPoll = new Date().toISOString();

        // End git poll timing
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const pollDuration = this.performanceMonitor.endTimer(timerKey);

        // Short-circuit when the git status is byte-identical to the previously
        // processed status: skip the expensive detectGitChanges() (batch diffs
        // + file reads) and all downstream change processing/dispatch.
        //
        // Exceptions where we deliberately re-diff even when the status string is
        // unchanged, because a same-path edit (e.g. a file that stays "modified"
        // while its content changes) does not alter the status but must still be
        // detected:
        //   - during the bounded follow-up polling window, and
        //   - when an explicit signal forces the poll (file-save / watcher).
        const serializedStatus = this.serializeGitStatus(status);
        const inFollowUpWindow = Date.now() < this.followUpPollUntil;
        if (
          !force &&
          !inFollowUpWindow &&
          this.lastGitStatusSerialized !== null &&
          serializedStatus === this.lastGitStatusSerialized
        ) {
          return;
        }

        // Compare with last status
        const changes = await this.detectGitChanges(status);

        // Only record the processed status after detectGitChanges() succeeds. If it
        // throws (caught below), leaving the previous value intact lets the next
        // byte-identical poll retry detection instead of short-circuiting.
        this.lastGitStatusSerialized = serializedStatus;

        if (changes.length > 0) {
          this.stats.totalChangesDetected += changes.length;
          this.performanceMonitor.recordChange();

          // Record activity for adaptive polling
          this.adaptivePolling.recordActivity(changes.length, false);
          this.lastActivityTime = Date.now();

          // Start event processing timing (workspace-specific key)
          const eventTimerKey = `eventProcessing-${this.workspaceId}`;
          this.performanceMonitor.startTimer(eventTimerKey);

          // Process changes
          const processed = await this.changeProcessor.processFileChanges(changes);

          // Handle processed changes
          if (processed.length > 0) {
            this.scheduleFollowUpPolling();
            await this.eventCoordinator.handleChangesBatch(processed);
            this.performanceMonitor.recordEvent();

            // Emit 'changes' event so downstream listeners (e.g. daemon-events bridge) can react.
            // processFileChanges doesn't queue to batch, so 'changes-batch' would never fire otherwise.
            await this.handleChangesBatch(processed);

            // Emit file:content-changed for modified/created files so file viewers update
            for (const change of processed) {
              const action = change.change.action;
              if (action === 'Modify' || action === 'Create') {
                const absolutePath = `${this.workspacePath}/${change.change.path}`;
	                // NOTE: Redundant once watcher:file-changed direct subscription is stable. See spec.
                this.emitFileContentChangedToRenderer(absolutePath, change.change.path);
              }
            }
          }

          // End event processing timing
          this.performanceMonitor.endTimer(eventTimerKey);
        }

        this.lastGitStatus = status;
      } catch (error) {
        // Ensure timer is ended even on error (use workspace-specific key)
        const timerKey = `gitPoll-${this.workspaceId}`;
        try {
          this.performanceMonitor.endTimer(timerKey);
        } catch {
          // Timer might not exist, ignore
        }

        logger.error('Failed to poll git status:', error);
        this.performanceMonitor.incrementCounter('errors');

        // Don't reset errors immediately - let the error counting work
        // The GitOperations class will handle error counting and throw if max errors exceeded
        // We'll only reset errors after a successful poll (which happens automatically in getStatus)
      }
    } finally {
      this.isPollingGitStatus = false;

      // If a poll was requested while we were polling, schedule a follow-up
      if (this.pollRequestedWhilePolling) {
        this.pollRequestedWhilePolling = false;
        this.scheduleDebouncedPoll();
      }
    }
  }

  /**
   * Trigger an immediate check for changes
   * Used when we know changes have occurred (e.g., after file save)
   */
  public async triggerImmediateCheck(reason?: string): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Cannot trigger immediate check - detector not running');
      return;
    }

    logger.debug('Triggering immediate check', {
      workspaceId: this.workspaceId,
      reason,
    });

    // Perform an immediate git poll, forcing a re-diff so a same-path content edit
    // that leaves the git status string unchanged is still detected.
    await this.pollGitStatus({ force: true });
  }

  /**
   * Serialize a GitStatus into a stable string for byte-identical comparison
   * across polls. The `renamed` Map is converted to entries because Map is not
   * JSON-serializable; array order is deterministic for an unchanged git state.
   */
  private serializeGitStatus(status: GitStatus): string {
    return JSON.stringify({
      staged: status.staged,
      stagedAdded: status.stagedAdded,
      stagedDeleted: status.stagedDeleted,
      unstaged: status.unstaged,
      untracked: status.untracked,
      deleted: status.deleted,
      renamed: Array.from(status.renamed.entries()),
    });
  }

  /**
   * Build raw changes array from git status.
   * Shared helper used by both detectGitChanges() and getCurrentChanges()
   * to ensure consistent handling of all file types (staged, unstaged, untracked, deleted, renamed).
   */
  private buildChangesFromStatus(status: GitStatus): Array<{
    path: string;
    action: 'Create' | 'Modify' | 'Delete' | 'Rename';
    stage: 'staged' | 'unstaged';
    oldPath?: string;
  }> {
    const changes: Array<{
      path: string;
      action: 'Create' | 'Modify' | 'Delete' | 'Rename';
      stage: 'staged' | 'unstaged';
      oldPath?: string;
    }> = [];

    // Build a set of renamed file paths to exclude them from staged/unstaged processing
    // (they get added to both status.renamed AND status.staged/unstaged in git-operations-safe-wrapper)
    const renamedNewPaths = new Set<string>(status.renamed.values());

    // Process staged files (modifications) - exclude renamed files
    for (const file of status.staged) {
      if (!renamedNewPaths.has(file)) {
        changes.push({
          path: file,
          action: 'Modify',
          stage: 'staged',
        });
      }
    }

    // Process staged added files (new files that are staged)
    for (const file of status.stagedAdded) {
      changes.push({
        path: file,
        action: 'Create',
        stage: 'staged',
      });
    }

    // Process unstaged files (modifications) - exclude renamed files
    for (const file of status.unstaged) {
      if (!renamedNewPaths.has(file)) {
        changes.push({
          path: file,
          action: 'Modify',
          stage: 'unstaged',
        });
      }
    }

    // Process untracked files (new files)
    for (const file of status.untracked) {
      changes.push({
        path: file,
        action: 'Create',
        stage: 'unstaged',
      });
    }

    // Process staged deleted files
    for (const file of status.stagedDeleted) {
      changes.push({
        path: file,
        action: 'Delete',
        stage: 'staged',
      });
    }

    // Process unstaged deleted files
    for (const file of status.deleted) {
      changes.push({
        path: file,
        action: 'Delete',
        stage: 'unstaged',
      });
    }

    // Process renamed files - determine stage from status.staged/unstaged presence
    for (const [oldPath, newPath] of status.renamed.entries()) {
      // Determine if the rename is staged or unstaged based on which list it's in
      const isStaged = status.staged.includes(newPath);
      changes.push({
        path: newPath,
        action: 'Rename',
        stage: isStaged ? 'staged' : 'unstaged',
        oldPath,
      });
    }

    return changes;
  }

  /**
   * Detect changes from git status
   */
  private async detectGitChanges(status: GitStatus): Promise<any[]> {
    const { readFile, stat } = await import('fs/promises');
    const { join } = await import('path');

    // Get raw changes from shared helper
    const rawChanges = this.buildChangesFromStatus(status);

    // Get diffs for modified files (both staged and unstaged)
    const unstagedModifyFiles = rawChanges
      .filter((c) => c.action === 'Modify' && c.stage === 'unstaged')
      .map((c) => c.path);
    const stagedModifyFiles = rawChanges
      .filter((c) => c.action === 'Modify' && c.stage === 'staged')
      .map((c) => c.path);

    // Get all diffs in batch (much more efficient)
    let unstagedDiffResults: Map<string, any> = new Map();
    let stagedDiffResults: Map<string, any> = new Map();

    if (unstagedModifyFiles.length > 0) {
      unstagedDiffResults = await this.gitOps.getBatchDiffs(unstagedModifyFiles);
    }
    if (stagedModifyFiles.length > 0) {
      stagedDiffResults = await this.gitOps.getBatchDiffsStaged(stagedModifyFiles);
    }

    // Enrich raw changes with diffs and stats
    const changes: any[] = [];
    for (const rawChange of rawChanges) {
      let additions = 0;
      let deletions = 0;
      let diff: any = undefined;

      if (rawChange.action === 'Modify') {
        diff =
          rawChange.stage === 'staged'
            ? stagedDiffResults.get(rawChange.path)
            : unstagedDiffResults.get(rawChange.path);
        // Skip files that have no actual changes (reverted to original)
        if (diff === null) {
          continue;
        }
        additions = diff?.additions || 0;
        deletions = diff?.deletions || 0;
      } else if (rawChange.action === 'Create') {
        // For new/untracked files, count lines as additions — skip binary/oversized files
        if (!isBinaryExtension(rawChange.path)) {
          try {
            const filePath = join(this.workspacePath, rawChange.path);
            const fileStats = await stat(filePath);
            if (fileStats.size <= MAX_TRACKABLE_CONTENT_SIZE) {
              const content = await readFile(filePath, 'utf-8');
              additions = content.split('\n').length;
              if (content.endsWith('\n')) {
                additions = Math.max(0, additions - 1);
              }
            }
          } catch {
            // File might be inaccessible
          }
        }
      } else if (rawChange.action === 'Delete') {
        // For deleted files, get old content from HEAD
        try {
          const oldContent = await this.gitOps.getFileAtHead(rawChange.path);
          if (oldContent) {
            deletions = oldContent.split('\n').length;
            if (oldContent.endsWith('\n')) {
              deletions = Math.max(0, deletions - 1);
            }
          }
        } catch {
          // File might not exist in HEAD
        }
      }

      changes.push({
        ...rawChange,
        additions,
        deletions,
        diff,
      });
    }

    return changes;
  }

  /**
   * Handle file watch event
   */
  private async handleFileWatchEvent(event: FileWatchEvent): Promise<void> {
    this.stats.totalChangesDetected++;

    // Update activity time and record for adaptive polling
    this.lastActivityTime = Date.now();
    this.adaptivePolling.recordActivity(1, true); // User-initiated change

    // Invalidate git status cache when file changes are detected
    this.gitOps.invalidateCache();

    // Clear gitignore cache when .gitignore files change (they may affect what's ignored)
    if (event.relativePath.endsWith('.gitignore')) {
      this.gitOps.clearGitIgnoreCache();
    }

    const action = this.mapWatchEventToAction(event.type);
    if (!action) return;

    // Emit file:content-changed event to renderer for real-time file viewer updates
    // This ensures the file viewer updates when files are edited externally
    if (action === 'Modify' || action === 'Create') {
	      // NOTE: Redundant once watcher:file-changed direct subscription is stable. See spec.
      this.emitFileContentChangedToRenderer(event.path, event.relativePath);
    }

    // Emit file:deleted event for delete actions
    // This uses a separate channel that the UI subscribes to for file deletions
    if (action === 'Delete') {
      this.emitFileDeletedToRenderer(event.path, event.relativePath);
    }

    // Trigger a debounced git status poll instead of direct processing
    // This ensures git status properly filters out ignored files and batches rapid changes
    this.scheduleDebouncedPoll();
  }

  /**
   * Schedule a debounced poll of git status
   * Batches rapid file changes into a single git status run
   */
  private scheduleDebouncedPoll(): void {
    if (this.debouncedPollTimer) {
      clearTimeout(this.debouncedPollTimer);
    }
    this.debouncedPollTimer = setTimeout(() => {
      this.debouncedPollTimer = null;
      this.pollGitStatus().catch((error) => {
        logger.debug('Debounced git poll failed', {
          workspaceId: this.workspaceId,
          error: (error as Error).message,
        });
      });
    }, this.DEBOUNCE_DELAY_MS);
  }

  /**
   * Emit file:content-changed event to renderer processes
   * This notifies the file viewer to reload content when files change externally
   */
  private async emitFileContentChangedToRenderer(
    absolutePath: string,
    relativePath: string,
  ): Promise<void> {
    try {
      // Skip binary files — they can't be displayed as text anyway
      if (isBinaryExtension(relativePath)) {
        return;
      }

      // Read the file content
      const fs = await import('fs/promises');

      // Check file size before reading to avoid loading huge files into memory
      try {
        const fileStats = await fs.stat(absolutePath);
        if (fileStats.size > MAX_TRACKABLE_CONTENT_SIZE) {
          logger.debug('Skipping content-changed emission for large file', {
            path: relativePath,
            size: fileStats.size,
          });
          return;
        }
      } catch {
        // If we can't stat, skip
        return;
      }

      let content: string | null = null;
      try {
        content = await fs.readFile(absolutePath, 'utf-8');
      } catch {
        // File may be temporarily unreadable - skip emission
        logger.debug('Could not read file for content-changed event', {
          path: relativePath,
          workspaceId: this.workspaceId,
        });
        return;
      }

      sendToWorkspaceWindows(this.workspaceId, 'file:content-changed', {
        path: absolutePath,
        relativePath,
        content,
        source: 'external',
        workspaceId: this.workspaceId,
      });

      logger.debug('Emitted file:content-changed for external edit', {
        path: relativePath,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      // Unexpected error (e.g., electron not available) - log and skip
      logger.warn('Could not emit file:content-changed', {
        path: relativePath,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Emit file:deleted event to renderer processes
   * This notifies the file viewer when files are deleted externally
   */
  private emitFileDeletedToRenderer(absolutePath: string, relativePath: string): void {
    try {
      sendToWorkspaceWindows(this.workspaceId, `file:deleted:${this.workspaceId}`, {
        path: absolutePath,
        relativePath,
        source: 'external',
        workspaceId: this.workspaceId,
      });

      logger.debug('Emitted file:deleted for external delete', {
        path: relativePath,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      // Unexpected error (e.g., electron not available) - log and skip
      logger.warn('Could not emit file:deleted', {
        path: relativePath,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Map watch event type to file action
   */
  private mapWatchEventToAction(
    type: FileWatchEvent['type'],
  ): 'Create' | 'Modify' | 'Delete' | null {
    switch (type) {
      case 'add':
        return 'Create';
      case 'change':
        return 'Modify';
      case 'unlink':
        return 'Delete';
      default:
        return null;
    }
  }

  /**
   * Handle a batch of processed changes
   */
  private async handleChangesBatch(changes: ProcessedChange[]): Promise<void> {
    this.emit('changes-detected', changes);

    // Also emit in the format expected by ChangeDetectorManager
    if (changes.length > 0) {
      // Calculate total additions and deletions
      let totalAdditions = 0;
      let totalDeletions = 0;

      const files: FileChange[] = changes.map((change) => {
        const additions = change.change.additions || 0;
        const deletions = change.change.deletions || 0;

        totalAdditions += additions;
        totalDeletions += deletions;

        return {
          path: change.change.path,
          action: (change.change.action || 'Modify') as FileChange['action'],
          stage: change.change.stage,
          oldPath: change.change.oldPath, // For rename operations
          timestamp: new Date().toISOString(),
          additions,
          deletions,
          // Include content for content-based attribution in downstream services
          content: change.change.content,
          // Include actor for per-file attribution (set by ChangeProcessor)
          actor: change.change.actor,
        };
      });

      // Check if any of the changes have an agent actor - use that for provenance
      const agentChange = changes.find((c) => c.change.actor?.type === 'agent');
      const provenance: DiffChunk['provenance'] = agentChange?.change.actor
        ? {
            source: 'agent',
            agentId: agentChange.change.actor.id,
            agentName: agentChange.change.actor.name,
          }
        : {
            source: 'git',
          };

      const diffChunk: DiffChunk = {
        id: uuidv4(),
        workspaceId: this.workspaceId,
        timestamp: new Date().toISOString(),
        provenance,
        files,
        summary: {
          filesChanged: changes.length,
          additions: totalAdditions,
          deletions: totalDeletions,
        },
      };

      this.emit('changes', diffChunk);
    }
  }

  /**
   * Take initial snapshot of workspace
   */
  private async takeInitialSnapshot(): Promise<void> {
    try {
      const gitStatusStart = Date.now();
      const status = await this.gitOps.getStatus();
      logger.info('gitOps.getStatus completed', {
        workspaceId: this.workspaceId,
        durationMs: Date.now() - gitStatusStart,
        stagedCount: status.staged.length,
        unstagedCount: status.unstaged.length,
        untrackedCount: status.untracked.length,
      });

      // Include all files that exist on disk for snapshot taking
      // (stagedDeleted files are already deleted, so they don't need snapshots)
      const allFiles = [
        ...status.staged,
        ...status.stagedAdded,
        ...status.unstaged,
        ...status.untracked,
      ];

      const snapshotStart = Date.now();
      await this.snapshotManager.takeSnapshots(allFiles, false);
      logger.info(`Initial snapshot taken for ${allFiles.length} files`, {
        workspaceId: this.workspaceId,
        snapshotDurationMs: Date.now() - snapshotStart,
      });
    } catch (error) {
      logger.error('Failed to take initial snapshot:', error);
    }
  }

  /**
   * Get current statistics
   */
  getStats(): ChangeDetectorStats {
    const eventStats = this.eventCoordinator.getStats();
    const fileWatcherStats = this.fileWatcher.getStats();

    return {
      isRunning: this.isRunning,
      gitPollingEnabled: !!this.gitPollingTimer,
      fileWatcherEnabled: fileWatcherStats.isWatching,
      lastGitPoll: this.lastGitPoll,
      totalChangesDetected: this.stats.totalChangesDetected,
      totalEventsEmitted: eventStats.totalEvents,
      // Attribution is owned by the daemon (§17.4 / §5.19); the FE-side
      // detector no longer resolves a current actor. Field shape preserved.
      currentActor: null,
    };
  }

  /**
   * Force a git status check
   */
  async forceGitCheck(): Promise<void> {
    await this.pollGitStatus();
  }

  /**
   * Get current uncommitted changes
   */
  async getCurrentChanges(): Promise<DiffChunk | null> {
    try {
      const status = await this.gitOps.getStatus();
      const { readFile, stat } = await import('fs/promises');
      const { join } = await import('path');

      // Get raw changes from shared helper
      const rawChanges = this.buildChangesFromStatus(status);

      if (rawChanges.length === 0) {
        return null;
      }

      // Get diffs for modified files (both staged and unstaged)
      const unstagedModifyFiles = rawChanges
        .filter((c) => c.action === 'Modify' && c.stage === 'unstaged')
        .map((c) => c.path);
      const stagedModifyFiles = rawChanges
        .filter((c) => c.action === 'Modify' && c.stage === 'staged')
        .map((c) => c.path);

      // Get all diffs in batch (much more efficient than individual calls)
      let unstagedDiffResults: Map<string, { additions: number; deletions: number; diff: string }> =
        new Map();
      let stagedDiffResults: Map<string, { additions: number; deletions: number; diff: string }> =
        new Map();

      if (unstagedModifyFiles.length > 0) {
        unstagedDiffResults = await this.gitOps.getBatchDiffs(unstagedModifyFiles);
      }
      if (stagedModifyFiles.length > 0) {
        stagedDiffResults = await this.gitOps.getBatchDiffsStaged(stagedModifyFiles);
      }

      // Enrich raw changes with diffs and content
      const changes: any[] = [];
      for (const rawChange of rawChanges) {
        let additions = 0;
        let deletions = 0;
        let diffText: string | undefined;
        let content: string | undefined;

        // Get diff from batch results for Modify actions
        if (rawChange.action === 'Modify') {
          const diff =
            rawChange.stage === 'staged'
              ? stagedDiffResults.get(rawChange.path)
              : unstagedDiffResults.get(rawChange.path);
          additions = diff?.additions || 0;
          deletions = diff?.deletions || 0;
          diffText = diff?.diff;
        }

        // Try to read file content (won't exist for deleted files)
        // Skip binary and oversized files to prevent bloated tracking JSON
        if (rawChange.action !== 'Delete' && !isBinaryExtension(rawChange.path)) {
          try {
            const filePath = join(this.workspacePath, rawChange.path);
            const fileStats = await stat(filePath);
            if (fileStats.size <= MAX_TRACKABLE_CONTENT_SIZE) {
              content = await readFile(filePath, 'utf-8');
            }
          } catch {
            // File might be deleted or inaccessible
          }
        }

        // For Create (new/untracked files), count lines as additions
        if (rawChange.action === 'Create' && content) {
          additions = content.split('\n').length;
          // Handle case where file doesn't end with newline
          if (content.endsWith('\n')) {
            additions = Math.max(0, additions - 1);
          }
        }

        // For Delete, we'd need to get the old content from git
        // Use git show HEAD:path to get the file content before deletion
        if (rawChange.action === 'Delete') {
          try {
            const oldContent = await this.gitOps.getFileAtHead(rawChange.path);
            if (oldContent) {
              deletions = oldContent.split('\n').length;
              if (oldContent.endsWith('\n')) {
                deletions = Math.max(0, deletions - 1);
              }
            }
          } catch {
            // File might not exist in HEAD (was untracked)
          }
        }

        changes.push({
          path: rawChange.path,
          action: rawChange.action,
          stage: rawChange.stage,
          oldPath: rawChange.oldPath,
          additions,
          deletions,
          diff: diffText,
          content,
        });
      }

      // Attribution is owned by the daemon (§17.4 tracked_changes + §6.5
      // file-tracking events); FE-side polling no longer enriches per-file
      // actors. `actor` is left undefined so downstream consumers (event
      // coordinator, gutter) fall back to the daemon-sourced attribution.
      let totalAdditions = 0;
      let totalDeletions = 0;

      const files: FileChange[] = changes.map((change) => {
        totalAdditions += change.additions;
        totalDeletions += change.deletions;

        const actor: Actor | undefined = undefined;

        return {
          path: change.path,
          action: change.action as 'Create' | 'Modify' | 'Delete' | 'Rename',
          stage: change.stage,
          oldPath: change.oldPath, // For rename operations
          additions: change.additions,
          deletions: change.deletions,
          diff: change.diff,
          content: change.content,
          timestamp: new Date().toISOString(),
          actor,
        };
      });

      const provenance: DiffChunk['provenance'] = { source: 'git' };

      return {
        id: uuidv4(),
        workspaceId: this.workspaceId,
        timestamp: new Date().toISOString(),
        provenance,
        files,
        summary: {
          filesChanged: files.length,
          additions: totalAdditions,
          deletions: totalDeletions,
        },
      };
    } catch (error) {
      logger.error('Failed to get current changes:', error);
      return null;
    }
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.changeProcessor.clearCache();
    this.snapshotManager.clearSnapshots();
    this.eventCoordinator.resetStats();
  }

  /**
   * Invalidate the git status cache.
   * Call this after external git operations (stage/unstage) to ensure
   * the next poll gets fresh status from git.
   */
  invalidateGitStatusCache(): void {
    this.gitOps.invalidateCache();
    logger.debug('Git status cache invalidated', { workspaceId: this.workspaceId });
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    const metrics = this.performanceMonitor.getMetrics();

    // Add change detector specific metrics
    return {
      ...metrics,
      trackedFiles: this.snapshotManager.getSnapshotCount(),
      pendingChanges: this.changeProcessor.getPendingCount(),
      eventQueueSize: this.eventCoordinator.getQueueSize(),
      ...this.stats,
    };
  }
}
