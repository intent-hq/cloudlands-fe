/**
 * useWorkspaceLoader Composable
 *
 * Manages workspace loading logic including optimistic workspace handling.
 * Extracted from +page.svelte to reduce file size and improve maintainability.
 */

import { untrack } from 'svelte';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';

import { createLogger } from '$lib/utils/client-logger';
import { WorkspaceId } from '$shared/types/branded-ids';
import { track } from '$lib/services/analytics';

import { workspaceMounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectWorkspaceById,
} from '$store/renderer/slices/workspace/workspace-selectors';
import {
  setActiveWorkspaceId,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';

import type { WorkspacePageState, WorkspacePageStateManager } from './workspace-page-state.svelte';
  import { store as appStore } from '$store/renderer/store';

const logger = createLogger('workspace-loader');

export interface UseWorkspaceLoaderOptions {
  workspaceId: string;
  workspaceState: WorkspacePageStateManager | null;
  state: WorkspacePageState | null;
  previousWorkspaceId: string | null;
}

export function useWorkspaceLoader(options: UseWorkspaceLoaderOptions) {

  // Track loading state more robustly
  let loadingWorkspaceId: string | null = $state(null);
  let loadingPromise: Promise<void> | null = $state(null);

  // Track the last workspace ID for which workspaceMounted was dispatched.
  // This prevents the isAlreadyActive guard from short-circuiting during
  // workspace-to-workspace navigation: pre-population by initializeWorkspaceState
  // makes workspaceData.id match the new workspace before the loader runs,
  // but workspaceMounted hasn't been dispatched yet for the new workspace.
  let lastMountedWorkspaceId: string | null = null;

  async function loadWorkspace() {
    const { workspaceId, workspaceState, state } = options;

    if (!workspaceId || !workspaceState) {
      return;
    }

    // Prevent duplicate loads by checking if we're already loading this workspace
    if (loadingPromise) {
      logger.debug('Load already in progress, skipping duplicate call');
      return loadingPromise;
    }

    // Capture the value outside of reactive context to avoid creating dependencies
    const isOptimisticValue = workspaceState.isOptimistic;

    logger.debug('Loading workspace', { workspaceId, isOptimistic: isOptimisticValue });

    try {
      // Check if optimistic
      if (isOptimisticValue) {
        await handleOptimisticLoad(workspaceId, workspaceState);
      } else {
        await handleRealWorkspaceLoad(workspaceId, workspaceState, state);
      }
    } catch (error) {
      logger.error('Failed to load workspace', { workspaceId, error });
      // Check if workspaceState exists before using it
      if (workspaceState) {
        // Set workspaceData to a minimal error object to prevent infinite retry loops
        // The key is that workspaceData must be truthy to break the loop
        workspaceState.updateState({
          workspace: { id: workspaceId, status: 'error' },
          workspaceData: {
            id: workspaceId,
            title: 'Error loading space',
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          } as any,
        });
      } else {
        logger.warn('Workspace state not available, cannot set error status in catch block', {
          workspaceId,
        });
      }
    } finally {
      // NOTE: Do NOT clear loadingWorkspaceId here!
      // The loadingWorkspaceId serves two purposes:
      // 1. During loading: indicates which workspace is being loaded
      // 2. After loading: indicates which workspace has already been loaded
      // Clearing it would cause the $effect to re-run and trigger an infinite loop.
      // The cleanup function in the $effect handles resetting when workspace changes.
    }
  }

  async function handleOptimisticLoad(
    workspaceId: string,
    workspaceState: WorkspacePageStateManager,
  ) {
    // For optimistic workspaces, `transition` is display config only.
    const transition = workspaceState.transition;
    const config = transition?.config;

    // Still waiting for real workspace creation.
    // The optimistic workspace listener will navigate to the real workspace once it resolves.
    // Set a placeholder workspace data to prevent infinite loading loops.
    workspaceState.updateState({
      workspace: { id: workspaceId, status: 'ready' }, // Don't show loading state
      workspaceData: {
        id: workspaceId,
        title: config?.title ?? 'New Workspace',
        repositoryPath: config?.repositoryPath ?? '',
        branch: config?.branch ?? '',
        status: 'creating',
        isOptimistic: true,
      } as any,
    });
    logger.debug('Optimistic workspace - waiting for real workspace creation');
  }

  async function handleRealWorkspaceLoad(
    workspaceId: string,
    workspaceState: WorkspacePageStateManager,
    _state: WorkspacePageState | null,
  ) {
    // Don't try to load the 'new' placeholder — it's the onboarding flow
    if (workspaceId === 'new') {
      logger.debug('Skipping load for onboarding placeholder workspace', { workspaceId });
      return;
    }

    // Check if this is an optimistic ID that's no longer in the manager
    if (workspaceId.startsWith('optimistic-')) {
      logger.warn(
        'Attempting to load optimistic workspace as real workspace - waiting for navigation',
        { workspaceId },
      );
      return;
    }

    // Load real workspace - prefer already-initialized workspace from the store
    let ws = selectWorkspaceById.select(appStore.state, workspaceId);

    // NOTE: We previously skipped workspaceClient.open() when the workspace already had a worktreePath.
    // However, this caused a bug where change detection monitoring wouldn't start on revisits.
    // The backend open() call is idempotent and fast if monitoring is already running, so we always call it
    // to ensure the change detector is properly initialized.
    // See: https://github.com/augmentcode/augment/issues/XXXX

    logger.info('Opening workspace to ensure backend initialization', {
      workspaceId,
      existsInStore: !!ws,
      hasWorktreePath: !!ws?.worktreePath,
    });

    // FIX: When the workspace is already cached in the store (e.g. after
    // workspace creation via Redux), populate Redux and Svelte state immediately
    // BEFORE the async open() call. This eliminates the blank-page flash
    // that occurs when safeWorkspace is null during the open() round-trip,
    // and lets workspaceMounted sagas (agent loading, terminal init, etc.)
    // start without waiting for backend confirmation.
    //
    // STAB-24 fix: Always dispatch workspaceMounted when switching back to a
    // workspace, even if it was already mounted before. This ensures terminal
    // tabs and other workspace-scoped state are re-hydrated from the daemon.
    // The fan-out handlers are idempotent and coalesced, so redundant fetches
    // are cheap.
    let alreadyMounted = false;
    const isReturnVisit = lastMountedWorkspaceId === workspaceId;
    if (ws && !isReturnVisit) {
      logger.info('Pre-populating workspace state from cache before open()', { workspaceId });
      workspaceState.updateState({
        workspaceData: ws,
        workspace: { id: ws.id, status: 'ready' },
      });
      workspaceState.markInitialized();
      appStore.dispatch(setWorkspaceEntity(ws));
      appStore.dispatch(workspaceMounted(ws.id));
      lastMountedWorkspaceId = ws.id;
      alreadyMounted = true;

      appStore.dispatch(setActiveWorkspaceId(ws.id));
    }

    let openResult = await workspaceClient.open(WorkspaceId(workspaceId));

    // FIX: Retry once if workspace not found - this handles a race condition on page reload
    // where workspace:open is called before the backend has fully initialized.
    // The retry gives the backend time to scan workspace directories.
    if (!openResult.ok && openResult.error === 'Workspace not found') {
      logger.warn('Workspace not found on first attempt, retrying after delay', { workspaceId });
      await new Promise((resolve) => setTimeout(resolve, 500));
      openResult = await workspaceClient.open(WorkspaceId(workspaceId));
    }

    if (openResult.ok && openResult.data) {
      ws = openResult.data;
      appStore.dispatch(setActiveWorkspaceId(ws.id));
      logger.info('Workspace opened successfully, monitoring started', {
        workspaceId,
        worktreePath: ws.worktreePath,
      });

      // Track workspace opened event
      track('Opened Workspace', {
        workspace_id: workspaceId,
        workspace_title: ws.title,
      });
    } else {
      const errorMsg = !openResult.ok && 'error' in openResult ? openResult.error : 'Unknown error';
      logger.error('Failed to open workspace', { workspaceId, error: errorMsg });
      if (!ws) {
        throw new Error(`Failed to open space: ${errorMsg}`);
      }
    }

    if (ws) {
      // Update workspace state with potentially fresher data from the backend.
      workspaceState.updateState({
        workspaceData: ws,
        workspace: { id: ws.id, status: 'ready' },
      });
      workspaceState.markInitialized();

      // Hydrate Redux with the (potentially fresher) workspace entity.
      appStore.dispatch(setWorkspaceEntity(ws));

      // STAB-24 fix: Always dispatch workspaceMounted, even on return visits.
      // For first visits when !alreadyMounted, this ensures the fan-out runs.
      // For return visits (alreadyMounted true), we still dispatch to re-hydrate
      // terminal tabs and other workspace state that may have been cleared or
      // stale. The middleware coalesces concurrent fetches, so this is safe.
      if (!alreadyMounted || isReturnVisit) {
        appStore.dispatch(workspaceMounted(ws.id));
        lastMountedWorkspaceId = ws.id;
      }

      // Ensure it's set as current in store
      appStore.dispatch(setActiveWorkspaceId(ws.id));
    } else {
      // This case shouldn't be reached since we throw if ws is null after failed open
      // but keep it as a safety net
      workspaceState.updateState({
        workspace: { id: workspaceId, status: 'error' },
        workspaceData: {
          id: workspaceId,
          title: 'Space not found',
          status: 'error',
        } as any,
      });
    }
  }

  // Load workspace on mount or ID change with deduplication
  $effect(() => {
    // Track only navigation-related values as dependencies.
    // These are the ONLY reactive reads that should trigger this effect.
    const workspaceId = options.workspaceId;
    const hasWorkspaceState = !!options.workspaceState;
    const previousWorkspaceId = options.previousWorkspaceId;

    if (workspaceId && hasWorkspaceState) {
      // Use untrack for the entire loading block to prevent feedback loops.
      // Without untrack, reads of $state guard variables (loadingWorkspaceId,
      // loadingPromise) and synchronous reads inside loadWorkspace() (including
      // options.state which is $derived from workspaceState.state) create reactive
      // dependencies that re-trigger this effect when the load completes, causing
      // the workspace to be opened thousands of times in a tight loop.
      //
      // Note: We intentionally do NOT check for existing workspaceData here.
      // The backend workspace:open call is idempotent and must run on every visit
      // to ensure SSH, RPC, change detection, and git monitoring are initialized.
      untrack(() => {
        // Only load if:
        // 1. We haven't already started loading this workspace
        // 2. We're not currently loading
        if (loadingWorkspaceId !== workspaceId && !loadingPromise) {
          loadingWorkspaceId = workspaceId;

          // Store the promise to prevent duplicate loads
          const promise = loadWorkspace();
          loadingPromise = promise;

          // Clear loading promise when done
          promise.finally(() => {
            if (loadingPromise === promise) {
              loadingPromise = null;
            }
          });
        }
      });
    }

    // Reset loading state when workspace changes
    return () => {
      if (workspaceId !== previousWorkspaceId) {
        loadingWorkspaceId = null;
        loadingPromise = null;
      }
    };
  });

  return {
    // State
    get loadingWorkspaceId() {
      return loadingWorkspaceId;
    },
    get loadingPromise() {
      return loadingPromise;
    },
    get isLoading() {
      return loadingPromise !== null;
    },

    // Methods
    loadWorkspace,
    clearLoadingState() {
      loadingWorkspaceId = null;
      loadingPromise = null;
    },
  };
}
