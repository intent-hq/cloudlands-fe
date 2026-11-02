/**
 * useCreationTransition Composable
 *
 * Tracks whether the routed workspace is still being created, so the page can
 * avoid transient loading flashes while a newly created workspace settles.
 *
 * The workspace page does not open its own workspace tab: callers jump with
 * `openAndShowWorkspace` (`$lib/utils/show-workspace`), which navigates and
 * then opens the tab, and boot-time routing in `+layout.svelte` opens the tab
 * of the route the window starts on.
 */

import { selectWorkspacePendingCreations } from '$store/renderer/slices/workspace/workspace-selectors';

import { createLogger } from '$lib/utils/client-logger';
import { store as appStore } from '$store/renderer/store';

const logger = createLogger('creation-transition');

export interface UseCreationTransitionOptions {
  workspaceId: string;
  previousWorkspaceId: string | null;
  onTransitionDetected?: () => void;
}

export function useCreationTransition(options: UseCreationTransitionOptions) {
  // Track handled transitions to prevent loops
  const handledTransitions = $state(new Set<string>());

  // Track if we're in a transition to prevent skeleton loaders
  let isInTransition = $state(false);

  $effect(() => {
    const { workspaceId, previousWorkspaceId, onTransitionDetected } = options;

    if (!workspaceId) {
      return;
    }

    const transitionKey = `${workspaceId}-pending`;
    const pendingCreations = selectWorkspacePendingCreations.select(appStore.state);
    const isPendingCreation = !!pendingCreations[workspaceId];

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
    get isInTransition() {
      return isInTransition;
    },
    get handledTransitions() {
      return handledTransitions;
    },
    clearHandledTransitions() {
      handledTransitions.clear();
    },
  };
}
