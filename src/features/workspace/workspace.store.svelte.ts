/**
 * Workspace Store
 *
 * Simple, reactive state management for workspaces using Svelte 5 runes.
 * No complex abstractions, just straightforward state.
 */

import type {
  CreateWorkspaceRequest,
  Result,
  Workspace,
  WorkspaceId,
  WorkspaceUIContext,
} from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
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
import { firstVisitManager } from './first-visit-manager.svelte';

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
      // PERF: Use lite mode on initial load and when another operation is pending.
      // Full mode runs 4 git subprocesses per workspace (diffSummary, agentSummary,
      // taskStats, gitSummary) — with 30+ workspaces that's 120+ concurrent git
      // processes which spikes memory to 1GB+ and can cause native addon crashes.
      // The first load shows workspace cards quickly; enrichment happens on demand.
      const useLiteMode = !this.#hasLoaded || this.#isCreating;
      const result = await workspaceClient.list({ lite: useLiteMode });
      if (result.ok) {
        // Deduplicate workspaces by ID to prevent duplicate key errors
        const uniqueWorkspaces = new Map<string, Workspace>();
        for (const workspace of result.data) {
          // Validate workspace before adding
          if (workspace && workspace.id && workspace.id !== 'undefined') {
            // Skip workspaces that are pending deletion (optimistically removed)
            if (!this.#pendingDeletions.has(workspace.id)) {
              uniqueWorkspaces.set(workspace.id, workspace);
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
            if (hasStats && hadStats && (
              w.taskStats!.total !== existing.taskStats!.total ||
              w.taskStats!.completed !== existing.taskStats!.completed ||
              w.taskStats!.inProgress !== existing.taskStats!.inProgress
            )) return true;
            const hadDiff = existing.diffSummary !== undefined;
            const hasDiff = w.diffSummary !== undefined;
            if (hadDiff !== hasDiff) return true;
            const hadAgent = existing.agentSummary !== undefined;
            const hasAgent = w.agentSummary !== undefined;
            if (hadAgent !== hasAgent) return true;
            return false;
          });
        if (itemsChanged) {
          this.#items = newItems;
        }
        this.#error = null; // Clear any previous errors on success
        const wasFirstLoad = !this.#hasLoaded;
        this.#hasLoaded = true; // Mark that initial load has completed
        logger.info('Workspaces loaded successfully', { count: this.#items.length });

        // PERF: After the initial lite-mode load, schedule a follow-up full load
        // to populate taskStats, diffSummary, agentSummary, and gitSummary.
        // This ensures progress indicators show correctly without blocking the initial render.
        if (wasFirstLoad && useLiteMode) {
          setTimeout(() => this.load(), 500);
        }
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
        track('Created Workspace', {
          workspace_id: result.data.id,
          workspace_title: result.data.title,
          is_remote: data.environmentConfig?.type === 'remote' || false,
          from_template: false, // No template system yet
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
        this.#current = result.data;
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
          this.#items = [
            ...this.#items.slice(0, index),
            result.data,
            ...this.#items.slice(index + 1),
          ];
        }

        // Update current if it's the same workspace
        if (this.#current?.id === id) {
          this.#current = result.data;
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
        'status' in updates && updates.status !== undefined
          ? updates.status
          : oldWorkspace.status;

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
      if ('title' in updates && updates.title !== undefined && updates.title !== oldWorkspace.title) {
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
          firstVisitManager.cleanupWorkspace(id);
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
      this.#current = idOrWorkspace;
      // Also update in items array if present, or add it if not
      const index = this.#items.findIndex((w) => w.id === idOrWorkspace.id);
      if (index !== -1) {
        this.#items[index] = idOrWorkspace;
      } else {
        // Add to items array if not present
        this.#items = [...this.#items, idOrWorkspace];
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
      // Replace existing workspace
      this.#items = [
        ...this.#items.slice(0, existingIndex),
        workspace,
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
    const seen = new Set<string>();
    const deduplicated: Workspace[] = [];

    for (const workspace of this.#items) {
      if (!seen.has(workspace.id)) {
        seen.add(workspace.id);
        deduplicated.push(workspace);
      } else {
        logger.warn('[WorkspaceStore] Duplicate workspace ID detected and removed:', workspace.id);
      }
    }

    if (deduplicated.length !== this.#items.length) {
      this.#items = deduplicated;
    }
  }

  // Backward compatibility methods
  async archive(workspaceId: WorkspaceId): Promise<Result<void, string>> {
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
          const rollbackWorkspace = { ...updatedWorkspace, status: originalStatus };
          this.#items = [
            ...this.#items.slice(0, workspaceIndex),
            rollbackWorkspace,
            ...this.#items.slice(workspaceIndex + 1),
          ];
          this.deduplicateItems();
          return result;
        }

        // Clean up workspace-scoped caches to prevent memory leaks
        clearDeferredResults(workspaceId);
        cleanupPRStatusForWorkspace(workspaceId);

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

        const error = err instanceof Error ? err.message : 'Failed to archive workspace';
        return { ok: false, error };
      }
    }

    // If workspace not found locally, still try to archive via backend
    try {
      const result = await workspaceClient.archive(workspaceId);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to archive workspace';
      return { ok: false, error };
    }
  }

  async unarchive(workspaceId: WorkspaceId): Promise<Result<void, string>> {
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
}
