/**
 * useTaskDelegationHandlers Composable
 *
 * Centralizes workspace-level window event listeners related to task delegation
 * and task-note agent assignment.
 *
 * Extracted from +page.svelte to reduce file size and keep event wiring cohesive.
 */

import { createLogger } from '$lib/utils/client-logger';

import { AgentId, NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { createAgentTypeId } from '$shared/types/agent.types';

import { agentFactory } from '$features/agent/services/agent-factory';
import { sessionStore } from '$features/agent/browser';
import { notesClient } from '$features/notes/notes.client';
import { notesStateManager } from '$features/notes/notes.store.svelte';
import { buildTaskAgentInitialMessage } from '$features/notes/utils/task-agent-message-builder';
import { getAgentProvider } from '$shared/types/agent-session';

import { selectWorkspaceDefaultModel } from '$lib/store/slices/model/model-selectors';
import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import { selectEffectiveModel, selectEffectiveBehaviorPrompt } from '$lib/store/slices/specialists/specialists-selectors';
import { SPECIALISTS } from '$lib/constants/specialists';
import { getDefaultModelForProvider, PROVIDER_MODEL_TIERS } from '$shared/config/provider-config';
import { selectActiveProviderId } from '$lib/store/slices/active-provider/active-provider-selectors';

const logger = createLogger('task-delegation-handlers');

/**
 * Find the provider from the workspace's initial agent session.
 * Returns undefined if no initial agent exists (legacy workspaces).
 */
function getWorkspaceInitialAgentProvider(workspaceId: string): string | undefined {
  const sessions = sessionStore.getAllSessions();
  const initialAgent = sessions.find(
    (s) => String(s.workspaceId) === workspaceId && s.isInitialAgent,
  );
  if (!initialAgent) return undefined;
  return getAgentProvider(initialAgent);
}

export interface DelegateTaskEventDetail {
  taskText?: string;
  noteId?: string;
  openAgent?: boolean;
}

export interface CreateAgentForNoteEventDetail {
  noteId?: string;
  noteTitle?: string;
}

export interface RunAgentForNoteEventDetail {
  noteId?: string;
  noteTitle?: string;
}

export interface UseTaskDelegationHandlersOptions {
  /** Current workspace for the page (safeWorkspace) */
  workspace: () => any | null;
  /** Fallback for creating a new task note+agent when noteId is not provided */
  delegateTask: (taskText: string) => Promise<string | null>;
  /** Open the created/selected agent in the drawer */
  onOpenAgent: (agentId: string) => void;
}

export function useTaskDelegationHandlers(options: UseTaskDelegationHandlersOptions) {
  $effect(() => {
    if (typeof window === 'undefined') return;

    const handleDelegateTaskEvent = async (event: Event) => {
      const detail = (event as CustomEvent<DelegateTaskEventDetail>).detail || {};
      const taskText = detail.taskText;
      const noteId = detail.noteId;
      const shouldOpenAgent = !!detail.openAgent;

      if (!taskText) return;

      const workspace = options.workspace();

      // If noteId is provided, the task note already exists - just create an agent
      if (noteId && workspace) {
        try {
          logger.info('[WorkspacePage] Delegating existing task note', { noteId, taskText });

          // Get the existing note to use its title
          const existingNote = notesStateManager.findById(NoteId(noteId));
          const noteTitle = existingNote?.title || taskText;

          // Inherit provider from the workspace's initial agent (not from global store)
          const provider = getWorkspaceInitialAgentProvider(workspace.id);

          // Create agent WITH initial message to start work immediately
          const result = await agentFactory.createAgent(workspace, {
            name: noteTitle,
            workspaceId: WorkspaceId(workspace.id),
            model: selectWorkspaceDefaultModel.select(getReduxStore().getState(), workspace.id),
            provider,
            agentType: createAgentTypeId('task-loop'),
            source: 'delegate-task',
            metadata: {
              taskNoteId: noteId,
              source: 'task-delegation',
            },
            initialMessage: taskText,
          });

          if (!result.success || !result.agentId) {
            logger.error('[WorkspacePage] Failed to create agent for existing task', {
              error: result.error,
            });
            return;
          }

          const createdAgentId = result.agentId;

          await notesClient.assignAgentToTask(
            WorkspaceId(workspace.id),
            NoteId(noteId),
            AgentId(createdAgentId),
          );

          await notesStateManager.reloadNotes();

          if (shouldOpenAgent) {
            options.onOpenAgent(createdAgentId);
          }

          logger.info('[WorkspacePage] Agent created for existing task note', {
            agentId: createdAgentId,
            noteId,
          });
        } catch (error) {
          logger.error('[WorkspacePage] Failed to delegate existing task', error as Error);
        }

        return;
      }

      // No noteId - create a new task note and agent via provided delegateTask
      const createdAgentId = await options.delegateTask(taskText);
      if (shouldOpenAgent && createdAgentId) {
        options.onOpenAgent(createdAgentId);
      }
    };

    const handleCreateAgentForNoteEvent = async (event: Event) => {
      const detail = (event as CustomEvent<CreateAgentForNoteEventDetail>).detail || {};
      const noteId = detail.noteId;
      const noteTitle = detail.noteTitle;

      const workspace = options.workspace();

      if (!noteId || !workspace) {
        logger.error('[WorkspacePage] Cannot create agent for note: missing noteId or workspace');
        return;
      }

      try {
        logger.info('[WorkspacePage] Creating agent for note (no initial message)', {
          noteId,
          noteTitle,
        });

        // Inherit provider from the workspace's initial agent (not from global store)
        const provider = getWorkspaceInitialAgentProvider(workspace.id);

        const result = await agentFactory.createAgent(workspace, {
          name: noteTitle || 'Task Agent',
          workspaceId: WorkspaceId(workspace.id),
          model: selectWorkspaceDefaultModel.select(getReduxStore().getState(), workspace.id),
          provider,
          agentType: createAgentTypeId('task-loop'),
          source: 'task-metadata-bar',
          metadata: {
            taskNoteId: noteId,
            source: 'task-assignment',
          },
        });

        if (!result.success || !result.agentId) {
          logger.error('[WorkspacePage] Failed to create agent for note', {
            error: result.error,
          });
          return;
        }

        const createdAgentId = result.agentId;

        await notesClient.assignAgentToTask(
          WorkspaceId(workspace.id),
          NoteId(noteId),
          AgentId(createdAgentId),
        );

        await notesStateManager.reloadNotes();
        options.onOpenAgent(createdAgentId);

        logger.info('[WorkspacePage] Agent created and assigned to note', {
          agentId: createdAgentId,
          noteId,
        });
      } catch (error) {
        logger.error('[WorkspacePage] Error creating agent for note', error as Error);
      }
    };

    // Handler for running an agent on a task (creates agent with initial message)
    const handleRunAgentForNoteEvent = async (event: Event) => {
      const detail = (event as CustomEvent<RunAgentForNoteEventDetail>).detail || {};
      const noteId = detail.noteId;
      const noteTitle = detail.noteTitle;

      const workspace = options.workspace();

      if (!noteId || !workspace) {
        logger.error('[WorkspacePage] Cannot run agent for note: missing noteId or workspace');
        return;
      }

      try {
        logger.info('[WorkspacePage] Running agent for note (with initial message)', {
          noteId,
          noteTitle,
        });

        // Get the note to build the initial message
        const note = notesStateManager.findById(NoteId(noteId));
        if (!note) {
          logger.error('[WorkspacePage] Cannot run agent: note not found', { noteId });
          return;
        }

        // Build the initial message that tells the agent to work on the task
        const initialMessage = buildTaskAgentInitialMessage(note);

        // Use implementor specialist for task agents
        // Try store first, fall back to SPECIALISTS constant if store returns empty
        let implementorModel = selectEffectiveModel.select(getReduxStore().getState(), 'implementor');
        let implementorBehaviorPrompt = selectEffectiveBehaviorPrompt.select(getReduxStore().getState(), 'implementor');

        // Fallback to SPECIALISTS constant if store returns empty (can happen in async contexts)
        if (!implementorBehaviorPrompt) {
          const implementorSpec = SPECIALISTS.find((s) => s.id === 'implementor');
          if (implementorSpec) {
            implementorBehaviorPrompt = implementorSpec.defaultBehaviorPrompt;
            // Resolve model from tier if not already set
            if (!implementorModel) {
              const activeProvider = selectActiveProviderId.select(getReduxStore().getState());
              implementorModel =
                implementorSpec.defaultModelTier && activeProvider in PROVIDER_MODEL_TIERS
                  ? getDefaultModelForProvider(activeProvider, implementorSpec.defaultModelTier)
                  : implementorSpec.defaultModel ?? '';
            }
          }
        }

        // Inherit provider from the workspace's initial agent (not from global store)
        const provider = getWorkspaceInitialAgentProvider(workspace.id);

        logger.debug('[WorkspacePage] Creating implementor agent', {
          implementorModel,
          hasBehaviorPrompt: !!implementorBehaviorPrompt,
          provider,
        });

        const result = await agentFactory.createAgent(workspace, {
          name: noteTitle || 'Task Agent',
          workspaceId: WorkspaceId(workspace.id),
          model: implementorModel || selectWorkspaceDefaultModel.select(getReduxStore().getState(), workspace.id),
          provider,
          agentType: createAgentTypeId('task-loop'),
          behaviorPrompt: implementorBehaviorPrompt,
          source: 'task-metadata-bar-run',
          metadata: {
            taskNoteId: noteId,
            source: 'task-run',
            specialist: 'implementor',
          },
          initialMessage,
        });

        if (!result.success || !result.agentId) {
          logger.error('[WorkspacePage] Failed to run agent for note', {
            error: result.error,
          });
          return;
        }

        const createdAgentId = result.agentId;

        await notesClient.assignAgentToTask(
          WorkspaceId(workspace.id),
          NoteId(noteId),
          AgentId(createdAgentId),
        );

        await notesStateManager.reloadNotes();
        options.onOpenAgent(createdAgentId);

        logger.info('[WorkspacePage] Agent created, assigned, and running on note', {
          agentId: createdAgentId,
          noteId,
        });
      } catch (error) {
        logger.error('[WorkspacePage] Error running agent for note', error as Error);
      }
    };

    window.addEventListener('delegate-task', handleDelegateTaskEvent);
    window.addEventListener('create-agent-for-note', handleCreateAgentForNoteEvent);
    window.addEventListener('run-agent-for-note', handleRunAgentForNoteEvent);

    return () => {
      window.removeEventListener('delegate-task', handleDelegateTaskEvent);
      window.removeEventListener('create-agent-for-note', handleCreateAgentForNoteEvent);
      window.removeEventListener('run-agent-for-note', handleRunAgentForNoteEvent);
    };
  });

  return {};
}
