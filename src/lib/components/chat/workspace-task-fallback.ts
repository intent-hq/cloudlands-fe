import type {
  AgentMessage,
  AgentSession,
  PlanEntryStatus,
  TaskStatus,
  WorkspaceTask,
} from '$shared/types';

export type TaskProgressStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'discussion_needed'
  | 'blocked'
  | 'review_required'
  | 'completed';

export interface TaskProgressItem {
  id: string;
  title: string;
  status: TaskProgressStatus;
}

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

function planStatus(status: PlanEntryStatus): TaskProgressStatus {
  if (status === 'completed') return 'completed';
  if (status === 'in_progress') return 'running';
  return 'pending';
}

function workspaceStatus(status: TaskStatus): TaskProgressStatus {
  if (status === 'complete') return 'completed';
  if (status === 'in_progress') return 'running';
  if (status === 'discussion_needed') return 'discussion_needed';
  if (status === 'review_required') return 'review_required';
  if (status === 'waiting' || status === 'blocked') return status;
  return 'pending';
}

function latestNativePlan(messages: readonly AgentMessage[]): TaskProgressItem[] {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    const blocks = message.contentBlocks ?? [];
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (block.type !== 'plan' || !block.entries?.length) continue;
      const blockId = block.id ?? `${message.id}:${blockIndex}`;
      return block.entries.map((entry, entryIndex) => ({
        id: `plan:${blockId}:${entryIndex}`,
        title: entry.content,
        status: planStatus(entry.status),
      }));
    }
  }
  return [];
}

/** Select the newest native plan, or the existing scoped workspace-task fallback. */
export function deriveTaskProgress(input: WorkspaceTaskFallbackInput): TaskProgressItem[] {
  const nativePlan = latestNativePlan(input.messages);
  if (nativePlan.length > 0) return nativePlan;
  return deriveWorkspaceTaskFallback(input).map((task) => ({
    id: `workspace:${task.id}`,
    title: task.title,
    status: workspaceStatus(task.status),
  }));
}
