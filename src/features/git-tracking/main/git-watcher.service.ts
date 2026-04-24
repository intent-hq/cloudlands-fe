/**
 * Git Watcher Service
 *
 * Watches for file system changes and git state changes made outside the app.
 * Detects external modifications and syncs them with the activity log.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import * as path from 'path';
import * as fs from 'fs';
import * as parcelWatcher from '@parcel/watcher';
import { GitStateManager } from './git-state-manager';
import { ActorType, EventActor, createWorkspaceEvent } from '../../events/types';
import { emitWorkspaceEvent } from '../../../store/main/slices/workspace-events/workspace-events-slice';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import { gitStatusChanged } from '../../../store/main/slices/git-events/git-events-slice';
import { Logger } from '../../../shared/logger';
import type { WorkspaceId } from '../../../shared/types';
import { gitService } from '../../git/main/git.service';
import {
  UnifiedWorkspaceWatcher,
  type WatchEvent,
} from '../../workspace/main/unified-workspace-watcher';

/**
 * Pending file change tracked internally by the watcher.
 * This is distinct from the shared FileChange type in change-detector.types.ts
 * because it tracks watcher-specific metadata like relativePath.
 */
interface PendingFileChange {
  path: string;
  relativePath: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  oldPath?: string;
  additions?: number;
  deletions?: number;
}

// Simple debounce implementation to avoid lodash import issues
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

const logger = new Logger('GitWatcherService');

export interface GitWatcherConfig {
  enabled?: boolean;
  debounceDelay?: number;
  ignorePatterns?: string[];
  watchGitDir?: boolean;
  usePolling?: boolean;
}

export class GitWatcherService extends EventEmitter {
  private unsubscribeMain: (() => void) | null = null;
  private unsubscribeGit: (() => void) | null = null;
  /** Subscription for watching worktree gitdir (when .git is a file pointing to main repo's .git/worktrees/) */
  private worktreeGitdirSubscription: parcelWatcher.AsyncSubscription | null = null;
  /** Monotonically increasing counter; incremented in start() and stop() to invalidate stale async callbacks */
  private startEpoch = 0;
  private lastKnownFiles = new Map<string, { size: number; mtime: number }>();
  private pendingChanges = new Map<string, PendingFileChange>();
  private debouncedProcessChanges: any;
  /** Last known HEAD SHA - used to detect external rebases/resets that change HEAD */
  private lastKnownHeadSha: string | undefined = undefined;
  /** Timer for follow-up verification poll after .git/ changes */
  private pendingFollowUpTimeout: NodeJS.Timeout | null = null;

  private readonly config: Required<GitWatcherConfig> = {
    enabled: true,
    debounceDelay: 1000, // 1 second
    ignorePatterns: [
      '**/node_modules/**',
      '**/.git/**', // Ignore entire .git directory by default
      '**/.svn/**',
      '**/.hg/**',
      '**/CVS/**',
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/*.log',
      '**/.workspace/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/target/**',
      '**/.next/**',
      '**/.nuxt/**',
      '**/.cache/**',
      '**/.parcel-cache/**',
      '**/.vscode/**',
      '**/.idea/**',
      '**/coverage/**',
      '**/.nyc_output/**',
      '**/.pytest_cache/**',
      '**/__pycache__/**',
      '**/*.pyc',
      '**/venv/**',
      '**/env/**',
      '**/.env/**',
      '**/vendor/**',
      '**/bower_components/**',
      '**/.sass-cache/**',
      '**/tmp/**',
      '**/temp/**',
      '**/.tmp/**',
      '**/.temp/**',
    ],
    watchGitDir: true, // Watch .git dir so git operations (commit, checkout, reset) are detected immediately
    usePolling: false, // Use native fsevents on macOS for better performance
  };

  constructor(
    private readonly workspaceId: string,
    private readonly worktreePath: string,
    private readonly gitStateManager: GitStateManager,
    private readonly _eventServiceRemoved: null = null,
    config?: GitWatcherConfig,
  ) {
    super();
    this.config = { ...this.config, ...config };

    if (this.config.enabled) {
      this.start();
    }
  }

  /**
   * Start watching for changes
   */
  start(): void {
    if (this.unsubscribeMain) {
      return;
    }

    // Increment epoch to invalidate any stale async callbacks from a previous start/stop cycle
    this.startEpoch++;

    logger.info('Starting git watcher', {
      workspaceId: this.workspaceId,
      path: this.worktreePath,
    });

    try {
      const unifiedWatcher = UnifiedWorkspaceWatcher.getInstance(
        this.workspaceId,
        this.worktreePath,
      );

      // Subscribe for working directory changes (excluding ignored patterns)
      this.unsubscribeMain = unifiedWatcher.subscribe({
        id: `git-watcher-main-${this.workspaceId}`,
        pathPatterns: ['**'],
        eventTypes: ['add', 'change', 'unlink'],
        callback: (event: WatchEvent) => {
          if (this.isIgnoredPath(event.relativePath)) return;

          switch (event.type) {
            case 'add':
              this.handleFileAdd(event.path);
              break;
            case 'change':
              this.handleFileChange(event.path);
              break;
            case 'unlink':
              this.handleFileDelete(event.path);
              break;
          }
        },
        onRescanRequired: () => {
          logger.info('Rescan required for worktree, syncing git state', {
            workspaceId: this.workspaceId,
          });
          this.gitStateManager.syncState().catch((error) => {
            logger.error(
              'Failed to sync git state during rescan',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
        },
      });

      // Watch .git directory for git operations (only if explicitly enabled)
      if (this.config.watchGitDir) {
        this.watchGitDirectory();
      }

      // Process pending changes periodically with longer debounce for better performance
      this.debouncedProcessChanges = debounce(
        this.processPendingChanges.bind(this),
        Math.max(this.config.debounceDelay, 1000), // Ensure at least 1 second debounce
      );

      logger.info('Git watcher ready (using unified watcher)', {
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      logger.error(
        'Failed to start git watcher',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    // Increment epoch to invalidate any pending async callbacks from the current start
    this.startEpoch++;

    if (this.unsubscribeMain) {
      this.unsubscribeMain();
      this.unsubscribeMain = null;
    }

    if (this.unsubscribeGit) {
      this.unsubscribeGit();
      this.unsubscribeGit = null;
    }

    // Clean up worktree gitdir watcher if active
    if (this.worktreeGitdirSubscription) {
      try {
        await this.worktreeGitdirSubscription.unsubscribe();
      } catch (error) {
        logger.warn('Error closing worktree gitdir watcher', {
          workspaceId: this.workspaceId,
          error: error instanceof Error ? (error as NodeJS.ErrnoException).code ?? error.name : 'unknown',
        });
      }
      this.worktreeGitdirSubscription = null;
    }

    this.lastKnownFiles.clear();
    this.pendingChanges.clear();

    // Clear any pending follow-up verification timeout
    if (this.pendingFollowUpTimeout) {
      clearTimeout(this.pendingFollowUpTimeout);
      this.pendingFollowUpTimeout = null;
    }

    logger.info('Stopped git watcher', { workspaceId: this.workspaceId });
  }

  /**
   * Check if a relative path matches any of the configured ignore patterns.
   */
  private isIgnoredPath(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    for (const pattern of this.config.ignorePatterns) {
      if (this.matchesIgnorePattern(normalized, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Match a normalized relative path against a single glob-like ignore pattern.
   *
   * Supported pattern subset:
   *   - `** /dir/ **` — matches any path containing `/dir/` as a directory component
   *   - `** /*.ext` — matches any path ending with `.ext`
   *   - `** /.filename` — matches a dotfile by exact name anywhere in the path
   *
   * (Spaces added in patterns above to avoid closing JSDoc comment.)
   *
   * @param normalizedPath - Forward-slash normalized relative path
   * @param pattern - Glob-like pattern to match against
   * @returns true if the path matches the pattern
   */
  private matchesIgnorePattern(normalizedPath: string, pattern: string): boolean {
    let p = pattern;
    // Strip leading **/ prefix
    if (p.startsWith('**/')) {
      p = p.slice(3);
    }

    // Directory pattern (e.g., node_modules/**)
    if (p.endsWith('/**')) {
      const dir = p.slice(0, -3);
      return normalizedPath.startsWith(dir + '/') || normalizedPath.includes('/' + dir + '/');
    }

    // Suffix/extension match (e.g., *.log)
    if (p.startsWith('*')) {
      return normalizedPath.endsWith(p.slice(1));
    }

    // Exact filename match (e.g., .DS_Store)
    return normalizedPath === p || normalizedPath.endsWith('/' + p);
  }

  /** Patterns for git-internal files that should be ignored by the .git watcher */
  private readonly gitIgnorePatterns = [
    'index.lock',
    'FETCH_HEAD',
    'objects/',
    'logs/',
    'hooks/',
  ];

  /**
   * Check if a .git-relative path should be ignored.
   */
  private isIgnoredGitPath(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    // Strip the ".git/" prefix to get path relative to .git directory
    const gitRelative = normalized.startsWith('.git/')
      ? normalized.slice('.git/'.length)
      : normalized;

    for (const pattern of this.gitIgnorePatterns) {
      if (pattern.endsWith('/')) {
        if (gitRelative.startsWith(pattern)) return true;
      } else {
        if (gitRelative === pattern || gitRelative.endsWith('/' + pattern)) return true;
      }
    }
    return false;
  }

  /**
   * Handle file addition
   */
  private handleFileAdd(filePath: string): void {
    const relativePath = path.relative(this.worktreePath, filePath);

    logger.debug('External file added', { filePath: relativePath });

    this.pendingChanges.set(filePath, {
      path: filePath,
      relativePath,
      action: 'create',
    });

    this.debouncedProcessChanges();
  }

  /**
   * Handle file change
   */
  private handleFileChange(filePath: string): void {
    const relativePath = path.relative(this.worktreePath, filePath);

    logger.debug('External file changed', { filePath: relativePath });

    this.pendingChanges.set(filePath, {
      path: filePath,
      relativePath,
      action: 'modify',
    });

    this.debouncedProcessChanges();
  }

  /**
   * Handle file deletion
   */
  private handleFileDelete(filePath: string): void {
    const relativePath = path.relative(this.worktreePath, filePath);

    logger.debug('External file deleted', { filePath: relativePath });

    this.pendingChanges.set(filePath, {
      path: filePath,
      relativePath,
      action: 'delete',
    });

    this.debouncedProcessChanges();
  }

  /**
   * Process pending changes
   */
  private async processPendingChanges(): Promise<void> {
    if (this.pendingChanges.size === 0) {
      return;
    }

    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();

    // Group changes by type
    const created: PendingFileChange[] = [];
    const modified: PendingFileChange[] = [];
    const deleted: PendingFileChange[] = [];

    for (const change of changes) {
      switch (change.action) {
        case 'create':
          created.push(change);
          break;
        case 'modify':
          modified.push(change);
          break;
        case 'delete':
          deleted.push(change);
          break;
      }
    }

    // Create activity log entries for external changes
    const actor: EventActor = {
      type: 'external' as ActorType,
      id: 'external',
      name: 'External Change',
    };

    // Log file changes via Redux
    const allChanges = [...created, ...modified, ...deleted];
    for (const file of allChanges) {
      const event = createWorkspaceEvent(
        'file:changed',
        this.workspaceId,
        actor,
        { path: file.path, relativePath: file.path, action: file.action, additions: file.additions, deletions: file.deletions },
      );
      mainDispatch(emitWorkspaceEvent(event));
    }

    // Trigger git state sync
    await this.gitStateManager.syncState();

    // Emit event
    this.emit('external-changes', {
      created: created.length,
      modified: modified.length,
      deleted: deleted.length,
      files: changes,
    });

    logger.info('Processed external changes', {
      workspaceId: this.workspaceId,
      created: created.length,
      modified: modified.length,
      deleted: deleted.length,
    });
  }

  /**
   * Watch .git directory for git operations.
   * Handles both regular repos (where .git is a directory) and worktrees
   * (where .git is a file pointing to the main repo's .git/worktrees/<name>/).
   */
  private watchGitDirectory(): void {
    try {
      const unifiedWatcher = UnifiedWorkspaceWatcher.getInstance(
        this.workspaceId,
        this.worktreePath,
      );

      // Debounced handler for git changes.
      // 300ms debounce: FSEvents delivers rapidly, but a single git operation
      // (e.g., commit) can touch 5-10 files in .git/, so 300ms batches these
      // without adding perceptible delay to sidebar updates.
      const handleGitChange = debounce(async () => {
        // Cancel any pending follow-up verification since a fresh debounce supersedes it
        if (this.pendingFollowUpTimeout) {
          clearTimeout(this.pendingFollowUpTimeout);
          this.pendingFollowUpTimeout = null;
        }

        logger.debug('Git directory changed, syncing state');

        try {
          // Capture HEAD SHA before sync
          const previousHeadSha = this.lastKnownHeadSha;

          // Sync git state
          await this.gitStateManager.syncState();

          // Clear GitService caches so next IPC request gets fresh data
          gitService.clearStatusCache(this.workspaceId as WorkspaceId);

          // Emit git:status-changed to notify renderer to refresh git status
          mainDispatch(gitStatusChanged({
            workspaceId: this.workspaceId as WorkspaceId,
          }));

          // Check for new commits, branches, etc.
          const state = this.gitStateManager.getState();
          if (state) {
            // Track HEAD SHA and detect changes (e.g., external rebase)
            const newHeadSha = state.branch?.lastCommit?.sha;
            if (newHeadSha && newHeadSha !== previousHeadSha) {
              logger.info('HEAD SHA changed', {
                workspaceId: this.workspaceId,
                previousSha: previousHeadSha?.slice(0, 8) ?? 'none',
                newSha: newHeadSha.slice(0, 8),
              });
            }
            this.lastKnownHeadSha = newHeadSha;

            // Log git operations based on state changes
            await this.detectGitOperations(state);
          }

          // Schedule a ONE-SHOT follow-up verification after 1500ms to catch missed FSEvents.
          // This handles cases where rapid .git/ changes during rebase get coalesced by FSEvents,
          // causing us to miss the final state transition.
          // Capture current epoch to avoid running if stop() was called.
          const followUpEpoch = this.startEpoch;
          const headShaAtScheduleTime = this.lastKnownHeadSha;

          this.pendingFollowUpTimeout = setTimeout(async () => {
            this.pendingFollowUpTimeout = null;

            // Check if watcher was stopped/restarted since we scheduled this
            if (followUpEpoch !== this.startEpoch) {
              return;
            }

            try {
              logger.debug('Running follow-up verification poll for git state');

              // Note: syncState() may return early if a sync is already in progress
              // (sets pendingSync=true and returns). We don't rely on it completing
              // before emitting the status-changed event below.
              await this.gitStateManager.syncState();
              const followUpState = this.gitStateManager.getState();
              const followUpHeadSha = followUpState?.branch?.lastCommit?.sha;

              // Log if HEAD SHA changed (informational - helps diagnose missed FSEvents)
              if (followUpHeadSha && followUpHeadSha !== headShaAtScheduleTime) {
                logger.info('Follow-up detected HEAD SHA change', {
                  workspaceId: this.workspaceId,
                  previousSha: headShaAtScheduleTime?.slice(0, 8) ?? 'none',
                  newSha: followUpHeadSha.slice(0, 8),
                });
              }

              // Always clear cache and emit status-changed to refresh UI.
              // This ensures refresh happens even if:
              // 1. syncState() returned early due to concurrent sync (pendingSync=true)
              // 2. State changed without HEAD SHA moving (branch/upstream/status changes)
              gitService.clearStatusCache(this.workspaceId as WorkspaceId);
              mainDispatch(gitStatusChanged({
                workspaceId: this.workspaceId as WorkspaceId,
              }));

              // Update tracked SHA
              this.lastKnownHeadSha = followUpHeadSha;
            } catch (error) {
              logger.error(
                'Failed to run follow-up verification poll',
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          }, 1500);
        } catch (error) {
          logger.error(
            'Failed to handle git change',
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }, 300);

      // Subscribe to .git/ directory changes, filtering out noisy internal files
      this.unsubscribeGit = unifiedWatcher.subscribe({
        id: `git-watcher-gitdir-${this.workspaceId}`,
        pathPatterns: ['.git/'],
        eventTypes: ['add', 'change', 'unlink'],
        callback: (event: WatchEvent) => {
          if (this.isIgnoredGitPath(event.relativePath)) return;
          handleGitChange();
        },
        onRescanRequired: () => {
          logger.info('Rescan required for .git directory, syncing git state', {
            workspaceId: this.workspaceId,
          });
          handleGitChange();
        },
      });

      // For worktrees, .git is a file containing "gitdir: /path/to/main-repo/.git/worktrees/<name>"
      // The actual git state (HEAD, refs, index) lives in that directory, not in the worktree.
      // We need to watch that directory separately since UnifiedWorkspaceWatcher only watches
      // the worktree path itself.
      this.setupWorktreeGitdirWatcher(handleGitChange);
    } catch (error) {
      logger.error(
        'Failed to start git directory watcher',
        error instanceof Error ? error : new Error(String(error)),
      );
      // Don't fail the entire watcher if git watching fails
    }
  }

  /**
   * Set up a separate watcher for worktree gitdir.
   * In git worktrees, .git is a file pointing to the main repo's .git/worktrees/<name>/ directory.
   * That directory contains HEAD, index, refs, etc. and needs to be watched separately.
   */
  private setupWorktreeGitdirWatcher(handleGitChange: () => void): void {
    const gitPath = path.join(this.worktreePath, '.git');

    try {
      const stat = fs.statSync(gitPath);

      // If .git is a directory, this is a regular repo - UnifiedWorkspaceWatcher handles it
      if (stat.isDirectory()) {
        return;
      }

      // .git is a file - this is a worktree
      if (stat.isFile()) {
        const content = fs.readFileSync(gitPath, 'utf-8').trim();
        const match = content.match(/^gitdir:\s*(.+)$/m);

        if (!match) {
          logger.warn('Worktree .git file does not contain gitdir path', {
            workspaceId: this.workspaceId,
          });
          return;
        }

        // Resolve the gitdir path (it may be relative)
        const gitdirPath = path.resolve(this.worktreePath, match[1].trim());

        if (!fs.existsSync(gitdirPath)) {
          logger.warn('Worktree gitdir path does not exist', {
            workspaceId: this.workspaceId,
            gitdirPath: path.basename(gitdirPath),
          });
          return;
        }

        logger.info('Setting up worktree gitdir watcher', {
          workspaceId: this.workspaceId,
          gitdirPath: path.basename(gitdirPath),
        });

        // Capture current epoch so we can detect if stop/restart happened while subscribing
        const subscribeEpoch = this.startEpoch;

        // Watch the gitdir using @parcel/watcher directly
        // We can't use UnifiedWorkspaceWatcher because it's scoped to the worktree path
        parcelWatcher
          .subscribe(
            gitdirPath,
            (err, events) => {
              if (err) {
                logger.error(
                  'Worktree gitdir watcher error',
                  new Error(err instanceof Error ? (err as NodeJS.ErrnoException).code ?? err.name : 'unknown'),
                  { workspaceId: this.workspaceId },
                );
                return;
              }

              // Filter out noisy internal files and trigger git change handler
              for (const event of events) {
                const relativePath = path.relative(gitdirPath, event.path);
                if (!this.isIgnoredGitPath(relativePath)) {
                  handleGitChange();
                  break; // Only need to trigger once per batch
                }
              }
            },
            {
              // Ignore noisy subdirectories within the gitdir
              ignore: ['objects', 'logs', 'hooks', 'lfs', 'info', 'rr-cache'],
            },
          )
          .then((subscription) => {
            if (subscribeEpoch !== this.startEpoch) {
              // A stop() or stop→start cycle occurred since we started subscribing — discard
              subscription.unsubscribe().catch((err) => {
                logger.warn('Error closing stale worktree gitdir watcher', {
                  workspaceId: this.workspaceId,
                  error: err instanceof Error ? (err as NodeJS.ErrnoException).code ?? err.name : 'unknown',
                });
              });
              return;
            }
            this.worktreeGitdirSubscription = subscription;
            logger.info('Worktree gitdir watcher started', {
              workspaceId: this.workspaceId,
              gitdirPath: path.basename(gitdirPath),
            });
          })
          .catch((error) => {
            logger.error(
              'Failed to start worktree gitdir watcher',
              new Error(error instanceof Error ? (error as NodeJS.ErrnoException).code ?? error.name : 'unknown'),
              { workspaceId: this.workspaceId },
            );
          });
      }
    } catch (error) {
      // .git doesn't exist or other error - just log and continue
      logger.debug('Could not check .git for worktree detection', {
        workspaceId: this.workspaceId,
        error: error instanceof Error ? (error as NodeJS.ErrnoException).code ?? error.name : 'unknown',
      });
    }
  }

  /**
   * Detect git operations from state changes
   */
   
  private async detectGitOperations(_state: any): Promise<void> {
    // This would compare with previous state to detect:
    // - New commits
    // - Branch switches
    // - Merges
    // - Stashes
    // etc.
  }

  /**
   * Get watcher statistics
   */
  getStats(): {
    watching: boolean;
    filesWatched: number;
    pendingChanges: number;
    } {
    return {
      watching: this.unsubscribeMain !== null,
      filesWatched: this.lastKnownFiles.size,
      pendingChanges: this.pendingChanges.size,
    };
  }
}
