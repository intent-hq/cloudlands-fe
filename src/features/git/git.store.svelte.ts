/**
 * Git Store
 *
 * Unified state management for git operations using Svelte 5 runes.
 * This is the single source of truth for git status in the application.
 */

import type { GitStatus, CommitInfo, WorkspaceId, Result, DiffChunk } from '$shared/types';
import { gitClient } from './git.client';
import { Logger } from '$shared/logger';
import { gitCache } from './git-cache';
import { isValidWorkspaceId } from '$shared/types/branded-ids';

const logger = new Logger('GitStore');

class GitStore {
  // State
  #status: GitStatus | null = $state(null);
  #commits: CommitInfo[] = $state([]);
  #diffs: DiffChunk[] = $state([]);
  #loading = $state(false);
  #error: string | null = $state(null);
  #workspaceId: WorkspaceId | null = $state(null);
  #branch: string | null = $state(null);
  #ahead: number = $state(0);
  #behind: number = $state(0);

  // Track which workspace the current data belongs to
  // This is different from #workspaceId which tracks which workspace we WANT to display
  // Must be $state to trigger reactivity when data loads
  #dataWorkspaceId: WorkspaceId | null = $state(null);

  // Track pending requests to prevent duplicates
  #pendingRequests = new Map<string, Promise<void>>();

  // Event listener cleanup for git:status-changed
  #eventListenerCleanup: (() => void) | null = null;
  #statusChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Getters
  get status() {
    // IMPORTANT: Always access #status first to ensure Svelte tracks it for reactivity
    // If we return early without accessing it, Svelte won't re-run effects when it changes
    const status = this.#status;

    // Return null if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      logger.debug('[GitStore] status getter returning null - workspace ID mismatch', {
        dataWorkspaceId: this.#dataWorkspaceId,
        workspaceId: this.#workspaceId,
      });
      return null;
    }
    logger.debug('[GitStore] status getter returning status', {
      workspaceId: this.#workspaceId,
      diverged: status?.diverged,
    });
    return status;
  }
  get commits() {
    // Return empty if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return [];
    }
    return this.#commits;
  }
  get diffs() {
    // Return empty if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return [];
    }
    return this.#diffs;
  }
  get loading() {
    return this.#loading;
  }
  get error() {
    return this.#error;
  }
  get workspaceId() {
    return this.#workspaceId;
  }
  get dataWorkspaceId() {
    return this.#dataWorkspaceId;
  }
  get branch() {
    return this.#branch;
  }
  get ahead() {
    // Return 0 if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return 0;
    }
    return this.#ahead;
  }
  get behind() {
    // Return 0 if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return 0;
    }
    return this.#behind;
  }

  // Derived state
  get hasChanges() {
    // Return false if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return false;
    }
    return this.#status ? this.#status.files.length > 0 : false;
  }

  get hasUnstagedChanges() {
    // Return false if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return false;
    }
    return this.#status?.files.some((f) => !f.staged) || false;
  }

  get hasStagedChanges() {
    // Return false if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return false;
    }
    return this.#status?.files.some((f) => f.staged) || false;
  }

  get hasUnpushedCommits() {
    // Return false if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return false;
    }
    return this.#ahead > 0;
  }

  get hasUnpulledCommits() {
    // Return false if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return false;
    }
    return this.#behind > 0;
  }

  get unstagedFiles() {
    // Return empty if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return [];
    }
    return this.#status?.files.filter((f) => !f.staged) || [];
  }

  get stagedFiles() {
    // Return empty if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return [];
    }
    return this.#status?.files.filter((f) => f.staged) || [];
  }

  get modifiedFiles() {
    // Return empty if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return [];
    }
    return this.#status?.files || [];
  }

  get hasConflicts() {
    // Git doesn't have a 'conflicted' status in the simple status output
    // Conflicts would typically show as 'U' in git status --porcelain
    // For now, return false as we don't have conflict detection in the simple GitStatus type
    return false;
  }
  get stagedCount() {
    // Return 0 if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return 0;
    }
    return this.#status ? this.#status.files.filter((f) => f.staged).length : 0;
  }
  get unstagedCount() {
    // Return 0 if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#workspaceId) {
      return 0;
    }
    return this.#status ? this.#status.files.filter((f) => !f.staged).length : 0;
  }

  // Actions
  async loadStatus(workspaceId: WorkspaceId, forceRefresh: boolean = false): Promise<void> {
    // Validate workspaceId before proceeding
    // Guard against invalid workspace IDs (e.g., "new" from /workspace/new route)
    if (!workspaceId || !isValidWorkspaceId(workspaceId)) {
      logger.warn('loadStatus called with invalid workspaceId', { workspaceId });
      this.#error = 'Invalid workspace ID';
      return;
    }

    // Check if there's already a pending request for this workspace
    const requestKey = `${workspaceId}-${forceRefresh}`;
    const pending = this.#pendingRequests.get(requestKey);
    if (pending) {
      logger.debug('Reusing pending status request', { workspaceId, forceRefresh });
      return pending;
    }

    // Create the promise for this request
    const requestPromise = this._doLoadStatus(workspaceId, forceRefresh);
    this.#pendingRequests.set(requestKey, requestPromise);

    // Clean up after completion
    requestPromise.finally(() => {
      this.#pendingRequests.delete(requestKey);
    });

    return requestPromise;
  }

  private async _doLoadStatus(workspaceId: WorkspaceId, forceRefresh: boolean): Promise<void> {
    // Check cache first unless force refresh
    const cacheKey = `git-status-${workspaceId}`;
    if (!forceRefresh) {
      const cached = gitCache.get<GitStatus>(cacheKey, 30000); // 30 second cache
      if (cached) {
        logger.debug('Using cached git status', { workspaceId });
        // Set cached data immediately to prevent UI jank
        this.#status = cached;
        this.#workspaceId = workspaceId;
        // Mark that this data belongs to this workspace
        this.#dataWorkspaceId = workspaceId;

        // Still fetch fresh data in background if cache is older than 5 seconds
        const cacheAge = gitCache.getAge(cacheKey);
        if (cacheAge && cacheAge > 5000) {
          // Fetch fresh data in background without blocking
          this._fetchFreshStatus(workspaceId, cacheKey).catch((error) => {
            logger.debug('Background status refresh failed', { error });
          });
        }
        return;
      }
    }

    logger.debug('Loading status for workspace', { workspaceId });
    this.#loading = true;
    this.#error = null;
    this.#workspaceId = workspaceId;

    try {
      const result = await gitClient.getStatus(workspaceId);

      if (result.ok) {
        logger.debug('[GitStore] loadStatus setting status', {
          workspaceId,
          diverged: result.data.diverged,
          currentDataWorkspaceId: this.#dataWorkspaceId,
          currentWorkspaceId: this.#workspaceId,
        });
        this.#status = result.data;
        // Mark that this data belongs to this workspace
        this.#dataWorkspaceId = workspaceId;
        // Cache the result
        gitCache.set(cacheKey, result.data);

        // Also load branch info (non-blocking)
        this.loadBranchInfo(workspaceId).catch((err) =>
          logger.debug('Failed to load branch info', { workspaceId, error: err }),
        );
      } else {
        logger.error('Failed to load status', undefined, { error: result.error });
        this.#error = result.error;
      }
    } catch (error) {
      logger.error('Exception loading status', error as Error);
      this.#error = error instanceof Error ? error.message : 'Failed to load git status';
    } finally {
      this.#loading = false;
    }
  }

  async loadCommits(
    workspaceId: WorkspaceId,
    limit?: number,
    since?: string,
    baseRef?: string,
    baseCommitSha?: string,
  ): Promise<void> {
    // Deduplicate concurrent loadCommits calls with the same parameters
    const requestKey = `commits-${workspaceId}-${limit ?? 50}-${since ?? ''}-${baseRef ?? ''}-${baseCommitSha ?? ''}`;
    const pending = this.#pendingRequests.get(requestKey);
    if (pending) {
      logger.debug('Reusing pending loadCommits request', { workspaceId, limit });
      return pending;
    }

    const requestPromise = this._doLoadCommits(workspaceId, limit, since, baseRef, baseCommitSha);
    this.#pendingRequests.set(requestKey, requestPromise);
    requestPromise.finally(() => {
      this.#pendingRequests.delete(requestKey);
    });
    return requestPromise;
  }

  private async _doLoadCommits(
    workspaceId: WorkspaceId,
    limit?: number,
    since?: string,
    baseRef?: string,
    baseCommitSha?: string,
  ): Promise<void> {
    this.#loading = true;
    this.#error = null;

    try {
      const result = await gitClient.getHistory(workspaceId, limit, since, baseRef, baseCommitSha);
      if (result.ok) {
        this.#commits = result.data;
        // Mark that this data belongs to this workspace
        this.#dataWorkspaceId = workspaceId;
      } else {
        this.#error = result.error;
      }
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'Failed to load commits';
    } finally {
      this.#loading = false;
    }
  }

  private async _fetchFreshStatus(workspaceId: WorkspaceId, cacheKey: string): Promise<void> {
    try {
      const result = await gitClient.getStatus(workspaceId);
      if (result.ok) {
        // Update cache and state with fresh data
        gitCache.set(cacheKey, result.data);
        this.#status = result.data;
        // Mark that this data belongs to this workspace
        this.#dataWorkspaceId = workspaceId;
        logger.debug('Background status refresh complete', { workspaceId });
      }
    } catch (error) {
      // Silently fail - we already have cached data
      logger.debug('Background status refresh failed', { error });
    }
  }

  async loadDiffs(workspaceId: WorkspaceId): Promise<void> {
    this.#loading = true;
    this.#error = null;

    try {
      const result = await gitClient.getDiff(workspaceId);
      if (result.ok) {
        this.#diffs = result.data;
        // Mark that this data belongs to this workspace
        this.#dataWorkspaceId = workspaceId;
      } else {
        this.#error = result.error;
      }
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'Failed to load diffs';
    } finally {
      this.#loading = false;
    }
  }

  async commit(workspaceId: WorkspaceId, message: string): Promise<Result<CommitInfo, string>> {
    try {
      const result = await gitClient.commit(workspaceId, message);
      if (result.ok) {
        // Invalidate cache and refresh status after commit
        gitCache.invalidateWorkspace(workspaceId);
        await this.loadStatus(workspaceId, true); // Force refresh
      } else {
        this.#error = result.error;
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Commit failed';
      this.#error = errorMsg;
      return { ok: false, error: errorMsg };
    }
  }

  async push(workspaceId: WorkspaceId, force?: boolean): Promise<Result<void, string>> {
    try {
      const result = await gitClient.push(workspaceId, undefined, force);
      if (result.ok) {
        // Invalidate cache and refresh status after push
        gitCache.invalidateWorkspace(workspaceId);
        await this.loadStatus(workspaceId, true);
      } else {
        this.#error = result.error;
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Push failed';
      this.#error = errorMsg;
      return { ok: false, error: errorMsg };
    }
  }

  async pull(workspaceId: WorkspaceId): Promise<Result<void, string>> {
    try {
      const result = await gitClient.pull(workspaceId);
      if (result.ok) {
        // Invalidate cache and refresh status after pull
        gitCache.invalidateWorkspace(workspaceId);
        await this.loadStatus(workspaceId, true);
      } else {
        this.#error = result.error;
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Pull failed';
      this.#error = errorMsg;
      return { ok: false, error: errorMsg };
    }
  }

  async stageFile(workspaceId: WorkspaceId, filePath: string): Promise<Result<void, string>> {
    try {
      logger.debug('Staging file for workspace', { filePath, workspaceId });
      const result = await gitClient.stageFiles(workspaceId, [filePath]);
      logger.debug('Stage result', { ok: result.ok });

      if (result.ok) {
        logger.debug('Stage successful, refreshing status');
        await this.loadStatus(workspaceId);
        logger.debug('Status refreshed', { fileCount: this.#status?.files.length });
      } else {
        logger.error('Stage failed', undefined, { error: result.error });
        this.#error = result.error;
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to stage file';
      logger.error('Stage exception', error as Error);
      this.#error = errorMsg;
      return { ok: false, error: errorMsg };
    }
  }

  async unstageFile(workspaceId: WorkspaceId, filePath: string): Promise<Result<void, string>> {
    try {
      const result = await gitClient.unstageFiles(workspaceId, [filePath]);
      if (result.ok) {
        await this.loadStatus(workspaceId);
      } else {
        this.#error = result.error;
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to unstage file';
      this.#error = errorMsg;
      return { ok: false, error: errorMsg };
    }
  }

  /**
   * Stage a specific hunk from a file.
   *
   * @param workspaceId - The workspace ID
   * @param filePath - Path to the file containing the hunk
   * @param hunkPatch - The unified diff patch for the hunk (including file headers)
   */
  async stageHunk(
    workspaceId: WorkspaceId,
    filePath: string,
    hunkPatch: string,
  ): Promise<Result<void, string>> {
    try {
      const result = await gitClient.stageHunk(workspaceId, filePath, hunkPatch);
      if (result.ok) {
        // Force refresh to bypass cache - git state has changed
        gitCache.invalidateWorkspace(workspaceId);
        await this.loadStatus(workspaceId, true);
      } else {
        this.#error = result.error;
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to stage hunk';
      this.#error = errorMsg;
      return { ok: false, error: errorMsg };
    }
  }

  /**
   * Unstage a specific hunk from a file.
   *
   * @param workspaceId - The workspace ID
   * @param filePath - Path to the file containing the hunk
   * @param hunkPatch - The unified diff patch for the hunk (including file headers)
   */
  async unstageHunk(
    workspaceId: WorkspaceId,
    filePath: string,
    hunkPatch: string,
  ): Promise<Result<void, string>> {
    try {
      const result = await gitClient.unstageHunk(workspaceId, filePath, hunkPatch);
      if (result.ok) {
        // Force refresh to bypass cache - git state has changed
        gitCache.invalidateWorkspace(workspaceId);
        await this.loadStatus(workspaceId, true);
      } else {
        this.#error = result.error;
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to unstage hunk';
      this.#error = errorMsg;
      return { ok: false, error: errorMsg };
    }
  }

  async removeLockFile(workspaceId: WorkspaceId): Promise<boolean> {
    try {
      const result = await gitClient.removeLockFile(workspaceId);
      if (result.ok) {
        // Refresh status after removing lock
        await this.loadStatus(workspaceId);
        return true;
      } else {
        this.#error = result.error;
        return false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to remove lock file';
      this.#error = errorMsg;
      return false;
    }
  }

  clearError(): void {
    this.#error = null;
  }

  async loadBranchInfo(workspaceId: WorkspaceId): Promise<void> {
    try {
      // Branch info is already available in the status
      // If we have status, extract branch info from it
      if (this.#status) {
        this.#branch = this.#status.branch || 'main';
        this.#ahead = this.#status.ahead || 0;
        this.#behind = this.#status.behind || 0;
      } else {
        // If no status loaded yet, use loadStatus to go through dedup
        await this.loadStatus(workspaceId);
        // After loadStatus completes, #status should be populated
        // Cast needed because TS control-flow narrows #status to null in the else branch
        // and doesn't re-widen after the await (the $state proxy confuses narrowing further)
        const freshStatus = this.#status as GitStatus | null;
        if (freshStatus) {
          this.#branch = freshStatus.branch || 'main';
          this.#ahead = freshStatus.ahead || 0;
          this.#behind = freshStatus.behind || 0;
        }
      }
    } catch (error) {
      // Non-critical, don't set error state
      logger.debug('Branch info load error', { error });
    }
  }

  /**
   * Initialize a central git:status-changed event listener for a workspace.
   * This ensures git cache invalidation and status refresh happen regardless of
   * which sidebar panel is active. Call this when a workspace is opened.
   * Automatically cleans up any previous listener (handles workspace switching).
   */
  initEventListener(workspaceId: WorkspaceId): void {
    // Clean up any existing listener first (handles workspace switching)
    this.disposeEventListener();

    if (
      !workspaceId ||
      !isValidWorkspaceId(workspaceId) ||
      typeof window === 'undefined' ||
      !(window as unknown as Record<string, unknown>).electronAPI
    ) {
      return;
    }

    const electronAPI = (window as unknown as Record<string, unknown>).electronAPI as {
      on: (event: string, handler: (...args: unknown[]) => void) => string;
      offById: (event: string, id: string) => void;
    };

    const DEBOUNCE_MS = 500;

    const listenerId = electronAPI.on(
      'git:status-changed',
      (data: unknown) => {
        const payload = data as { workspaceId?: string };
        if (payload?.workspaceId !== workspaceId) return;

        logger.debug('[GitStore] git:status-changed received', { workspaceId });

        if (this.#statusChangeDebounceTimer) {
          clearTimeout(this.#statusChangeDebounceTimer);
        }

        this.#statusChangeDebounceTimer = setTimeout(() => {
          // Invalidate all git cache entries for this workspace
          gitCache.invalidateWorkspace(workspaceId);
          // Reload git status with force refresh to bypass any caching
          this.loadStatus(workspaceId, true);
        }, DEBOUNCE_MS);
      },
    );

    this.#eventListenerCleanup = () => {
      if (listenerId && electronAPI.offById) {
        electronAPI.offById('git:status-changed', listenerId);
      }
      if (this.#statusChangeDebounceTimer) {
        clearTimeout(this.#statusChangeDebounceTimer);
        this.#statusChangeDebounceTimer = null;
      }
    };

    logger.debug('[GitStore] Initialized git:status-changed listener', { workspaceId });
  }

  /**
   * Clean up the event listener. Called when switching workspaces or disposing.
   */
  disposeEventListener(): void {
    if (this.#eventListenerCleanup) {
      this.#eventListenerCleanup();
      this.#eventListenerCleanup = null;
    }
  }

  reset(): void {
    this.disposeEventListener();
    this.#status = null;
    this.#commits = [];
    this.#diffs = [];
    this.#loading = false;
    this.#error = null;
    this.#workspaceId = null;
    this.#branch = null;
    this.#ahead = 0;
    this.#behind = 0;
    this.#dataWorkspaceId = null;
  }
}

export const gitStore = new GitStore();
