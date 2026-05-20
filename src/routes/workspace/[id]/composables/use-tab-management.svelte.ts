/**
 * useTabManagement Composable
 *
 * Manages workspace tab opening and pending-creation transitions.
 * Extracted from +page.svelte to reduce file size and improve maintainability.
 */

import { openWorkspaceTab } from '$lib/store/slices/tab-state/tab-state-slice';
import { selectWorkspacePendingCreations } from '$lib/store/slices/workspace/workspace-selectors';

import { createLogger } from '$lib/utils/client-logger';
import { fromStore } from 'svelte/store';
import type { WorkspacePageStateManager } from './workspace-page-state.svelte';
  import { store as appStore } from '$lib/store/store';

const logger = createLogger('tab-management');

export interface UseTabManagementOptions {
  workspaceId: string;
  workspaceState: WorkspacePageStateManager | null;
  previousWorkspaceId: string | null;
  onTransitionDetected?: () => void;
}

export function useTabManagement(options: UseTabManagementOptions) {
  const pendingCreations = selectWorkspacePendingCreations();
  const pendingCreationsValue = fromStore(pendingCreations);

  // Track if tab is open to avoid duplicate operations
  let tabOpened = $state(false);

  // Track handled transitions to prevent loops
  const handledTransitions = $state(new Set<string>());

  // Track if we're in a transition to prevent skeleton loaders
  let isInTransition = $state(false);

  // Open tab when workspace loads with proper cleanup
  $effect(() => {
    const { workspaceId, previousWorkspaceId } = options;

    if (workspaceId && !tabOpened) {
      try {
        appStore.dispatch(openWorkspaceTab(workspaceId));
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

  // Track pending workspace creation state via Redux so the page can avoid
  // transient loading flashes while a newly-created workspace settles.
  $effect(() => {
    const { workspaceId, previousWorkspaceId, onTransitionDetected } = options;

    if (!workspaceId) {
      return;
    }

    const transitionKey = `${workspaceId}-pending`;
    const isPendingCreation = !!pendingCreationsValue.current[workspaceId];

    if (isPendingCreation) {
      if (!handledTransitions.has(transitionKey)) {
        handledTransitions.add(transitionKey);
        logger.info('Workspace creation still pending', { workspaceId });
        onTransitionDetected?.();
      }

      isInTransition = true;
    } else {
      handledTransitions.delete(transitionKey);
      isInTransition = false;
    }

    return () => {
      if (workspaceId !== previousWorkspaceId) {
        handledTransitions.clear();
        isInTransition = false;
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
