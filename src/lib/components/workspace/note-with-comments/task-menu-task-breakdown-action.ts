import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import { selectWorkspaceDefaultModel } from '$lib/store/slices/model/model-selectors';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { createAgentTypeId } from '$shared/types/agent.types';

import type { AgentContext } from '$features/agent/agent-context';

import type { LoggerLike } from './logger.types';

export async function runTaskBreakdownTaskMenuAction({
  workspace,
  noteId,
  taskData,
  dispatch,
  logger,
}: {
  workspace: Workspace;
  noteId: string | null | undefined;
  taskData: any;
  dispatch: (type: 'agentLaunched', detail: any) => void;
  logger: LoggerLike;
}): Promise<void> {
  try {
    const taskText = taskData.text || 'Unknown task';
    const taskPosition = parseInt(taskData.position) || 0;
    const taskChecked = taskData.checked === true || taskData.checked === 'true';

    const context: AgentContext[] = [
      {
        type: 'task',
        content: taskText,
        metadata: {
          source: 'task-menu',
          noteId: noteId || 'spec',
          workspaceId: workspace.id,
          taskPosition,
          taskChecked,
          anchorName: taskData.anchorName,
        },
      },
      noteId
        ? {
          type: 'note',
          content: `Note ID: ${noteId}`,
          metadata: {
            noteId,
            source: 'task-menu',
          },
        }
        : {
          type: 'spec',
          content: "Space specification (note ID 'spec').",
          metadata: {
            noteId: 'spec',
            source: 'task-menu',
          },
        },
    ];

    const userMessage = `Please break down this task into smaller subtasks: "${taskText}". Read the space specification and analyze the codebase for context, then replace the original task with a breakdown of manageable subtasks.`;

    // Use the task text with a prefix to indicate it's a breakdown task
    // The factory will sanitize and truncate the name
    const agentName = `Break down: ${taskText}`;

    // Launch agent using agentFactory (consistent with other creation paths)
    // Use workspace's default model if set, otherwise fall back to global
    const { agentFactory } = await import('$features/agent/services/agent-factory');
    const result = await agentFactory.createAgent(workspace, {
      name: agentName,
      workspaceId: WorkspaceId(workspace.id),
      initialMessage: userMessage, // User message (sent as initial message)
      agentType: createAgentTypeId('task-breakdown'),
      model: selectWorkspaceDefaultModel.select(getReduxStore().getState(), workspace.id),
      contextReferences: context,
      source: 'task-menu',
      metadata: {
        source: 'task-menu',
        agentType: 'task-breakdown',
        contextReferences: context,
      },
    });

    if (!result.success || !result.agent) {
      throw new Error(result.error || 'Failed to create agent session');
    }

    const session = result.agent;
    const agentData = session;

    logger.info('Dispatching agentLaunched event from task-breakdown agent', {
      agentId: agentData.id,
      agentName: agentData.name,
    });
    // Task breakdown agents from task menu should also avoid auto-opening the drawer
    dispatch('agentLaunched', { agent: agentData, autoOpenDrawer: false });
  } catch (error) {
    logger.error('Failed to launch task-breakdown agent:', error);
  }
}
