import type { AgentMessage, AgentSession, WorkspaceTask } from '$shared/types';

interface WorkspaceTaskFallbackInput {
  initialized: boolean;
  tasks: readonly WorkspaceTask[];
  session?: AgentSession | null;
  messages: readonly AgentMessage[];
}

export function hasNativeExecutionPlan(messages: readonly AgentMessage[]): boolean {
  return messages.some((message) =>
    message.contentBlocks?.some(
      (block) => block.type === 'plan' && Array.isArray(block.entries) && block.entries.length > 0,
    ),
  );
}

/** Select the zero-token task fallback without changing canonical task order. */
export function deriveWorkspaceTaskFallback({
  initialized,
  tasks,
  session,
  messages,
}: WorkspaceTaskFallbackInput): WorkspaceTask[] {
  if (!initialized || hasNativeExecutionPlan(messages)) return [];

  const taskNoteId = session?.metadata?.taskNoteId ?? session?.agentMetadata?.taskNoteId;
  if (typeof taskNoteId === 'string' && taskNoteId.length > 0) {
    const linkedTask = tasks.find((task) => task.id === taskNoteId && task.status !== 'cancelled');
    return linkedTask ? [linkedTask] : [];
  }

  return tasks.filter((task) => task.specLinked === true && task.status !== 'cancelled');
}
