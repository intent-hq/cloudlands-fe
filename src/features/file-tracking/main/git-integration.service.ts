/**
 * Git Integration Service for File Tracking
 *
 * Bridges the gap between git change detection and file tracking.
 * Uses per-file attribution from the change detector for accurate agent tracking.
 */

import { EventEmitter } from 'events';
import type { TrackedChange, FileChangeStatus } from './types';
import { ChangeStage } from './types';
import { FileTrackingService } from './file-tracking.service';
import { Logger } from '$lib/utils/logger';
import { v4 as uuidv4 } from 'uuid';

import { getAttributionEngine } from '../../workspace/main/provenance/attribution-engine';
import { storeBlob, isGitRepository } from '../../../shared/git/git-blob-storage';
import {
  partitionDefaultFileTrackingExcludes,
  summarizeDefaultFileTrackingExcludes,
} from '../utils/tracking-excludes';

const logger = new Logger({ category: 'GitIntegrationService' });

// Debounce helper
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return function (...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export class GitIntegrationService extends EventEmitter {
  private fileTrackingService: FileTrackingService;
  private workspaceId: string;
  private workspacePath: string;
  private isGitRepo: boolean;
  private changeDetector: any; // ChangeDetector instance
  private gitService: any; // GitService instance (optional, undefined for remote workspaces)
  private isRemote: boolean;
  private isListening = false;
  private processingChanges = false;
  private lastProcessedChangeId: string | null = null;
  private changeQueue: Map<string, any> = new Map(); // Queue for batch processing
  private debouncedProcessQueue: () => void;
  private recentChangeKeys = new Map<string, number>();
  private static readonly DEDUP_WINDOW_MS = 2000;
  private lastSyncTime: number = 0;
  private readonly MIN_SYNC_INTERVAL = 10000; // Minimum 10 seconds between syncs

  // Committed changes caching - only reload when HEAD changes
  private lastCommittedChangesHead: string | null = null;
  private committedChangesLoaded = false;

  // Stage operation suppression - prevents event emission loops during staging/unstaging
  // When a stage operation is in progress, we suppress 'changes-tracked' events to avoid
  // triggering UI reloads that could revert optimistic updates
  private stageOperationInProgress = false;
  private stageOperationPaths: Set<string> = new Set();
  private stageOperationTimeout: NodeJS.Timeout | null = null;
  private readonly STAGE_OPERATION_SUPPRESSION_MS = 2000; // Suppress events for 2 seconds after stage operation

  // Workspace metadata for scoping commits to this workspace
  private baseRef?: string;
  private baseCommitSha?: string;
  private workspaceCreatedAt?: string;

  constructor(
    workspaceId: string,
    workspacePath: string,
    fileTrackingService: FileTrackingService,
    gitService?: any,
    workspaceMetadata?: { baseRef?: string; baseCommitSha?: string; createdAt?: string },
    isRemote?: boolean,
  ) {
    super();
    this.workspaceId = workspaceId;
    this.workspacePath = workspacePath;
    this.isGitRepo = false; // Updated async in initializeGitCheck()
    this.fileTrackingService = fileTrackingService;
    this.gitService = gitService;
    this.isRemote = !!isRemote;
    this.baseRef = workspaceMetadata?.baseRef;
    this.baseCommitSha = workspaceMetadata?.baseCommitSha;
    this.workspaceCreatedAt = workspaceMetadata?.createdAt;

    // Create debounced queue processor (500ms delay — fast enough for responsive UI,
    // slow enough to batch bulk changes like git checkout touching many files)
    this.debouncedProcessQueue = debounce(() => this.processChangeQueue(), 500);
  }

  /**
   * Update workspace metadata used for scoping commits.
   * Called when the user changes the base commit or other workspace settings.
   * Invalidates the committed changes cache so the next sync picks up the new boundary.
   */
  updateWorkspaceMetadata(metadata: {
    baseRef?: string;
    baseCommitSha?: string;
    createdAt?: string;
  }): void {
    const changed =
      this.baseRef !== metadata.baseRef || this.baseCommitSha !== metadata.baseCommitSha;

    this.baseRef = metadata.baseRef;
    this.baseCommitSha = metadata.baseCommitSha;
    if (metadata.createdAt) {
      this.workspaceCreatedAt = metadata.createdAt;
    }

    if (changed) {
      // Invalidate committed changes cache so next sync uses the new boundary
      this.committedChangesLoaded = false;
      this.lastCommittedChangesHead = null;
      logger.info('Workspace metadata updated, invalidated committed changes cache', {
        workspaceId: this.workspaceId,
        baseRef: metadata.baseRef,
        baseCommitSha: metadata.baseCommitSha?.substring(0, 8),
      });
    }
  }

  private boundHandleGitChanges: any;
  private boundHandleCommittedChanges: any;

  /**
   * Start listening to git changes
   * @param changeDetector - The change detector to listen to
   * @param options - Options for starting the listener
   * @param options.skipInitialSync - Skip the initial syncCurrentState call.
   *   Use this for newly created workspaces where the worktree has no changes yet,
   *   avoiding expensive git operations (~3s) that would return empty results.
   */
  async startListening(
    changeDetector: any,
    options?: { skipInitialSync?: boolean },
  ): Promise<void> {
    const startTime = Date.now();
    if (this.isListening) {
      logger.debug('Already listening to git changes', { workspaceId: this.workspaceId });
      return;
    }

    // Resolve git repo status before starting (non-blocking initialization)
    this.isGitRepo = await isGitRepository(this.workspacePath);

    this.changeDetector = changeDetector;
    this.isListening = true;

    // Create bound handlers to ensure proper cleanup
    this.boundHandleGitChanges = this.handleGitChangesWithDedup.bind(this);
    this.boundHandleCommittedChanges = this.handleCommittedChanges.bind(this);

    // Listen to change events from the ChangeDetector
    this.changeDetector.on('changes', this.boundHandleGitChanges);
    this.changeDetector.on('committed-changes', this.boundHandleCommittedChanges);

    logger.debug('Started listening to git changes', { workspaceId: this.workspaceId });

    // Do an initial sync (skip for fresh workspaces with no changes)
    if (options?.skipInitialSync) {
      logger.debug('Skipping initial sync (fresh workspace)', {
        workspaceId: this.workspaceId,
        totalDurationMs: Date.now() - startTime,
      });
    } else {
      const syncStart = Date.now();
      await this.syncCurrentState();
      logger.debug('Initial syncCurrentState completed', {
        workspaceId: this.workspaceId,
        syncDurationMs: Date.now() - syncStart,
        totalDurationMs: Date.now() - startTime,
      });
    }
  }

  /**
   * Stop listening to git changes
   */
  stopListening(): void {
    if (!this.isListening || !this.changeDetector) {
      return;
    }

    // Use the bound handlers for proper cleanup
    if (this.boundHandleGitChanges) {
      this.changeDetector.off('changes', this.boundHandleGitChanges);
    }
    if (this.boundHandleCommittedChanges) {
      this.changeDetector.off('committed-changes', this.boundHandleCommittedChanges);
    }

    this.isListening = false;
    this.changeQueue.clear();
    this.lastProcessedChangeId = null;
    logger.debug('Stopped listening to git changes', { workspaceId: this.workspaceId });
  }

  /**
   * Invalidate the git status cache in the change detector.
   * Call this after staging/unstaging operations to ensure the next
   * git poll gets fresh status.
   */
  invalidateGitStatusCache(): void {
    if (this.changeDetector && typeof this.changeDetector.invalidateGitStatusCache === 'function') {
      this.changeDetector.invalidateGitStatusCache();
    }
  }

  /**
   * Invalidate the committed changes cache so the next sync will reload
   * commit history with fresh isPushed status.
   * Call this after push/undo-push operations.
   */
  invalidateCommittedChangesCache(): void {
    this.committedChangesLoaded = false;
    this.lastCommittedChangesHead = null;
    logger.debug('Invalidated committed changes cache', { workspaceId: this.workspaceId });
  }

  /**
   * Begin suppressing 'changes-tracked' events for the specified file paths.
   * This is called before a stage/unstage operation to prevent the UI from
   * receiving events that would revert optimistic updates.
   *
   * @param filePaths - The file paths being staged/unstaged
   */
  beginStageOperation(filePaths: string[]): void {
    this.stageOperationInProgress = true;
    for (const path of filePaths) {
      this.stageOperationPaths.add(path);
    }

    // Clear any existing timeout
    if (this.stageOperationTimeout) {
      clearTimeout(this.stageOperationTimeout);
    }

    // Set a safety timeout to ensure we don't suppress forever
    this.stageOperationTimeout = setTimeout(() => {
      this.endStageOperation();
    }, this.STAGE_OPERATION_SUPPRESSION_MS);

    logger.debug('Stage operation suppression started', {
      workspaceId: this.workspaceId,
      pathCount: filePaths.length,
      paths: filePaths.slice(0, 5), // Log first 5 paths
    });
  }

  /**
   * End stage operation suppression. Called after the stage/unstage operation
   * completes and the UI has had time to process the optimistic update.
   */
  endStageOperation(): void {
    this.stageOperationInProgress = false;
    this.stageOperationPaths.clear();

    if (this.stageOperationTimeout) {
      clearTimeout(this.stageOperationTimeout);
      this.stageOperationTimeout = null;
    }

    logger.debug('Stage operation suppression ended', {
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Check if a stage operation is currently in progress.
   * Used to determine if 'changes-tracked' events should be suppressed.
   */
  isStageOperationInProgress(): boolean {
    return this.stageOperationInProgress;
  }

  /**
   * Handle post-commit transition.
   * Transitions staged changes to committed and emits events to notify the frontend.
   *
   * @param commitHash - The hash of the new commit (optional)
   */
  async handlePostCommit(commitHash?: string): Promise<void> {
    try {
      logger.info('Handling post-commit transition', {
        workspaceId: this.workspaceId,
        commitHash: commitHash?.substring(0, 8),
      });

      // Load existing tracked changes
      const result = await this.fileTrackingService.getChanges();
      const existingChanges = result.changes;

      // Find staged changes to transition to committed
      const stagedChanges = existingChanges.filter(
        (c: TrackedChange) => c.stage === ChangeStage.Staged,
      );

      if (stagedChanges.length === 0) {
        logger.debug('No staged changes to transition after commit', {
          workspaceId: this.workspaceId,
        });
        return;
      }

      // Transition staged changes to committed
      const committedChanges: TrackedChange[] = stagedChanges.map((c: TrackedChange) => ({
        ...c,
        stage: ChangeStage.Committed,
        commitHash: commitHash || c.commitHash,
        attribution: {
          ...c.attribution,
          timestamp: Date.now(),
        },
      }));

      // Clear the staged changes (they're now committed)
      const filesToClear = stagedChanges.map((c: TrackedChange) => c.file);
      await this.fileTrackingService.clearFileChangesBatch(filesToClear);

      // Save the committed changes and force immediate flush
      await this.fileTrackingService.saveChanges(committedChanges);
      await this.fileTrackingService.forceSave();

      logger.info('Post-commit transition complete', {
        workspaceId: this.workspaceId,
        transitionedCount: committedChanges.length,
        commitHash: commitHash?.substring(0, 8),
      });

      // Invalidate committed changes cache so next sync loads fresh data
      this.committedChangesLoaded = false;
      this.lastCommittedChangesHead = null;

      // Emit event to notify frontend of the change
      this.emit('changes-tracked', {
        workspaceId: this.workspaceId,
        changeCount: committedChanges.length,
        source: 'post-commit-transition',
      });
    } catch (error) {
      logger.error('Failed to handle post-commit transition', error as Error, {
        workspaceId: this.workspaceId,
        commitHash,
      });
      // Don't throw - let the sync handle cleanup
    }
  }

  /**
   * Sync current git state with file tracking
   * @param force - If true, bypass the throttle and force a sync
   * @param includeCommitted - If false, skip loading committed changes (for fast stage/unstage operations)
   */
  async syncCurrentState(force = false, includeCommitted = true): Promise<void> {
    const syncStartTime = Date.now();
    // Prevent excessive syncing (unless forced)
    const now = Date.now();
    const timeSinceLastSync = now - this.lastSyncTime;
    if (!force && timeSinceLastSync < this.MIN_SYNC_INTERVAL) {
      logger.debug('Skipping sync - too soon since last sync', {
        workspaceId: this.workspaceId,
        timeSinceLastSync,
      });
      return;
    }
    this.lastSyncTime = now;

    try {
      // Use debug level for all sync operations to reduce log noise
      logger.debug('Syncing current git state', {
        workspaceId: this.workspaceId,
        includeCommitted,
        force,
        timeSinceLastSync,
      });

      // First, load any existing tracked changes from storage
      const existingStart = Date.now();
      const existingResult = await this.fileTrackingService.getChanges();
      const existingChanges = existingResult.changes;
      logger.debug('Loaded existing tracked changes from storage', {
        workspaceId: this.workspaceId,
        count: existingChanges.length,
        durationMs: Date.now() - existingStart,
      });

      // Get current uncommitted changes from git
      const currentChanges = await this.changeDetector.getCurrentChanges();
      if (currentChanges) {
        // Pass isFullSync=true to allow clearing stale files
        const handleStart = Date.now();
        await this.handleGitChanges(currentChanges, true);
        logger.debug('handleGitChanges completed', {
          workspaceId: this.workspaceId,
          durationMs: Date.now() - handleStart,
        });
      } else {
        logger.debug('No current git changes found', { workspaceId: this.workspaceId });

        // If there are no current git changes but we have stored unstaged/staged changes,
        // we should clear only those (not committed changes)
        const unstagedStagedChanges = existingChanges.filter(
          (c: any) => c.stage === ChangeStage.Unstaged || c.stage === ChangeStage.Staged,
        );

        if (unstagedStagedChanges.length > 0) {
          logger.debug('Clearing stale unstaged/staged changes', {
            workspaceId: this.workspaceId,
            count: unstagedStagedChanges.length,
          });

          // Only clear unstaged/staged changes, keep committed ones
          const filesToClear = unstagedStagedChanges.map((c: any) => c.file);
          await this.fileTrackingService.clearFileChangesBatch(filesToClear);
        }
      }

      // Load committed changes from git history if git service is available
      // Skip for fast operations like stage/unstage to avoid performance issues
      if (this.gitService && includeCommitted) {
        const committedStart = Date.now();
        await this.loadCommittedChanges();
        logger.debug('loadCommittedChanges completed', {
          workspaceId: this.workspaceId,
          durationMs: Date.now() - committedStart,
        });
      }

      logger.debug('syncCurrentState completed', {
        workspaceId: this.workspaceId,
        totalDurationMs: Date.now() - syncStartTime,
      });
    } catch (error) {
      logger.error('Failed to sync current state', error as Error);
    }
  }

  /**
   * Handle git changes with deduplication
   */
  private async handleGitChangesWithDedup(changes: any): Promise<void> {
    // Generate ID if missing
    if (!changes.id) {
      changes.id = uuidv4();
    }

    // Create a pseudo-event for deduplication checking
    // NOTE: The deduplication service uses fields: ['type', 'actor.id', 'metadata.filePath', 'data.filterDescription']
    // We put the changeSignature in metadata.filePath so it's included in the deduplication key
    const changeSignature = this.getChangeSignature(changes);
    const pseudoEvent = {
      id: changes.id,
      type: 'git-change' as any,
      timestamp: new Date().toISOString(),
      workspaceId: this.workspaceId,
      actor: { type: 'system' as any, id: 'git', name: 'Git' },
      metadata: {
        // Use filePath for the signature so it's included in deduplication key
        filePath: changeSignature,
        fileCount: changes.files?.length || 0,
      },
    };

    // Check if this is a duplicate using simple time-window dedup
    const dedupKey = `${pseudoEvent.type}-${changeSignature}`;
    const now = Date.now();
    const lastSeen = this.recentChangeKeys.get(dedupKey);
    if (lastSeen && now - lastSeen < GitIntegrationService.DEDUP_WINDOW_MS) {
      logger.debug('Skipping duplicate change', {
        changeId: changes.id,
        workspaceId: this.workspaceId,
      });
      return;
    }

    // Track this change for dedup
    this.recentChangeKeys.set(dedupKey, now);
    // Trim old entries
    if (this.recentChangeKeys.size > 1000) {
      const cutoff = now - GitIntegrationService.DEDUP_WINDOW_MS;
      for (const [k, t] of this.recentChangeKeys) {
        if (t < cutoff) this.recentChangeKeys.delete(k);
      }
    }

    // Add to queue for batch processing
    this.changeQueue.set(changes.id, changes);
    this.lastProcessedChangeId = changes.id;

    // Process queue with debouncing
    this.debouncedProcessQueue();
  }

  /**
   * Process queued changes
   */
  private async processChangeQueue(): Promise<void> {
    if (this.processingChanges || this.changeQueue.size === 0) {
      return;
    }

    this.processingChanges = true;
    const changesToProcess = Array.from(this.changeQueue.values());
    this.changeQueue.clear();

    try {
      for (const changes of changesToProcess) {
        // Pass isFullSync=false - individual file change events should NOT clear other files
        await this.handleGitChanges(changes, false);
      }
    } finally {
      this.processingChanges = false;
    }
  }

  /**
   * Handle git changes from ChangeDetector
   * @param changes - The changes to process
   * @param isFullSync - If true, this is a full sync and we should clear stale files. If false, this is an individual file change event and we should NOT clear other files.
   */
  private async handleGitChanges(changes: any, isFullSync = false): Promise<void> {
    try {
      // Only handle DiffChunk format from ChangeDetector
      if (!changes || !changes.files || !Array.isArray(changes.files)) {
        logger.debug('Received changes in unexpected format', {
          workspaceId: this.workspaceId,
          changeId: changes?.id,
        });
        return;
      }

      // Ensure agent writes are loaded from disk for this workspace
      // This is critical for proper attribution after app restarts
      const attributionEngine = getAttributionEngine();
      await attributionEngine.loadAgentWrites(this.workspaceId);

      const { kept: filesToProcess, skipped: skippedDefaultExcludedFiles } =
        partitionDefaultFileTrackingExcludes(changes.files, (fileChange: any) => ({
          path: fileChange.path,
          action: fileChange.action,
          stage: fileChange.stage,
        }));

      if (skippedDefaultExcludedFiles.length > 0) {
        logger.debug('Skipped default-excluded untracked files before tracking', {
          workspaceId: this.workspaceId,
          changeId: changes.id,
          ...summarizeDefaultFileTrackingExcludes(
            skippedDefaultExcludedFiles.map((fileChange: any) => fileChange.path),
          ),
        });
      }

      // Only log if there are actual changes
      if (changes.files.length > 0) {
        logger.debug('Processing git changes', {
          workspaceId: this.workspaceId,
          fileCount: changes.files.length,
          filteredFileCount: filesToProcess.length,
          source: changes.provenance?.source || 'unknown',
          changeId: changes.id,
          isFullSync,
        });
      }

      // Process files from DiffChunk
      const trackedChanges: TrackedChange[] = [];

      // Get existing tracked changes BEFORE the loop so we can preserve stages for partial updates
      const existingResult = await this.fileTrackingService.getChanges();
      const existingChanges = existingResult.changes;
      // Use file:stage as key to properly handle files with both staged and unstaged changes
      // This ensures we preserve attribution for the correct stage when a file has MM status
      const existingByFileAndStage = new Map(
        existingChanges.map((c) => [`${c.file}:${c.stage}`, c]),
      );
      // Also keep a map by file only for fallback lookups when stage is unknown
      const existingByFileOnly = new Map(existingChanges.map((c) => [c.file, c]));

      for (const fileChange of filesToProcess) {
        // Create TrackedChange with proper content
        // Get line change statistics first
        const additions = fileChange.additions || 0;
        const deletions = fileChange.deletions || 0;

        // Build attribution using per-file actor (preferred) or content-based matching (fallback)
        // Priority:
        // 1. Preserve existing agent attribution (critical for persistence across restarts)
        // 2. Per-file actor from ChangeProcessor (most accurate - already did content matching)
        // 3. Content-based matching via AttributionEngine (fallback for direct calls)
        // 4. Batch-level provenance (legacy fallback)
        // 5. Default to manual
        let attribution: TrackedChange['attribution'];
        // Look up existing change by file:stage if stage is known, otherwise by file only
        const lookupStage = fileChange.stage || ChangeStage.Unstaged;
        const existingChange =
          existingByFileAndStage.get(`${fileChange.path}:${lookupStage}`) ||
          existingByFileOnly.get(fileChange.path);

        // CRITICAL: Preserve existing agent attribution
        // This ensures agent attribution survives app restarts and workspace reopening
        if (existingChange?.attribution?.agent) {
          attribution = existingChange.attribution;
          logger.debug('Preserving existing agent attribution', {
            file: fileChange.path,
            agentId: existingChange.attribution.agent.agentId,
            agentName: existingChange.attribution.agent.agentName,
          });
        } else if (fileChange.actor?.type === 'agent') {
          // Use per-file actor from ChangeProcessor (already did content-based matching)
          // Actor now includes sessionId and turnNumber from provenance
          attribution = {
            agent: {
              agentId: fileChange.actor.id || 'unknown',
              agentName: fileChange.actor.name || 'Agent',
              sessionId: fileChange.actor.sessionId || '',
              turnNumber: fileChange.actor.turnNumber || 0,
              messageId: fileChange.actor.messageId,
              timestamp: Date.now(),
            },
            timestamp: Date.now(),
          };
          logger.debug('Using per-file agent attribution', {
            file: fileChange.path,
            agentId: fileChange.actor.id,
            agentName: fileChange.actor.name,
            sessionId: fileChange.actor.sessionId,
            turnNumber: fileChange.actor.turnNumber,
          });
        } else if (fileChange.content) {
          // Try content-based matching via AttributionEngine
          const attributionEngine = getAttributionEngine();
          const provenance = await attributionEngine.attributeChange(
            {
              filePath: fileChange.path,
              action: (fileChange.action?.toLowerCase() || 'modify') as any,
              additions,
              deletions,
              newContent: fileChange.content,
            },
            this.workspaceId,
          );

          if (provenance.source === 'agent' && provenance.agent) {
            attribution = {
              agent: {
                agentId: provenance.agent.id || 'unknown',
                agentName: provenance.agent.name || 'Agent',
                sessionId: provenance.agent.sessionId || '',
                turnNumber: 0,
                timestamp: Date.now(),
              },
              timestamp: Date.now(),
            };
            logger.debug('Content-based agent attribution matched', {
              file: fileChange.path,
              agentId: provenance.agent.id,
            });
          } else {
            attribution = { manual: true, timestamp: Date.now() };
          }
        } else if (changes.provenance?.source === 'agent') {
          // Legacy fallback: use batch-level provenance
          attribution = {
            agent: {
              agentId: changes.provenance?.agentId || changes.provenance?.agentName || 'unknown',
              agentName: changes.provenance?.agentName || 'unknown',
              sessionId: changes.provenance?.sessionId || '',
              turnNumber: changes.provenance?.turnNumber || 0,
              timestamp: Date.now(),
            },
            timestamp: Date.now(),
          };
          logger.debug('Using batch-level agent attribution', {
            file: fileChange.path,
            agentId: changes.provenance?.agentId,
          });
        } else {
          attribution = { manual: true, timestamp: Date.now() };
        }

        // Determine stage: use incoming stage if specified, otherwise:
        // - For full sync: default to Unstaged
        // - For partial updates: preserve existing stage if available
        let stage: ChangeStage;
        if (fileChange.stage === ChangeStage.Staged) {
          stage = ChangeStage.Staged;
        } else if (fileChange.stage === ChangeStage.Unstaged) {
          stage = ChangeStage.Unstaged;
        } else if (!isFullSync) {
          // For partial updates with undefined stage, preserve existing stage
          const existing = existingByFileOnly.get(fileChange.path);
          stage =
            existing?.stage === ChangeStage.Staged ? ChangeStage.Staged : ChangeStage.Unstaged;
        } else {
          stage = ChangeStage.Unstaged;
        }

        // Map action to file change status
        let status: FileChangeStatus = 'modified';
        if (fileChange.action === 'Create') {
          status = 'added';
        } else if (fileChange.action === 'Delete') {
          status = 'deleted';
        } else if (fileChange.action === 'Rename') {
          status = 'renamed';
        }

        // Store content as git blobs when in a git repo (follows change-processor.ts pattern)
        let newContent: string | undefined = fileChange.content || fileChange.newContent || '';
        let oldContent: string | undefined = fileChange.oldContent;
        let diff: string | undefined = fileChange.diff;
        let newContentSha: string | undefined;
        let oldContentSha: string | undefined;
        let diffSha: string | undefined;

        if (this.isGitRepo) {
          if (newContent) {
            const sha = await storeBlob(newContent, this.workspacePath);
            if (sha) {
              newContentSha = sha;
              newContent = undefined; // Don't store inline if blob succeeded
            }
          }
          if (oldContent) {
            const sha = await storeBlob(oldContent, this.workspacePath);
            if (sha) {
              oldContentSha = sha;
              oldContent = undefined; // Don't store inline if blob succeeded
            }
          }
          if (diff && diff.length > 10_000) {
            const sha = await storeBlob(diff, this.workspacePath);
            if (sha) {
              diffSha = sha;
              diff = undefined; // Don't store inline if blob succeeded
            }
          }
        }

        const trackedChange: TrackedChange = {
          id: uuidv4(),
          file: fileChange.path,
          relativePath: fileChange.path,
          stage,
          stats: { additions, deletions, binary: false },
          status,
          attribution,
          content: {
            ...(newContent !== undefined && { newContent }),
            ...(oldContent !== undefined && { oldContent }),
            ...(diff !== undefined && { diff }),
            ...(newContentSha && { newContentSha }),
            ...(oldContentSha && { oldContentSha }),
            ...(diffSha && { diffSha }),
          },
        };

        // Always track if it's a known action type or has line changes
        if (
          fileChange.action === 'Modify' ||
          fileChange.action === 'Create' ||
          fileChange.action === 'Delete' ||
          fileChange.action === 'Rename' ||
          additions > 0 ||
          deletions > 0
        ) {
          trackedChanges.push(trackedChange);
          logger.debug('Tracking change', {
            workspaceId: this.workspaceId,
            file: fileChange.path,
            action: fileChange.action,
            stage: trackedChange.stage,
          });
        } else {
          logger.debug('Skipping file - no changes detected', {
            workspaceId: this.workspaceId,
            file: fileChange.path,
            action: fileChange.action,
            additions,
            deletions,
          });
        }
      }

      // Track which file:stage pairs we've seen in the current git status
      // This is critical for handling MM status (file has both staged AND unstaged changes)
      const currentFilesSet = new Set(trackedChanges.map((c) => c.file));
      const currentFileStages = new Set(trackedChanges.map((c) => `${c.file}:${c.stage}`));

      // IMPORTANT: Only clear stale files during a full sync (from syncCurrentState)
      // Individual file change events from the change detector should NOT clear other files
      // because they only contain the changed file, not the full git status
      let entriesToClear: { file: string; stage: ChangeStage }[] = [];
      if (isFullSync) {
        // Remove tracked changes for file:stage pairs that are no longer in git status
        // BUT: Only remove unstaged/staged changes, keep committed ones
        // This handles the case where:
        // 1. Files are committed or reverted (clear both staged and unstaged)
        // 2. A file's unstaged changes are fully staged (clear only unstaged entry)
        // 3. A file's staged changes are fully unstaged (clear only staged entry)
        entriesToClear = existingChanges
          .filter((existing) => {
            const isUnstagedOrStaged =
              existing.stage === ChangeStage.Unstaged || existing.stage === ChangeStage.Staged;
            if (!isUnstagedOrStaged) return false;

            const fileStageKey = `${existing.file}:${existing.stage}`;
            const isNotInCurrentStatus = !currentFileStages.has(fileStageKey);
            return isNotInCurrentStatus;
          })
          .map((existing) => ({ file: existing.file, stage: existing.stage }));
      }

      if (entriesToClear.length > 0) {
        logger.debug('Removing stale entries for file:stage pairs no longer in git status', {
          count: entriesToClear.length,
          isFullSync,
          entriesToClear: entriesToClear.slice(0, 10), // Limit log size
          currentFilesInEvent: Array.from(currentFilesSet),
        });
        // Batch clear all entries by file:stage
        await this.fileTrackingService.clearFileStageEntriesBatch(entriesToClear);
      }

      // Batch track all current changes - use trackChangesBatch for efficiency
      // This does a single load + single save instead of N loads + N saves
      if (trackedChanges.length > 0) {
        // Log stage transitions for debugging
        for (const change of trackedChanges) {
          // Use file:stage key to find the correct existing entry
          const existing = existingByFileAndStage.get(`${change.file}:${change.stage}`);
          if (existing && existing.stage !== change.stage) {
            logger.debug('Updating file stage to match git state', {
              file: change.file,
              existingStage: existing.stage,
              newStage: change.stage,
            });
          }
        }

        // Use batch method - single storage operation for all changes
        await this.fileTrackingService.trackChangesBatch(trackedChanges);

        logger.debug('Tracked changes (batch)', {
          workspaceId: this.workspaceId,
          count: trackedChanges.length,
          changeId: changes.id,
        });
      }

      // Emit event to notify frontend if there were tracked changes
      // BUT: Suppress event if a stage operation is in progress to avoid reverting optimistic updates
      if (trackedChanges.length > 0) {
        // Check if all tracked changes are for files currently being staged/unstaged
        const allChangesAreStageOperations =
          this.stageOperationInProgress &&
          trackedChanges.every((c) => this.stageOperationPaths.has(c.file));

        if (allChangesAreStageOperations) {
          logger.debug('Suppressing changes-tracked event during stage operation', {
            workspaceId: this.workspaceId,
            changeCount: trackedChanges.length,
            suppressedPaths: trackedChanges.map((c) => c.file).slice(0, 5),
          });
        } else {
          const eventData = {
            workspaceId: this.workspaceId,
            changeCount: trackedChanges.length,
            source: changes.provenance?.source || 'unknown',
          };

          this.emit('changes-tracked', eventData);
          // NOTE: Individual file change events for the activity log are handled by
          // EventCoordinator → activity-log-event → workspace.ipc.ts → Redux (emitWorkspaceEvent)
        }
      }
    } catch (error) {
      logger.error('Failed to handle git changes', error as Error, {
        workspaceId: this.workspaceId,
        changeId: changes?.id,
      });
    }
  }

  /**
   * Handle committed changes - batch process all files at once for efficiency
   */
  private async handleCommittedChanges(commits: any[]): Promise<void> {
    try {
      const trackedChanges: TrackedChange[] = [];

      // Collect all changes from all commits
      for (const commit of commits) {
        for (const file of commit.files || []) {
          // Handle both string file paths and file objects
          const filePath = typeof file === 'string' ? file : file.path;

          const trackedChange: TrackedChange = {
            id: uuidv4(),
            file: filePath,
            relativePath: filePath,
            stage: ChangeStage.Committed,
            stats: { additions: 0, deletions: 0, binary: false },
            attribution: { manual: true, timestamp: new Date(commit.date).getTime() },
            commitHash: commit.hash,
          };

          trackedChanges.push(trackedChange);
        }
      }

      logger.debug('handleCommittedChanges: Collected changes', {
        commits: commits.length,
        files: trackedChanges.length,
        stages: trackedChanges.map((c) => c.stage),
      });

      // Batch save all changes at once (debounced)
      if (trackedChanges.length > 0) {
        // Pass a callback to emit event after save completes
        await this.fileTrackingService.saveChanges(trackedChanges, () => {
          logger.debug('Committed changes saved, emitting event', {
            commits: commits.length,
            files: trackedChanges.length,
          });

          // Emit event to notify frontend that committed changes were added
          // This will trigger the frontend to reload the file tracking data
          this.emit('changes-tracked', {
            workspaceId: this.workspaceId,
            changeCount: trackedChanges.length,
            source: 'committed-changes',
          });

          // Also emit individual file change events for timeline
          // NOTE: We intentionally do NOT emit file-changed events for historical committed changes.
          // These are commits that existed before the workspace was created and should not
          // appear in the activity log as recent modifications. The activity log should only
          // show changes that happen during the workspace session.
        });

        logger.debug('Queued committed changes for batch save', {
          commits: commits.length,
          files: trackedChanges.length,
        });
      }
    } catch (error) {
      logger.error('Failed to handle committed changes', error as Error);
    }
  }

  /**
   * Load committed changes from git history (cached - only reloads when HEAD changes)
   */
  private async loadCommittedChanges(): Promise<void> {
    const loadStart = Date.now();
    if (!this.gitService) {
      if (this.isRemote) {
        logger.debug(
          'Skipping loadCommittedChanges for remote workspace — local gitService cannot reach remote repo; committed changes arrive via watcher events',
          {
            workspaceId: this.workspaceId,
          },
        );
      }
      return;
    }

    try {
      // Check current HEAD to see if we need to reload
      const headStart = Date.now();
      const headResult = await this.gitService.getCurrentHead(this.workspaceId as any);
      const currentHead = headResult?.ok ? headResult.data : null;
      logger.debug('getCurrentHead completed', {
        workspaceId: this.workspaceId,
        durationMs: Date.now() - headStart,
      });

      // Skip if we've already loaded and HEAD hasn't changed
      if (this.committedChangesLoaded && currentHead === this.lastCommittedChangesHead) {
        logger.debug('Skipping committed changes load - HEAD unchanged', {
          workspaceId: this.workspaceId,
          head: currentHead?.substring(0, 8),
        });
        return;
      }

      logger.debug('Loading committed changes from git history', {
        workspaceId: this.workspaceId,
        previousHead: this.lastCommittedChangesHead?.substring(0, 8),
        currentHead: currentHead?.substring(0, 8),
      });

      // Load recent commits scoped to this workspace using baseRef/baseCommitSha
      const historyStart = Date.now();
      const commitsResult = await this.gitService.getHistory(
        this.workspaceId as any,
        5,
        this.workspaceCreatedAt, // since (fallback if merge-base and baseCommitSha both fail)
        this.baseRef,
        this.baseCommitSha,
      );
      logger.debug('getHistory completed', {
        workspaceId: this.workspaceId,
        durationMs: Date.now() - historyStart,
      });

      if (commitsResult.ok && commitsResult.data) {
        const { commits } = commitsResult.data;
        logger.debug('Loaded committed changes from git history', {
          workspaceId: this.workspaceId,
          commitCount: commits.length,
        });

        // Process the commits if any exist
        if (commits.length > 0) {
          const handleStart = Date.now();
          await this.handleCommittedChanges(commits);
          logger.debug('handleCommittedChanges completed', {
            workspaceId: this.workspaceId,
            durationMs: Date.now() - handleStart,
          });
        }

        // Mark as loaded and cache HEAD only on success
        this.committedChangesLoaded = true;
        this.lastCommittedChangesHead = currentHead;
      } else if (!commitsResult.ok) {
        // Log failure but don't mark as loaded - allow retry on next sync
        logger.debug('Failed to load committed changes, will retry on next sync', {
          workspaceId: this.workspaceId,
          error: commitsResult.error,
        });
      }

      logger.debug('loadCommittedChanges total', {
        workspaceId: this.workspaceId,
        totalDurationMs: Date.now() - loadStart,
      });
    } catch (error) {
      logger.debug('Failed to load committed changes from git history', {
        workspaceId: this.workspaceId,
        error: (error as Error).message,
      });
      // Don't fail the sync if we can't load committed changes
    }
  }

  /**
   * Get a signature for a change to detect duplicates
   */
  private getChangeSignature(changes: any): string {
    if (!changes || !changes.files) {
      return '';
    }

    // Create a signature based on the files and their actions
    const fileSignatures = changes.files
      .map((f: any) => `${f.action}:${f.path}:${f.additions || 0}:${f.deletions || 0}`)
      .sort()
      .join('|');

    return `${changes.provenance?.source || 'unknown'}:${fileSignatures}`;
  }
}
