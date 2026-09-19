/**
 * usePanelActions Composable
 *
 * Manages panel actions for opening files, notes, agents, and terminals.
 * Extracted from +page.svelte to reduce file size and improve maintainability.
 */

import { createAgentTypeId } from '$shared/types/agent.types';
import { createLogger } from '$lib/utils/client-logger';
import { openTerminalOverlay } from '$store/renderer/slices/terminals/terminals-slice';
import { agentSessionLaunchAgentRequested } from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  clearAgentCreationRequest,
  type AgentCreationRequestEntry,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

import type { Workspace } from '$shared/types';
import type { WorkspacePageState, WorkspacePageStateManager } from './workspace-page-state.svelte';
import { store as appStore } from '$store/renderer/store';
import { onDestroy } from 'svelte';
import { fromStore, type Readable } from 'svelte/store';

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
  agentCreationRequest: Readable<AgentCreationRequestEntry | undefined>;
  setAgentCreationRequestContext: (workspaceId: string, requestId: string) => void;
}

export function usePanelActions(options: UsePanelActionsOptions) {
  let pendingLaunch = $state<{
    workspaceId: string;
    requestId: string;
    prompt: string;
    name: string;
  } | null>(null);
  const launchRequest = fromStore(options.agentCreationRequest);

  $effect(() => {
    const pending = pendingLaunch;
    const request = launchRequest.current;
    if (!pending || !request || request.loading || request.requestId !== pending.requestId) return;

    if (request.error || !request.agentId) {
      logger.error('[handleCreateAgentWithPrompt] Error creating agent with draft prompt', {
        error: request.error,
        name: pending.name,
      });
    } else {
      options.markAgentRecentlyCreated(request.agentId);
      options.onDraftPromptSet(pending.prompt);
      openAgent(request.agentId);
      setTimeout(() => options.onDraftPromptSet(null), 500);
      logger.info('[handleCreateAgentWithPrompt] Agent created with draft prompt successfully', {
        agentId: request.agentId,
        name: pending.name,
        draftPromptLength: pending.prompt.length,
      });
    }

    appStore.dispatch(clearAgentCreationRequest(pending.workspaceId, pending.requestId));
    pendingLaunch = null;
  });

  onDestroy(() => {
    if (pendingLaunch) {
      appStore.dispatch(
        clearAgentCreationRequest(pendingLaunch.workspaceId, pendingLaunch.requestId),
      );
    }
  });

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
      appStore.dispatch(openTerminalOverlay(workspace.id, terminalId));
    }
  }

  function closeDrawer() {
    options.workspaceState()?.closeDrawer();
  }

  /**
   * Create an agent and pre-fill the input with a prompt (without sending)
   * Used for contextual actions like "Generate tasks from spec" and "Delegate tasks"
   */
  function handleCreateAgentWithPrompt(prompt: string, name: string) {
    const workspace = options.workspace();

    if (!workspace) {
      logger.error(
        '[handleCreateAgentWithPrompt] Cannot create agent with prompt: workspace not loaded',
      );
      return;
    }

    if (pendingLaunch) {
      appStore.dispatch(
        clearAgentCreationRequest(pendingLaunch.workspaceId, pendingLaunch.requestId),
      );
    }

    logger.info('[handleCreateAgentWithPrompt] Creating agent with draft prompt', {
      name,
      promptLength: prompt.length,
      workspaceId: workspace.id,
    });

    const requestId = globalThis.crypto.randomUUID();
    pendingLaunch = { workspaceId: workspace.id, requestId, prompt, name };
    options.setAgentCreationRequestContext(workspace.id, requestId);
    appStore.dispatch(
      agentSessionLaunchAgentRequested(
        workspace.id,
        {
          name,
          nameExplicitlySet: false,
          agentType: createAgentTypeId('chat'),
          source: 'progress-card-action',
          metadata: { source: 'progress-card-action' },
        },
        { requestId },
      ),
    );
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
