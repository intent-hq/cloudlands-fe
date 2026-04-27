/**
 * useCloseHandlers Composable
 *
 * Manages close event handlers for various panels in the workspace.
 * Extracted from +page.svelte to reduce file size and improve maintainability.
 */

import { createLogger } from '$lib/utils/client-logger';
import type { WorkspacePageStateManager } from './workspace-page-state.svelte';

const logger = createLogger('close-handlers');

export interface UseCloseHandlersOptions {
  workspaceId: string;
  workspaceState: WorkspacePageStateManager | null;
}

export function useCloseHandlers(options: UseCloseHandlersOptions) {
  function handleCloseMainPanel() {
    const { workspaceState } = options;
    if (workspaceState) {
      logger.debug('[WorkspacePage] Closing main panel');
      // Clear all selection state when closing to empty
      workspaceState.setMainPanel('empty', {
        selectedFile: undefined,
        selectedNoteId: undefined,
        selectedChangeId: undefined,
        selectedTrackedChange: undefined,
        selectedActivityEvent: undefined,
        selectedAgentTurn: undefined,
        selectedCommit: undefined,
        chatChanges: undefined,
        chatChangesTitle: undefined,
        chatChangesAgentId: undefined,
        chatChangesTurnNumber: undefined,
        chatChangesIsAggregate: undefined,
      });
    }
  }

  function handleCloseCommit() {
    const { workspaceState } = options;
    if (workspaceState) {
      logger.debug('[WorkspacePage] Closing commit panel');
      workspaceState.clearCommitView();
    }
  }

  function handleCloseAcceptChanges() {
    const { workspaceState } = options;
    if (workspaceState) {
      logger.debug('[WorkspacePage] Closing accept changes panel');
      workspaceState.setMainPanel('empty');
    }
  }

  return {
    // Methods for direct use
    handleCloseMainPanel,
    handleCloseCommit,
    handleCloseAcceptChanges,
  };
}

