import type { Workspace } from '$shared/types';
import { createAgentTypeId } from '$shared/types/agent.types';
import { store as appStore } from '$lib/store/store';
import { agentSessionLaunchAgentRequested } from '$lib/store/slices/agent-session/agent-session-slice';

import type { AgentContext } from '$features/agent/agent-context';

export function runTaskBreakdownTaskMenuAction({
  workspace,
  noteId,
  taskData,
}: {
  workspace: Workspace;
  noteId: string | null | undefined;
  taskData: any;
}): void {
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

  const launchAction = agentSessionLaunchAgentRequested(workspace.id, {
    name: agentName,
    initialMessage: userMessage, // User message (sent as initial message)
    agentType: createAgentTypeId('task-breakdown'),
    contextReferences: context,
    source: 'task-menu',
    metadata: {
      source: 'task-menu',
      agentType: 'task-breakdown',
      contextReferences: context,
    },
  });
  appStore.dispatch(launchAction);
}
