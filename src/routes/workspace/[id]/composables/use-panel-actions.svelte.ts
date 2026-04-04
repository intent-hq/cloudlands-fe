/**
 * usePanelActions Composable
 *
 * Manages panel actions for opening files, notes, agents, and terminals.
 * Extracted from +page.svelte to reduce file size and improve maintainability.
 */

import { agentFactory } from '$features/agent/services/agent-factory';
import { selectWorkspaceDefaultModel } from '$lib/store/slices/model/model-selectors';
import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import { createAgentTypeId } from '$shared/types/agent.types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { createLogger } from '$lib/utils/client-logger';
import { openTerminalOverlay } from '$lib/store/slices/terminals/terminals-slice';
import { getDispatch } from '$lib/store/utils/utils';
import type { Workspace } from '$shared/types';
import type { WorkspacePageState, WorkspacePageStateManager } from './workspace-page-state.svelte';

const logger = createLogger('panel-actions');

export interface UsePanelActionsOptions {
  workspace: () => Workspace | null;
  workspaceState: () => WorkspacePageStateManager | null;
  state: () => WorkspacePageState | null;
  agents?: () => Array<{ id: string; name?: string | null }>;
  /**
   * Svelte 5 $state(Set) requires cloning to trigger reactivity.
   * Caller is responsible for implementing that (e.g. add + clone).
   */
  markAgentRecentlyCreated: (agentId: string) => void;
  onDraftPromptSet: (prompt: string | null) => void;
}

export function usePanelActions(options: UsePanelActionsOptions) {
  const dispatch = getDispatch();
  async function openFile(filePath: string) {
    await options.workspaceState()?.openFile(filePath);
  }

  async function openNote(noteId: string) {
    await options.workspaceState()?.openNote(noteId);
  }

  function openAgent(agentId: string) {
    const workspaceState = options.workspaceState();
    const state = options.state();

    logger.info('[openAgent] Called', {
      agentId,
      hasWorkspaceState: !!workspaceState,
      currentDrawerState: state?.drawer,
      workspaceId: workspaceState?.state?.workspace?.id,
    });

    // Check if agentId is undefined or null
    if (!agentId) {
      logger.error('[openAgent] Invalid agent ID - undefined or null', { agentId });
      return;
    }

    // Validate agent ID format
    if (agentId.startsWith('terminal-')) {
      logger.error('[openAgent] Invalid agent ID - appears to be a terminal ID', { agentId });
      return;
    }

    // Toggle: if clicking the already active agent, close the drawer
    if (
      state?.drawer?.open &&
      state?.drawer?.type === 'agent' &&
      state?.drawer?.itemId === agentId
    ) {
      logger.info('[openAgent] Closing drawer - already open with same agent');
      workspaceState?.closeDrawer();
    } else {
      logger.info('[openAgent] Opening drawer with agent', { agentId });
      if (!workspaceState) {
        logger.error('[openAgent] Cannot open drawer - workspaceState is null!');
      } else {
        workspaceState.openDrawer('agent', agentId);
      }
    }
  }

  function openTerminal(terminalId: string) {
    const workspace = options.workspace();
    const agents = options.agents?.() ?? [];

    logger.info('[openTerminal] Called', {
      terminalId,
      workspaceId: workspace?.id,
    });

    // Validate terminal ID format
    if (terminalId.startsWith('agent-')) {
      logger.error('[openTerminal] Invalid terminal ID - appears to be an agent ID', {
        terminalId,
        agentsArray: agents.map((a) => ({ id: a.id, name: a.name })),
      });
      // This might be a bug where an agent is being passed to the terminal handler
      // Try to open it as an agent instead
      logger.warn('[openTerminal] Attempting to open as agent instead');
      openAgent(terminalId);
      return;
    }

    // Open the Quake-style terminal overlay
    if (workspace?.id) {
      dispatch(openTerminalOverlay(workspace.id, terminalId));
    }
  }

  function closeDrawer() {
    options.workspaceState()?.closeDrawer();
  }

  /**
   * Create an agent and pre-fill the input with a prompt (without sending)
   * Used for contextual actions like "Generate tasks from spec" and "Delegate tasks"
   */
  async function handleCreateAgentWithPrompt(prompt: string, name: string) {
    const workspace = options.workspace();
    const { markAgentRecentlyCreated, onDraftPromptSet } = options;

    if (!workspace) {
      logger.error(
        '[handleCreateAgentWithPrompt] Cannot create agent with prompt: workspace not loaded',
      );
      return;
    }

    try {
      logger.info('[handleCreateAgentWithPrompt] Creating agent with draft prompt', {
        name,
        promptLength: prompt.length,
        workspaceId: workspace.id,
      });

      // Create agent WITHOUT initial message - we'll pre-fill the input instead
      const result = await agentFactory.createAgent(workspace, {
        name,
        workspaceId: WorkspaceId(workspace.id),
        model: selectWorkspaceDefaultModel.select(getReduxStore().getState(), workspace.id),
        agentType: createAgentTypeId('chat'),
        source: 'progress-card-action',
        metadata: {
          source: 'progress-card-action',
        },
      });

      if (!result.success || !result.agent) {
        logger.error(
          '[handleCreateAgentWithPrompt] Failed to create agent with draft prompt',
          result.error,
        );
        return;
      }

      const session = result.agent;

      // Add to recently created agents to prevent drawer from auto-closing
      markAgentRecentlyCreated(session.id);

      // Set the draft prompt BEFORE opening the drawer so it's available when ChatPanel mounts
      onDraftPromptSet(prompt);

      // Open the agent drawer
      openAgent(session.id);

      // Clear draft prompt after a delay to allow ChatPanel to read it
      setTimeout(() => {
        onDraftPromptSet(null);
      }, 500);

      logger.info('[handleCreateAgentWithPrompt] Agent created with draft prompt successfully', {
        agentId: session.id,
        name: session.name,
        draftPromptLength: prompt.length,
      });
    } catch (error) {
      logger.error('[handleCreateAgentWithPrompt] Error creating agent with draft prompt', error);
    }
  }

  return {
    // Methods
    openFile,
    openNote,
    openAgent,
    openTerminal,
    closeDrawer,
    handleCreateAgentWithPrompt,
  };
}
