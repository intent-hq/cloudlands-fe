/**
 * Workspace Store
 *
 * Simple, reactive state management for workspaces using Svelte 5 runes.
 * No complex abstractions, just straightforward state.
 */

import type {
  CreateWorkspaceRequest,
  Result,
  TaskStatus,
  Workspace,
  WorkspaceId,
  WorkspaceUIContext,
} from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { EXCLUDED_STATUSES, IN_PROGRESS_STATUSES } from '$shared/utils/task-stats';
import { listenSync } from '$lib/electron-bridge';
import { Logger } from '../../shared/logger';
import { workspaceClient, normalizeWorkspacePaths } from './workspace.client';
import { workspaceRecencyStore } from './workspace-recency.store.svelte';
import { track } from '$lib/services/analytics';
import { clearDeferredResults } from '$features/agent/deferred-results-cache';
import { cleanupPRStatusForWorkspace } from '$features/git-tracking/pr-status.service';
import { invalidateAgentCache } from '$lib/utils/agent-loader';
import { unifiedStateStore } from '$features/agent/services/unified-state-store';
import { clearTransientUIStore } from './transient-ui-state.store.svelte';
import { lineChangesStore } from '$features/line-changes/line-changes.store.svelte';
import { workspaceStorageManager } from './workspace-storage-manager';

const logger = new Logger('WorkspaceStore');

class WorkspaceStore {
  // State
  #items: Workspace[] = $state([]);
  #current: Workspace | null = $state(null);
  #loading = $state(false);
  #error: string | null = $state(null);
  #isCreating = $state(false); // Track if we're in the middle of creating/duplicating
  #loadPromise: Promise<void> | null = null; // Track active load promise
  #pendingDeletions: Set<WorkspaceId> = new Set(); // Track workspaces pending deletion
  #pendingArchives: Set<WorkspaceId> = new Set(); // Track workspaces pending archive (prevents load() from restoring non-archived status)
  #pendingArchiveTimeouts: Map<WorkspaceId, ReturnType<typeof setTimeout>> = new Map(); // Safety timeouts for pending archives
  #pendingDeletionTimeouts: Map<WorkspaceId, ReturnType<typeof setTimeout>> = new Map(); // Track undo timeout handles
  #pendingCreations: Map<WorkspaceId, Workspace> = new Map(); // Track workspaces pending creation (not yet in backend)
  #hasLoaded = $state(false); // Track if initial load has completed at least once

  // Getters
  get items() {
    return this.#items;
  }
  get current() {
    return this.#current;
  }
  get loading() {
    return this.#loading;
  }
  get error() {
    return this.#error;
  }
  get hasLoaded() {
    return this.#hasLoaded;
  }
  get isCreating() {
    return this.#isCreating;
  }

  // Derived state
  get isEmpty() {
    return this.#items.length === 0;
  }
  get count() {
    return this.#items.length;
  }

  // Removed get recent() - it was unused and broke reactivity by returning a new array each time
  // If needed in the future, compute this in components using $derived

  // Actions with retry logic
  async load(retryCount = 0): Promise<void> {
    // Don't reload if we're in the middle of creating/duplicating
    if (this.#isCreating) {
      logger.debug('Skipping load - create/duplicate in progress');
      return;
    }

    // If already loading, return the existing promise
    if (this.#loadPromise && retryCount === 0) {
      logger.debug('Load already in progress, returning existing promise');
      return this.#loadPromise;
    }

    const MAX_RETRIES = 2; // Reduced from 3
    const RETRY_DELAY = 1000; // Start with 1 second

    // Create the load promise
    this.#loadPromise = this._doLoad(retryCount, MAX_RETRIES, RETRY_DELAY);

    try {
      await this.#loadPromise;
    } finally {
      // Clear the promise when done
      if (retryCount === 0) {
        this.#loadPromise = null;
      }
    }
  }

  private async _doLoad(
    retryCount: number,
    MAX_RETRIES: number,
    RETRY_DELAY: number,
  ): Promise<void> {
    this.#loading = true;
    // Only clear error on first attempt
    if (retryCount === 0) {
      this.#error = null;
    }

    try {
      // PERF: Workspace list loads must stay lite-only.
      // Expensive per-workspace summaries (diffSummary, agentSummary, taskStats,
      // gitSummary) are hydrated incrementally in the background and merged back
      // into the store via partial updates. Avoiding full list loads prevents
      // startup and refresh paths from spawning unbounded concurrent work.
      const useLiteMode = true;
      const result = await workspaceClient.list({ lite: useLiteMode });
      if (result.ok) {
        // Capture original statuses from backend response BEFORE mutation,
        // so the confirmation check below can compare against unmutated data.
        const originalStatuses = new Map<string, string>();
        for (const workspace of result.data) {
          if (workspace && workspace.id) {
            originalStatuses.set(workspace.id, workspace.status);
          }
        }

        // Deduplicate workspaces by ID to prevent duplicate key errors
        const uniqueWorkspaces = new Map<string, Workspace>();
        for (const workspace of result.data) {
          // Validate workspace before adding
          if (workspace && workspace.id && workspace.id !== 'undefined') {
            // Skip workspaces that are pending deletion (optimistically removed)
            if (!this.#pendingDeletions.has(workspace.id)) {
              // If pending archive, force archived status so load() doesn't restore non-archived state
              if (this.#pendingArchives.has(workspace.id)) {
                uniqueWorkspaces.set(workspace.id, {
                  ...workspace,
                  status: WorkspaceStatusEnum.Archived,
                  archived: true,
                  archivedAt: workspace.archivedAt ?? new Date().toISOString(),
                });
              } else {
                uniqueWorkspaces.set(workspace.id, workspace);
              }
              // If this workspace was pending creation and now appears in backend, remove from pending
              if (this.#pendingCreations.has(workspace.id)) {
                this.#pendingCreations.delete(workspace.id);
                logger.debug('Workspace now in backend, removed from pending creations', {
                  id: workspace.id,
                });
              }
            }
          } else {
            logger.warn('Skipping invalid workspace', { workspace });
          }
        }

        // FIX: Preserve workspaces that were just created but not yet in backend response
        // This prevents the "disappearing workspace" issue during the race between
        // create completing and the follow-up list refresh
        for (const [id, workspace] of this.#pendingCreations) {
          if (!uniqueWorkspaces.has(id) && !this.#pendingDeletions.has(id)) {
            uniqueWorkspaces.set(id, workspace);
            logger.debug('Preserving pending creation workspace in list', { id });
          }
        }

        // FIX: Preserve existing enrichment data (taskStats, diffSummary, agentSummary,
        // gitSummary) when the incoming response has undefined for those fields.
        // This can happen when:
        //  - The frontend always requests lite mode for bulk workspace lists
        //  - The backend independently forces lite mode (creationInProgressCount > 0)
        //  - Individual buildListWorkspace calls fail for specific workspaces
        // Without this, phase indicators show "not started" even for 10/10 complete tasks.
        if (this.#items.length > 0) {
          const existingById = new Map<string, Workspace>(this.#items.map((w) => [w.id, w]));
          for (const [id, workspace] of uniqueWorkspaces) {
            const existing = existingById.get(id);
            if (existing) {
              const taskStats = workspace.taskStats ?? existing.taskStats;
              const diffSummary = workspace.diffSummary ?? existing.diffSummary;
              const agentSummary = workspace.agentSummary ?? existing.agentSummary;
              const gitSummary = workspace.gitSummary ?? existing.gitSummary;
              const activePullRequest = workspace.activePullRequest ?? existing.activePullRequest;
              // Only create new object if something was actually preserved
              if (
                taskStats !== workspace.taskStats ||
                diffSummary !== workspace.diffSummary ||
                agentSummary !== workspace.agentSummary ||
                gitSummary !== workspace.gitSummary ||
                activePullRequest !== workspace.activePullRequest
              ) {
                uniqueWorkspaces.set(id, {
                  ...workspace,
                  taskStats,
                  diffSummary,
                  agentSummary,
                  gitSummary,
                  activePullRequest,
                });
              }
            }
          }
        }

        // Confirm pending archives: if the backend ORIGINALLY returned Archived status
        // (before our mutation) for a workspace in #pendingArchives, it's safe to remove
        // the guard. We must check originalStatuses (not uniqueWorkspaces) because the
        // mutation loop above already forced Archived status for pending archives.
        if (this.#pendingArchives.size > 0) {
          for (const pendingId of [...this.#pendingArchives]) {
            const originalStatus = originalStatuses.get(pendingId);
            if (originalStatus === WorkspaceStatusEnum.Archived) {
              this.#pendingArchives.delete(pendingId);
              const confirmedTimeout = this.#pendingArchiveTimeouts.get(pendingId);
              if (confirmedTimeout) { clearTimeout(confirmedTimeout); this.#pendingArchiveTimeouts.delete(pendingId); }
              logger.debug('Pending archive confirmed by backend', { id: pendingId });
            }
          }
        }

        // PERF: Only update #items if the workspace list actually changed.
        // Assigning a new array to $state triggers a full Svelte reactive flush
        // (147ms for 156 workspaces). Skip if the list is unchanged.
        const newItems = Array.from(uniqueWorkspaces.values());
        const itemsChanged =
          newItems.length !== this.#items.length ||
          newItems.some((w, i) => {
            const existing = this.#items[i];
            if (!existing) return true;
            if (w.id !== existing.id || w.updatedAt !== existing.updatedAt) return true;
            // Detect enrichment data changes (e.g. lite → full mode transition)
            const hadStats = existing.taskStats !== undefined;
            const hasStats = w.taskStats !== undefined;
            if (hadStats !== hasStats) return true;
            if (
              hasStats &&
              hadStats &&
              (w.taskStats!.total !== existing.taskStats!.total ||
                w.taskStats!.completed !== existing.taskStats!.completed ||
                w.taskStats!.inProgress !== existing.taskStats!.inProgress)
            )
              return true;
            const hadDiff = existing.diffSummary !== undefined;
            const hasDiff = w.diffSummary !== undefined;
            if (hadDiff !== hasDiff) return true;
            const hadAgent = existing.agentSummary !== undefined;
            const hasAgent = w.agentSummary !== undefined;
            if (hadAgent !== hasAgent) return true;
            const hadGit = existing.gitSummary !== undefined;
            const hasGit = w.gitSummary !== undefined;
            if (hadGit !== hasGit) return true;
            // Detect activePullRequest enrichment changes (ciStatus, reviewDecision, approvedBy)
            const hadPR = existing.activePullRequest != null;
            const hasPR = w.activePullRequest != null;
            if (hadPR !== hasPR) return true;
            if (hadPR && hasPR) {
              const oldPR = existing.activePullRequest!;
              const newPR = w.activePullRequest!;
              if (oldPR.status !== newPR.status) return true;
              const hadCI = oldPR.ciStatus != null;
              const hasCI = newPR.ciStatus != null;
              if (hadCI !== hasCI) return true;
              if (hadCI && hasCI) {
                if (
                  oldPR.ciStatus!.failed !== newPR.ciStatus!.failed ||
                  oldPR.ciStatus!.pending !== newPR.ciStatus!.pending ||
                  oldPR.ciStatus!.passed !== newPR.ciStatus!.passed ||
                  oldPR.ciStatus!.total !== newPR.ciStatus!.total
                )
                  return true;
              }
              if (oldPR.reviewDecision !== newPR.reviewDecision) return true;
              if (oldPR.mergeable !== newPR.mergeable) return true;
              if (oldPR.mergeableState !== newPR.mergeableState) return true;
              if (oldPR.approvalCount !== newPR.approvalCount) return true;
              // Compare approvedBy arrays by joining to string (order matters for display)
              const oldApprovedBy = oldPR.approvedBy?.join(',') ?? '';
              const newApprovedBy = newPR.approvedBy?.join(',') ?? '';
              if (oldApprovedBy !== newApprovedBy) return true;
            }
            return false;
          });
        if (itemsChanged) {
          this.#items = newItems;
        }
        this.#error = null; // Clear any previous errors on success
        this.#hasLoaded = true; // Mark that initial load has completed
        logger.info('Workspaces loaded successfully', { count: this.#items.length });
      } else {
        // Handle error response
        if (retryCount < MAX_RETRIES) {
          logger.warn('Failed to load workspaces, retrying...', {
            error: result.error,
            retryCount,
            maxRetries: MAX_RETRIES,
          });

          // Wait before retry with exponential backoff (capped at 4 seconds)
          const delay = Math.min(RETRY_DELAY * Math.pow(2, retryCount), 4000);
          await new Promise((resolve) => setTimeout(resolve, delay));

          // Retry
          return this.load(retryCount + 1);
        }

        this.#error = result.error;
        logger.error('Failed to load workspaces after retries', { error: result.error });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load workspaces';

      if (retryCount < MAX_RETRIES) {
        logger.warn('Exception loading workspaces, retrying...', {
          error: errorMessage,
          retryCount,
          maxRetries: MAX_RETRIES,
        });

        // Wait before retry with exponential backoff (capped at 4 seconds)
        const delay = Math.min(RETRY_DELAY * Math.pow(2, retryCount), 4000);
        await new Promise((resolve) => setTimeout(resolve, delay));

        // Retry
        return this.load(retryCount + 1);
      }

      this.#error = errorMessage;
      logger.error('Failed to load workspaces with exception', { error: errorMessage });
    } finally {
      this.#loading = false;
    }
  }

  async create(data: CreateWorkspaceRequest): Promise<Result<Workspace, string>> {
    logger.info('[WorkspaceStore] create called', {
      title: data.title,
      repositoryPath: data.repositoryPath,
      scope: data.scope,
      hasLinearIssue: !!data.linearIssue,
      hasSentryIssue: !!data.sentryIssue,
    });

    this.#loading = true;
    this.#error = null;
    this.#isCreating = true;

    try {
      const result = await workspaceClient.create(data);
      if (result.ok) {
        // FIX: Add to pending creations to prevent disappearing during list refresh
        // The workspace might not appear in the backend list immediately after creation
        this.#pendingCreations.set(result.data.id, result.data);

        // Use helper to prevent duplicates
        this.addOrUpdateWorkspace(result.data);
        this.#current = result.data;

        // Track workspace creation (privacy-safe: no repo names/paths)
        const workMode = data.initialAgent?.metadata?.workMode;
        track('Created Workspace', {
          workspace_id: result.data.id,
          workspace_title: result.data.title,
          is_remote: data.environmentConfig?.type === 'remote' || false,
          from_template: false, // No template system yet
          work_mode: workMode === 'team' || workMode === 'single' ? workMode : undefined,
        });

        // If a Linear issue was provided, create a third-party source for it
        if (data.linearIssue) {
          try {
            const { thirdPartySourcesClient } =
              await import('$features/third-party-sources/third-party-sources.client');
            const { ThirdPartySourceType } = await import('$shared/types');

            const linearUrl =
              data.linearIssue.url || `https://linear.app/issue/${data.linearIssue.identifier}`;

            await thirdPartySourcesClient.create({
              workspaceId: result.data.id,
              url: linearUrl,
              type: ThirdPartySourceType.LinearIssue,
              title: `${data.linearIssue.identifier}: ${data.linearIssue.title}`,
              description: data.linearIssue.description,
              metadata: {
                sourceSpecific: {
                  linearIssueId: data.linearIssue.id,
                  identifier: data.linearIssue.identifier,
                  teamName: data.linearIssue.teamName,
                  teamKey: data.linearIssue.teamKey,
                  state: data.linearIssue.state,
                  priority: data.linearIssue.priority,
                },
              },
            });

            logger.info('[WorkspaceStore] Created Linear issue third-party source', {
              workspaceId: result.data.id,
              linearIssue: data.linearIssue.identifier,
            });
          } catch (linearErr) {
            // Don't fail workspace creation if Linear source creation fails
            logger.warn('[WorkspaceStore] Failed to create Linear issue source', {
              error: linearErr instanceof Error ? linearErr.message : 'Unknown error',
            });
          }
        }

        // If a Sentry issue was provided, create a third-party source for it
        if (data.sentryIssue) {
          try {
            const { thirdPartySourcesClient } =
              await import('$features/third-party-sources/third-party-sources.client');
            const { ThirdPartySourceType } = await import('$shared/types');

            const sentryUrl =
              data.sentryIssue.permalink || `https://sentry.io/issues/${data.sentryIssue.id}/`;

            await thirdPartySourcesClient.create({
              workspaceId: result.data.id,
              url: sentryUrl,
              type: ThirdPartySourceType.SentryIssue,
              title: `${data.sentryIssue.shortId}: ${data.sentryIssue.title}`,
              description: data.sentryIssue.culprit,
              metadata: {
                sourceSpecific: {
                  sentryIssueId: data.sentryIssue.id,
                  shortId: data.sentryIssue.shortId,
                  projectSlug: data.sentryIssue.projectSlug,
                  projectName: data.sentryIssue.projectName,
                  level: data.sentryIssue.level,
                  status: data.sentryIssue.status,
                  count: data.sentryIssue.count,
                  firstSeen: data.sentryIssue.firstSeen,
                  lastSeen: data.sentryIssue.lastSeen,
                },
              },
            });

            logger.info('[WorkspaceStore] Created Sentry issue third-party source', {
              workspaceId: result.data.id,
              sentryIssue: data.sentryIssue.shortId,
            });
          } catch (sentryErr) {
            // Don't fail workspace creation if Sentry source creation fails
            logger.warn('[WorkspaceStore] Failed to create Sentry issue source', {
              error: sentryErr instanceof Error ? sentryErr.message : 'Unknown error',
            });
          }
        }
      } else {
        this.#error = result.error;
      }
      // PERF: Schedule a follow-up refresh to fetch full workspace data
      // During creation, listWorkspaces uses lite mode (skips heavy computations)
      // This delayed refresh restores full data (taskStats, diffSummary, etc.)
      if (result.ok) {
        setTimeout(() => {
          logger.debug('Refreshing workspace list after creation to fetch full data');
          this.load();
        }, 500);
      }

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to create workspace';
      this.#error = error;
      return { ok: false, error };
    } finally {
      this.#loading = false;
      this.#isCreating = false;
    }
  }

  async open(id: WorkspaceId): Promise<Result<Workspace, string>> {
    this.#loading = true;
    this.#error = null;

    try {
      const result = await workspaceClient.open(id);
      if (result.ok) {
        // Preserve enrichment data from items array if available
        const existing = this.#items.find((w) => w.id === id);
        this.#current = existing
          ? {
              ...result.data,
              taskStats: result.data.taskStats ?? existing.taskStats,
              diffSummary: result.data.diffSummary ?? existing.diffSummary,
              agentSummary: result.data.agentSummary ?? existing.agentSummary,
              gitSummary: result.data.gitSummary ?? existing.gitSummary,
              activePullRequest: result.data.activePullRequest ?? existing.activePullRequest,
            }
          : result.data;
      } else {
        this.#error = result.error;
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to open workspace';
      this.#error = error;
      return { ok: false, error };
    } finally {
      this.#loading = false;
    }
  }

  async update(id: WorkspaceId, updates: Partial<Workspace>): Promise<Result<Workspace, string>> {
    try {
      const result = await workspaceClient.update({ id, ...updates });
      if (result.ok) {
        // Update in items array - create new array for reactivity
        const index = this.#items.findIndex((w) => w.id === id);
        if (index !== -1) {
          const existing = this.#items[index];
          // Preserve enrichment data that the update response doesn't include
          const merged = {
            ...result.data,
            taskStats: result.data.taskStats ?? existing.taskStats,
            diffSummary: result.data.diffSummary ?? existing.diffSummary,
            agentSummary: result.data.agentSummary ?? existing.agentSummary,
            gitSummary: result.data.gitSummary ?? existing.gitSummary,
            activePullRequest: result.data.activePullRequest ?? existing.activePullRequest,
          };
          this.#items = [...this.#items.slice(0, index), merged, ...this.#items.slice(index + 1)];
        }

        // Update current if it's the same workspace — use merged data to
        // keep #current consistent with #items (both have enrichment data)
        if (this.#current?.id === id) {
          if (index !== -1) {
            this.#current = this.#items[index];
          } else {
            // Workspace not in #items but is #current — preserve enrichment from #current
            this.#current = {
              ...result.data,
              taskStats: result.data.taskStats ?? this.#current.taskStats,
              diffSummary: result.data.diffSummary ?? this.#current.diffSummary,
              agentSummary: result.data.agentSummary ?? this.#current.agentSummary,
              gitSummary: result.data.gitSummary ?? this.#current.gitSummary,
            };
          }
        }
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to update workspace';
      return { ok: false, error };
    }
  }

  /**
   * Update workspace in local state only (without API call)
   * Used when receiving real-time updates from events.
   * If the workspace is not found locally, fetches it from the backend.
   */
  updateLocalWorkspace(id: WorkspaceId, updates: Partial<Workspace>): void {
    logger.info('[WorkspaceStore] updateLocalWorkspace called', {
      id,
      updates,
      hasTitle: 'title' in updates,
      hasStatus: 'status' in updates,
      newStatus: updates.status,
    });

    // Find and update in items array
    const index = this.#items.findIndex((w) => w.id === id);
    if (index !== -1) {
      const oldWorkspace = this.#items[index];
      logger.info('[WorkspaceStore] Found workspace to update', {
        index,
        oldStatus: oldWorkspace.status,
        newStatus: updates.status,
      });

      // Preserve archived/deleted status unless explicitly included in updates
      // This prevents stale events from un-archiving a workspace
      const preservedStatus =
        'status' in updates && updates.status !== undefined ? updates.status : oldWorkspace.status;

      // Create a new workspace object with updates, normalizing paths
      // Preserve updatedAt and createdAt to prevent event-driven updates from
      // changing the workspace's sort position in the recently updated list.
      // Only explicit update() calls (which return the full workspace from the
      // backend) should modify these timestamps.
      const updatedWorkspace: Workspace = normalizeWorkspacePaths({
        ...oldWorkspace,
        ...updates,
        status: preservedStatus, // Always use preserved status
        id, // Ensure ID doesn't change
        updatedAt: oldWorkspace.updatedAt, // Preserve sort-order timestamp
        createdAt: oldWorkspace.createdAt, // Preserve creation timestamp
      });
      logger.info('[WorkspaceStore] After merge', {
        finalStatus: updatedWorkspace.status,
      });

      // Create a new array to trigger reactivity
      this.#items = [
        ...this.#items.slice(0, index),
        updatedWorkspace,
        ...this.#items.slice(index + 1),
      ];

      // Update current if it's the same workspace
      if (this.#current?.id === id) {
        logger.info('[WorkspaceStore] Updating current workspace', {
          oldTitle: this.#current.title,
          newTitle: updatedWorkspace.title,
        });
        this.#current = updatedWorkspace;
      }

      // Track workspace rename events (only when title actually changed)
      if (
        'title' in updates &&
        updates.title !== undefined &&
        updates.title !== oldWorkspace.title
      ) {
        track('Renamed Workspace', { workspace_id: id });
      }

      logger.info('[WorkspaceStore] Workspace updated locally', {
        id,
        title: updatedWorkspace.title,
        itemsLength: this.#items.length,
      });

      // Ensure no duplicates after update
      this.deduplicateItems();
    } else {
      // Workspace not found locally - fetch from backend and add to store
      logger.info('[WorkspaceStore] Workspace not found locally, fetching from backend', { id });
      this.fetchAndAddWorkspace(id);
    }
  }

  private applyOptimisticTaskStatusUpdate(payload: {
    workspaceId?: WorkspaceId;
    previousStatus?: TaskStatus;
    newStatus?: TaskStatus;
    data?: {
      previousStatus?: TaskStatus;
      newStatus?: TaskStatus;
    };
  }): void {
    const workspaceId = payload.workspaceId;
    const previousStatus = payload.previousStatus || payload.data?.previousStatus;
    const newStatus = payload.newStatus || payload.data?.newStatus;

    if (!workspaceId || !previousStatus || !newStatus) {
      return;
    }

    const workspace = this.#items.find((item) => item.id === workspaceId);
    const taskStats = workspace?.taskStats;
    if (!workspace || !taskStats) {
      return;
    }

    const wasExcluded = EXCLUDED_STATUSES.has(previousStatus);
    const isExcluded = EXCLUDED_STATUSES.has(newStatus);
    const wasInProgress = IN_PROGRESS_STATUSES.has(previousStatus);
    const isInProgress = IN_PROGRESS_STATUSES.has(newStatus);
    const wasCompleted = previousStatus === 'complete';
    const isCompleted = newStatus === 'complete';

    let total = taskStats.total;
    let completed = taskStats.completed;
    let inProgress = taskStats.inProgress;

    if (!wasExcluded && isExcluded) total = Math.max(0, total - 1);
    if (wasExcluded && !isExcluded) total += 1;
    if (wasCompleted && !isCompleted) completed = Math.max(0, completed - 1);
    if (!wasCompleted && isCompleted) completed += 1;
    if (wasInProgress && !isInProgress) inProgress = Math.max(0, inProgress - 1);
    if (!wasInProgress && isInProgress) inProgress += 1;

    this.updateLocalWorkspace(workspaceId, {
      taskStats: {
        ...taskStats,
        total,
        completed,
        inProgress,
      },
    });
  }

  /**
   * Fetch a workspace from the backend and add it to the store
   * Used when receiving events for workspaces not yet in local state
   */
  private async fetchAndAddWorkspace(id: WorkspaceId): Promise<void> {
    try {
      const result = await workspaceClient.get(id);
      if (result.ok) {
        logger.info('[WorkspaceStore] Fetched workspace from backend', {
          id,
          title: result.data.title,
        });
        // Add the workspace to the store
        this.addOrUpdateWorkspace(result.data);
      } else {
        logger.warn('[WorkspaceStore] Failed to fetch workspace from backend', {
          id,
          error: result.error,
        });
      }
    } catch (error) {
      logger.error('[WorkspaceStore] Error fetching workspace from backend', {
        id,
        error,
      });
    }
  }

  /**
   * Remove workspace from UI only (optimistic deletion)
   * Does not delete from disk. Adds to pending deletions to prevent reload() from restoring it.
   */
  removeFromUI(id: WorkspaceId): void {
    // Add to pending deletions to prevent load() from restoring
    this.#pendingDeletions.add(id);

    // Remove from items array
    this.#items = this.#items.filter((w) => w.id !== id);

    // Clear current if it was deleted
    if (this.#current?.id === id) {
      this.#current = null;
    }

    // Trigger reactivity
    this.deduplicateItems();
  }

  /**
   * Restore workspace to UI (undo deletion)
   * Clears the pending deletion flag and cancels the pending deletion timeout
   */
  restoreToUI(id: WorkspaceId): void {
    this.#pendingDeletions.delete(id);
    const timeout = this.#pendingDeletionTimeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.#pendingDeletionTimeouts.delete(id);
    }
  }

  /**
   * Delete workspace with 15-second undo window.
   * Removes from UI immediately and schedules permanent deletion.
   * The deletion is tracked so it can be flushed on page unload.
   */
  async deleteWithUndo(id: WorkspaceId, title?: string): Promise<void> {
    // Remove from UI immediately for responsive feedback
    this.removeFromUI(id);

    let undoClicked = false;
    const { toast } = await import('svelte-sonner');
    const toastId = toast.warning(title ? `Deleted "${title}"` : 'Workspace deleted', {
      duration: 15000,
      action: {
        label: 'Undo',
        onClick: async () => {
          undoClicked = true;
          this.restoreToUI(id);
          await this.load();
          toast.dismiss(toastId);
        },
      },
    });

    // Schedule permanent deletion after undo window
    const timeoutId = setTimeout(async () => {
      this.#pendingDeletionTimeouts.delete(id);
      if (!undoClicked) {
        const result = await this.delete(id, true);
        if (!result.ok) {
          await this.load();
          toast.error('Failed to delete space');
        }
      }
    }, 15000);

    this.#pendingDeletionTimeouts.set(id, timeoutId);
  }

  /**
   * Flush all pending workspace deletions immediately.
   * Called on page unload to prevent deleted workspaces from reappearing.
   */
  flushPendingDeletions(): void {
    if (this.#pendingDeletionTimeouts.size === 0) return;

    logger.info('Flushing pending workspace deletions', {
      count: this.#pendingDeletionTimeouts.size,
    });

    const entries = [...this.#pendingDeletionTimeouts.entries()];
    this.#pendingDeletionTimeouts.clear();

    for (const [workspaceId, timeoutId] of entries) {
      clearTimeout(timeoutId);
      // Fire and forget - main process will handle the IPC even after renderer reloads
      this.delete(workspaceId, true).catch((err) => {
        logger.warn('Failed to flush pending workspace deletion on page unload', {
          workspaceId,
          error: (err as Error)?.message || err,
        });
      });
    }
  }

  async delete(id: WorkspaceId, skipInitialRemoval = false): Promise<Result<void, string>> {
    // Capture workspace title before removal for analytics
    const workspaceTitle = this.findById(id)?.title;

    try {
      // Optionally skip initial removal (caller already removed for optimistic UI)
      if (!skipInitialRemoval) {
        this.removeFromUI(id);
      }

      const result = await workspaceClient.delete(id);

      if (result.ok) {
        // Always ensure removed from UI on success (in case something reloaded in the meantime)
        this.removeFromUI(id);
        // Clear pending deletion since it's now actually deleted
        this.#pendingDeletions.delete(id);
        this.#pendingDeletionTimeouts.delete(id);
        // Also clear from pending creations if it was just created
        this.#pendingCreations.delete(id);

        // Clean up workspace-scoped caches to prevent memory leaks
        clearDeferredResults(id);
        cleanupPRStatusForWorkspace(id);

        // Clean up agent-related in-memory state to prevent stale agents
        // from appearing in other workspaces
        invalidateAgentCache(id);
        unifiedStateStore.removeWorkspace(id);

        // Dynamic import to avoid circular dependency:
        // workspace-unified-state.svelte.ts already imports workspace.store.svelte.ts
        import('./workspace-unified-state.svelte').then(({ disposeWorkspaceState }) => {
          disposeWorkspaceState(id);
        });

        // Clean up remaining workspace-scoped renderer state
        try {
          clearTransientUIStore(id);
          lineChangesStore.clearWorkspaceStats(id);
          workspaceStorageManager.clearState(id);
        } catch (cleanupErr) {
          logger.warn('Non-critical cleanup error during workspace deletion', {
            workspaceId: id,
            error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          });
        }

        // Track workspace deletion
        track('Deleted Workspace', {
          workspace_id: id,
          workspace_title: workspaceTitle,
        });
      }
      // Don't reload on failure - let the caller handle restoration if needed
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to delete workspace';
      return { ok: false, error };
    }
  }

  async duplicate(id: WorkspaceId, newTitle?: string): Promise<Result<Workspace, string>> {
    this.#isCreating = true;

    try {
      const result = await workspaceClient.duplicate(id, newTitle);
      if (result.ok) {
        // FIX: Add to pending creations to prevent disappearing during list refresh
        this.#pendingCreations.set(result.data.id, result.data);

        // Use helper to prevent duplicates
        this.addOrUpdateWorkspace(result.data);

        // PERF: Schedule a follow-up refresh to fetch full workspace data
        // During duplication, listWorkspaces uses lite mode (skips heavy computations)
        // This delayed refresh restores full data (taskStats, diffSummary, etc.)
        setTimeout(() => {
          logger.debug('Refreshing workspace list after duplication to fetch full data');
          this.load();
        }, 500);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to duplicate workspace';
      return { ok: false, error };
    } finally {
      this.#isCreating = false;
    }
  }

  async close(): Promise<void> {
    this.#current = null;
  }

  async setCurrentWorkspace(idOrWorkspace: WorkspaceId | Workspace): Promise<void> {
    let workspaceId: WorkspaceId;

    if (typeof idOrWorkspace === 'string') {
      // Handle ID case
      workspaceId = idOrWorkspace;
      const workspace = this.#items.find((w) => w.id === idOrWorkspace);
      if (workspace) {
        this.#current = workspace;
      }
    } else {
      // Handle workspace object case (used for preloaded data)
      workspaceId = idOrWorkspace.id;
      // Also update in items array if present, or add it if not
      const index = this.#items.findIndex((w) => w.id === idOrWorkspace.id);
      if (index !== -1) {
        // FIX: Merge incoming workspace data with existing item to preserve
        // enrichment fields (taskStats, agentSummary, gitSummary, diffSummary)
        // that are only computed during listWorkspaces (buildListWorkspace).
        // The open/get endpoints don't compute these fields, so a naive
        // replacement would wipe them, causing the homepage to show stale data
        // (e.g., "planning" phase instead of correct progress) after navigating
        // to a workspace and back.
        const existing = this.#items[index];
        const merged = {
          ...existing,
          ...idOrWorkspace,
          // Preserve enrichment fields if the incoming workspace doesn't have them
          taskStats: idOrWorkspace.taskStats ?? existing.taskStats,
          agentSummary: idOrWorkspace.agentSummary ?? existing.agentSummary,
          gitSummary: idOrWorkspace.gitSummary ?? existing.gitSummary,
          diffSummary: idOrWorkspace.diffSummary ?? existing.diffSummary,
          activePullRequest: idOrWorkspace.activePullRequest ?? existing.activePullRequest,
        };
        this.#items[index] = merged;
        this.#current = merged;
      } else {
        // Add to items array if not present
        this.#items = [...this.#items, idOrWorkspace];
        this.#current = idOrWorkspace;
      }
    }

    // Record this workspace view for recency tracking (used by workspace switcher)
    workspaceRecencyStore.recordView(workspaceId);
  }

  // Utility methods
  findById(id: WorkspaceId): Workspace | undefined {
    return this.#items.find((w) => w.id === id);
  }

  findByPath(path: string): Workspace | undefined {
    return this.#items.find((w) => w.repositoryPath === path.replaceAll('\\', '/'));
  }

  // Set items directly (used for removing optimistic workspaces)
  setItems(items: Workspace[]): void {
    this.#items = items;
  }

  reset(): void {
    this.#items = [];
    this.#current = null;
    this.#loading = false;
    this.#error = null;
    this.#hasLoaded = false;
  }

  /**
   * Helper method to safely add or update a workspace in the items array
   * Prevents duplicate workspace IDs
   */
  private addOrUpdateWorkspace(workspace: Workspace): void {
    const existingIndex = this.#items.findIndex((w) => w.id === workspace.id);
    if (existingIndex >= 0) {
      // Preserve enrichment data if the incoming workspace doesn't have it
      const existing = this.#items[existingIndex];
      const merged = {
        ...workspace,
        taskStats: workspace.taskStats ?? existing.taskStats,
        diffSummary: workspace.diffSummary ?? existing.diffSummary,
        agentSummary: workspace.agentSummary ?? existing.agentSummary,
        gitSummary: workspace.gitSummary ?? existing.gitSummary,
        activePullRequest: workspace.activePullRequest ?? existing.activePullRequest,
      };
      this.#items = [
        ...this.#items.slice(0, existingIndex),
        merged,
        ...this.#items.slice(existingIndex + 1),
      ];
    } else {
      // Add new workspace
      this.#items = [...this.#items, workspace];
    }

    // Double-check for duplicates and deduplicate if necessary
    this.deduplicateItems();
  }

  /**
   * Ensure no duplicate workspace IDs exist in the items array
   */
  private deduplicateItems(): void {
    const seen = new Map<string, number>(); // id → index in deduplicated
    const deduplicated: Workspace[] = [];

    for (const workspace of this.#items) {
      const existingIndex = seen.get(workspace.id);
      if (existingIndex === undefined) {
        seen.set(workspace.id, deduplicated.length);
        deduplicated.push(workspace);
      } else {
        // Merge enrichment data from the duplicate into the kept entry
        const kept = deduplicated[existingIndex];
        deduplicated[existingIndex] = {
          ...kept,
          taskStats: kept.taskStats ?? workspace.taskStats,
          diffSummary: kept.diffSummary ?? workspace.diffSummary,
          agentSummary: kept.agentSummary ?? workspace.agentSummary,
          gitSummary: kept.gitSummary ?? workspace.gitSummary,
        };
        logger.warn('[WorkspaceStore] Duplicate workspace ID detected and merged:', workspace.id);
      }
    }

    if (deduplicated.length !== this.#items.length) {
      this.#items = deduplicated;
    }
  }

  // Backward compatibility methods
  async archive(workspaceId: WorkspaceId): Promise<Result<void, string>> {
    // Track pending archive to prevent load() from restoring non-archived status
    this.#pendingArchives.add(workspaceId);

    // Safety timeout: remove from #pendingArchives after 30s to prevent memory leaks
    // if _doLoad() never runs or never returns.
    const existingTimeout = this.#pendingArchiveTimeouts.get(workspaceId);
    if (existingTimeout) clearTimeout(existingTimeout);
    this.#pendingArchiveTimeouts.set(
      workspaceId,
      setTimeout(() => {
        this.#pendingArchives.delete(workspaceId);
        this.#pendingArchiveTimeouts.delete(workspaceId);
      }, 30_000),
    );

    // Optimistically update local state immediately for better UX
    const workspaceIndex = this.#items.findIndex((w) => w.id === workspaceId);
    logger.info('[WorkspaceStore] archive called', {
      workspaceId,
      workspaceIndex,
      itemsLength: this.#items.length,
    });
    if (workspaceIndex !== -1) {
      const workspace = this.#items[workspaceIndex];
      const originalStatus = workspace.status;

      // Create a new workspace object to trigger Svelte reactivity
      // Set both status AND archived boolean for UI consistency
      const updatedWorkspace = {
        ...workspace,
        status: WorkspaceStatusEnum.Archived,
        archived: true,
        archivedAt: new Date().toISOString(),
      };
      this.#items = [
        ...this.#items.slice(0, workspaceIndex),
        updatedWorkspace,
        ...this.#items.slice(workspaceIndex + 1),
      ];
      logger.info('[WorkspaceStore] archive - updated items array', {
        workspaceId,
        newStatus: updatedWorkspace.status,
        itemsLength: this.#items.length,
        archivedWorkspaceInItems: this.#items.find((w) => w.id === workspaceId)?.status,
      });
      this.deduplicateItems();

      try {
        // Use the proper archive method which triggers events and cleanup
        const result = await workspaceClient.archive(workspaceId);

        if (!result.ok) {
          // Rollback on failure - restore original workspace
          this.#pendingArchives.delete(workspaceId);
          const rollbackTimeout = this.#pendingArchiveTimeouts.get(workspaceId);
          if (rollbackTimeout) { clearTimeout(rollbackTimeout); this.#pendingArchiveTimeouts.delete(workspaceId); }
          const rollbackWorkspace = { ...updatedWorkspace, status: originalStatus };
          this.#items = [
            ...this.#items.slice(0, workspaceIndex),
            rollbackWorkspace,
            ...this.#items.slice(workspaceIndex + 1),
          ];
          this.deduplicateItems();
          return result;
        }

        // Do NOT clear #pendingArchives here — an in-flight load() may still
        // return stale Active data. _doLoad() will clear it once the backend
        // confirms Archived status.

        // Clean up workspace-scoped caches to prevent memory leaks
        clearDeferredResults(workspaceId);
        cleanupPRStatusForWorkspace(workspaceId);

        return { ok: true, data: undefined };
      } catch (err) {
        // Rollback on error - restore original workspace
        this.#pendingArchives.delete(workspaceId);
        const catchTimeout = this.#pendingArchiveTimeouts.get(workspaceId);
        if (catchTimeout) { clearTimeout(catchTimeout); this.#pendingArchiveTimeouts.delete(workspaceId); }
        const rollbackWorkspace = { ...updatedWorkspace, status: originalStatus };
        const currentIndex = this.#items.findIndex((w) => w.id === workspaceId);
        if (currentIndex !== -1) {
          this.#items = [
            ...this.#items.slice(0, currentIndex),
            rollbackWorkspace,
            ...this.#items.slice(currentIndex + 1),
          ];
          this.deduplicateItems();
        }

        const error = err instanceof Error ? err.message : 'Failed to archive workspace';
        return { ok: false, error };
      }
    }

    // If workspace not found locally, still try to archive via backend
    try {
      const result = await workspaceClient.archive(workspaceId);
      // Do NOT clear #pendingArchives here — _doLoad() will confirm.
      return result;
    } catch (err) {
      this.#pendingArchives.delete(workspaceId);
      const fallbackTimeout = this.#pendingArchiveTimeouts.get(workspaceId);
      if (fallbackTimeout) { clearTimeout(fallbackTimeout); this.#pendingArchiveTimeouts.delete(workspaceId); }
      const error = err instanceof Error ? err.message : 'Failed to archive workspace';
      return { ok: false, error };
    }
  }

  async unarchive(workspaceId: WorkspaceId): Promise<Result<void, string>> {
    // Clear pending archive so a quick archive→unarchive sequence works correctly
    this.#pendingArchives.delete(workspaceId);
    const unarchiveTimeout = this.#pendingArchiveTimeouts.get(workspaceId);
    if (unarchiveTimeout) { clearTimeout(unarchiveTimeout); this.#pendingArchiveTimeouts.delete(workspaceId); }

    // Optimistically update local state immediately for better UX
    const workspaceIndex = this.#items.findIndex((w) => w.id === workspaceId);
    if (workspaceIndex !== -1) {
      const workspace = this.#items[workspaceIndex];
      const originalStatus = workspace.status;

      // Create a new workspace object to trigger Svelte reactivity
      // Set both status AND archived boolean for UI consistency
      const updatedWorkspace = {
        ...workspace,
        status: WorkspaceStatusEnum.Active,
        archived: false,
        archivedAt: undefined,
      };
      this.#items = [
        ...this.#items.slice(0, workspaceIndex),
        updatedWorkspace,
        ...this.#items.slice(workspaceIndex + 1),
      ];
      this.deduplicateItems();

      try {
        // Use the proper unarchive method
        const result = await workspaceClient.unarchive(workspaceId);

        if (!result.ok) {
          // Rollback on failure - restore original workspace
          const rollbackWorkspace = { ...updatedWorkspace, status: originalStatus };
          this.#items = [
            ...this.#items.slice(0, workspaceIndex),
            rollbackWorkspace,
            ...this.#items.slice(workspaceIndex + 1),
          ];
          this.deduplicateItems();
          return result;
        }

        return { ok: true, data: undefined };
      } catch (err) {
        // Rollback on error - restore original workspace
        const rollbackWorkspace = { ...updatedWorkspace, status: originalStatus };
        const currentIndex = this.#items.findIndex((w) => w.id === workspaceId);
        if (currentIndex !== -1) {
          this.#items = [
            ...this.#items.slice(0, currentIndex),
            rollbackWorkspace,
            ...this.#items.slice(currentIndex + 1),
          ];
          this.deduplicateItems();
        }

        const error = err instanceof Error ? err.message : 'Failed to unarchive workspace';
        return { ok: false, error };
      }
    }

    // If workspace not found locally, still try to unarchive via backend
    try {
      const result = await workspaceClient.unarchive(workspaceId);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to unarchive workspace';
      return { ok: false, error };
    }
  }

  /**
   * Update the current UI context for a workspace
   */
  async updateCurrentContext(
    workspaceId: WorkspaceId,
    context: WorkspaceUIContext,
  ): Promise<Result<void, string>> {
    if (process.env.DEBUG_WORKSPACE) {
      logger.info('[WorkspaceStore] updateCurrentContext called:', { workspaceId, context });
    }
    try {
      const result = await workspaceClient.updateCurrentContext(workspaceId, context);
      if (process.env.DEBUG_WORKSPACE) {
        logger.info('[WorkspaceStore] updateCurrentContext result:', result);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to update current context';
      logger.error('[WorkspaceStore] updateCurrentContext error:', error);
      return { ok: false, error };
    }
  }
}

// Export singleton instance
export const workspaceStore = new WorkspaceStore();

// Flush pending workspace deletions on page unload to prevent deleted workspaces
// from reappearing after refresh. Fire-and-forget: the main process stays alive
// during renderer refresh and will process the IPC calls.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    workspaceStore.flushPendingDeletions();
  });

  // Listen for background enrichment updates from the main process.
  // This keeps the bulk list cheap while letting PR and summary updates stream in incrementally.
  if (window.electronAPI?.on) {
    window.electronAPI.on(
      'workspace:background-enrichment-complete',
      (data: {
        workspaceId: string;
        updates?: Partial<
          Pick<
            Workspace,
            | 'repositoryOwner'
            | 'repositoryName'
            | 'activePullRequest'
            | 'diffSummary'
            | 'agentSummary'
            | 'taskStats'
            | 'gitSummary'
          >
        >;
      }) => {
        if (!data.workspaceId || !data.updates) return;

        logger.debug('Received background enrichment update', {
          workspaceId: data.workspaceId,
          updatedKeys: Object.keys(data.updates),
          prNumber: data.updates.activePullRequest?.number,
        });

        workspaceStore.updateLocalWorkspace(data.workspaceId as WorkspaceId, data.updates);
      },
    );

    listenSync(
      'task:status-changed',
      (data: {
        workspaceId?: WorkspaceId;
        previousStatus?: TaskStatus;
        newStatus?: TaskStatus;
        payload?: {
          workspaceId?: WorkspaceId;
          previousStatus?: TaskStatus;
          newStatus?: TaskStatus;
        };
      }) => {
        (workspaceStore as any).applyOptimisticTaskStatusUpdate(data.payload ?? data);
      },
    );
  }
}
