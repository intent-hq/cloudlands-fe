/**
 * useTabManagement Composable
 *
 * Manages workspace tab opening and optimistic transitions.
 * Extracted from +page.svelte to reduce file size and improve maintainability.
 */

import { workspaceTabManager } from '$features/workspace/workspace-tab-manager.svelte';
import { optimisticWorkspaceManager } from '$features/workspace/optimistic-workspace-manager';
import { createLogger } from '$lib/utils/client-logger';
import type { UnifiedWorkspaceStateManager } from '$features/workspace/workspace-unified-state.svelte';

const logger = createLogger('tab-management');

export interface UseTabManagementOptions {
  workspaceId: string;
  workspaceState: UnifiedWorkspaceStateManager | null;
  previousWorkspaceId: string | null;
  /** Called when an optimistic workspace ID resolves to a real workspace ID. */
  onResolved?: (optimisticId: string, realId: string) => void | Promise<void>;
  /** Called when optimistic workspace creation fails. */
  onFailed?: (optimisticId: string, error: Error) => void | Promise<void>;
  /** Called when an optimistic workspace is removed. */
  onRemoved?: (optimisticId: string) => void | Promise<void>;
  onTransitionDetected?: () => void;
}

export function useTabManagement(options: UseTabManagementOptions) {
  // Track if tab is open to avoid duplicate operations
  let tabOpened = $state(false);

  // Track handled transitions to prevent loops
  const handledTransitions = $state(new Set<string>());

  // Track if we're in a transition to prevent skeleton loaders
  let isInTransition = $state(false);

  // Keep track of the transition timeout so we can clear it on cleanup.
  let transitionTimeout: ReturnType<typeof setTimeout> | null = null;

  // Open tab when workspace loads with proper cleanup
  $effect(() => {
    const { workspaceId, previousWorkspaceId } = options;

    if (workspaceId && !tabOpened) {
      try {
        workspaceTabManager.openTab(workspaceId);
        tabOpened = true;
      } catch (error) {
        logger.error('Failed to open workspace tab', { workspaceId, error });
      }
    }

    // Cleanup: Reset flag when workspace changes
    return () => {
      if (tabOpened && workspaceId !== previousWorkspaceId) {
        tabOpened = false;
      }
    };
  });

  // Handle optimistic transitions (optimistic workspace ID -> real workspace ID)
  // (We rely on optimisticWorkspaceManager events to learn the resolved real ID.)
  // NOTE: `workspaceState.transition` is display config only, not an ID mapping.
  $effect(() => {
    const {
      workspaceId,
      previousWorkspaceId,
      onTransitionDetected,
      onResolved,
      onFailed,
      onRemoved,
    } = options;

    if (!workspaceId || !workspaceId.startsWith('optimistic-')) {
      return;
    }

    const unsubscribe = optimisticWorkspaceManager.addListener(
      (tempId, event, workspace, error) => {
        if (tempId !== workspaceId) return;

        if (event === 'resolved' && workspace) {
          const transitionKey = `${tempId}-${workspace.id}`;

          // Only handle each transition once
          if (handledTransitions.has(transitionKey)) return;
          handledTransitions.add(transitionKey);

          try {
            // Mark that we're in a transition to prevent skeleton loaders
            isInTransition = true;
            workspaceTabManager.handleOptimisticTransition(tempId, workspace.id);

            logger.info('Optimistic workspace resolved (tab transition applied)', {
              optimisticId: tempId,
              realId: workspace.id,
            });

            onTransitionDetected?.();
          } catch (err) {
            logger.error('Failed to handle optimistic transition', {
              optimisticId: tempId,
              realId: workspace.id,
              error: err,
            });
          } finally {
            // Clear transition flag after a short delay to ensure UI has updated
            if (transitionTimeout) clearTimeout(transitionTimeout);
            transitionTimeout = setTimeout(() => {
              isInTransition = false;
            }, 100);

            // Delegate navigation/side-effects to caller (even if tab transition failed).
            Promise.resolve(onResolved?.(tempId, workspace.id)).catch((err) => {
              logger.error('useTabManagement onResolved callback failed', { err });
            });
          }
        } else if (event === 'failed' && error) {
          logger.error('Optimistic workspace creation failed (tab transition skipped)', {
            optimisticId: tempId,
            error: error.message,
          });

          const failureKey = `${tempId}-failed`;
          if (handledTransitions.has(failureKey)) return;
          handledTransitions.add(failureKey);

          Promise.resolve(onFailed?.(tempId, error)).catch((err) => {
            logger.error('useTabManagement onFailed callback failed', { err });
          });
        } else if (event === 'removed') {
          logger.info('Optimistic workspace removed', { optimisticId: tempId });

          const removedKey = `${tempId}-removed`;
          if (handledTransitions.has(removedKey)) return;
          handledTransitions.add(removedKey);

          Promise.resolve(onRemoved?.(tempId)).catch((err) => {
            logger.error('useTabManagement onRemoved callback failed', { err });
          });
        }
      },
    );

    // Cleanup listener + handled transitions when workspace changes
    return () => {
      unsubscribe?.();
      if (transitionTimeout) {
        clearTimeout(transitionTimeout);
        transitionTimeout = null;
      }
      if (workspaceId !== previousWorkspaceId) {
        handledTransitions.clear();
      }
    };
  });

  return {
    // State
    get tabOpened() {
      return tabOpened;
    },
    get isInTransition() {
      return isInTransition;
    },
    get handledTransitions() {
      return handledTransitions;
    },

    // Methods
    clearHandledTransitions() {
      handledTransitions.clear();
    },

    resetTabOpened() {
      tabOpened = false;
    },
  };
}
