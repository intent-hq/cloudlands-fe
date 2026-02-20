/**
 * useCloseHandlers Composable
 *
 * Manages close event handlers for various panels in the workspace.
 * Extracted from +page.svelte to reduce file size and improve maintainability.
 */

import { createLogger } from '$lib/utils/client-logger';
import type { createUnifiedWorkspaceState } from '$features/workspace/workspace-unified-state.svelte';

/** Type alias for the unified workspace state manager */
export type UnifiedWorkspaceStateManager = ReturnType<typeof createUnifiedWorkspaceState>;

const logger = createLogger('close-handlers');

export interface UseCloseHandlersOptions {
  workspaceState: UnifiedWorkspaceStateManager | null;
  onOpenTerminal: (terminalId: string) => void;
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

  function handleOpenAcceptChanges() {
    const { workspaceState } = options;
    if (workspaceState) {
      logger.debug('[WorkspacePage] Opening accept changes panel');
      workspaceState.openAcceptChanges();
    }
  }

  function handleCloseAcceptChanges() {
    const { workspaceState } = options;
    if (workspaceState) {
      logger.debug('[WorkspacePage] Closing accept changes panel');
      workspaceState.setMainPanel('empty');
    }
  }

  async function handleDiagramBindingClick(e: Event) {
    const { workspaceState } = options;
    const { type, target, openInAdjacentPanel, sourcePanelId } =
      (e as CustomEvent).detail || {};
    if (type === 'file' && target) {
      await workspaceState?.openFile(target, { openInAdjacentPanel, sourcePanelId });
    } else if (type === 'note' && target) {
      await workspaceState?.openNote(target, { openInAdjacentPanel, sourcePanelId });
    }
  }

  function handleOpenTerminalEvent(e: Event) {
    const detail = (e as CustomEvent).detail;
    if (detail?.terminalId) {
      options.onOpenTerminal(detail.terminalId);
    }
  }

  // Set up all event listeners
  $effect(() => {
    if (typeof window === 'undefined') return;

    const handleCloseFile = () => handleCloseMainPanel();
    const handleCloseDiff = () => handleCloseMainPanel();
    const handleCloseNote = () => handleCloseMainPanel();
    const handleCloseBrowser = () => handleCloseMainPanel();
    const handleCloseTrackedChange = () => handleCloseMainPanel();
    const handleCloseActivity = () => handleCloseMainPanel();
    const handleCloseChatChanges = () => handleCloseMainPanel();
    const handleCloseAgentTurn = () => handleCloseMainPanel();
    const handleCloseSource = () => handleCloseMainPanel();
    const handleCloseLocalChanges = () => handleCloseMainPanel();
    const handleCloseCommitChangeset = () => handleCloseMainPanel();

    window.addEventListener('close-file', handleCloseFile);
    window.addEventListener('close-diff', handleCloseDiff);
    window.addEventListener('close-note', handleCloseNote);
    window.addEventListener('close-browser', handleCloseBrowser);
    window.addEventListener('close-commit', handleCloseCommit);
    window.addEventListener('workspace:open-accept-changes', handleOpenAcceptChanges);
    window.addEventListener('close-accept-changes', handleCloseAcceptChanges);
    window.addEventListener('close-tracked-change', handleCloseTrackedChange);
    window.addEventListener('close-activity', handleCloseActivity);
    window.addEventListener('close-chat-changes', handleCloseChatChanges);
    window.addEventListener('close-agent-turn', handleCloseAgentTurn);
    window.addEventListener('close-source', handleCloseSource);
    window.addEventListener('close-local-changes', handleCloseLocalChanges);
    window.addEventListener('close-commit-changeset', handleCloseCommitChangeset);
    window.addEventListener('workspace:openTerminal', handleOpenTerminalEvent);
    window.addEventListener('diagram:binding-click', handleDiagramBindingClick);

    return () => {
      window.removeEventListener('close-file', handleCloseFile);
      window.removeEventListener('close-diff', handleCloseDiff);
      window.removeEventListener('close-note', handleCloseNote);
      window.removeEventListener('close-browser', handleCloseBrowser);
      window.removeEventListener('close-commit', handleCloseCommit);
      window.removeEventListener('workspace:open-accept-changes', handleOpenAcceptChanges);
      window.removeEventListener('close-accept-changes', handleCloseAcceptChanges);
      window.removeEventListener('close-tracked-change', handleCloseTrackedChange);
      window.removeEventListener('close-activity', handleCloseActivity);
      window.removeEventListener('close-chat-changes', handleCloseChatChanges);
      window.removeEventListener('close-agent-turn', handleCloseAgentTurn);
      window.removeEventListener('close-source', handleCloseSource);
      window.removeEventListener('close-local-changes', handleCloseLocalChanges);
      window.removeEventListener('close-commit-changeset', handleCloseCommitChangeset);
      window.removeEventListener('workspace:openTerminal', handleOpenTerminalEvent);
      window.removeEventListener('diagram:binding-click', handleDiagramBindingClick);
    };
  });

  return {
    // Methods for direct use
    handleCloseMainPanel,
    handleCloseCommit,
    handleOpenAcceptChanges,
    handleCloseAcceptChanges,
    handleDiagramBindingClick,
  };
}
