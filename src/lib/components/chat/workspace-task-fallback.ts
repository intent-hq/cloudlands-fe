import type {
  AgentMessage,
  AgentSession,
  PlanEntryStatus,
  TaskStatus,
  WorkspaceTask,
} from '$shared/types';
import { isPlanContentBlock } from '$shared/types';

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

export interface NativePlanSelection {
  present: boolean;
  items: TaskProgressItem[];
}

interface TaskProgressBaseInput {
  initialized: boolean;
  tasks: readonly WorkspaceTask[];
  session?: AgentSession | null;
}

interface WorkspaceTaskFallbackInput extends TaskProgressBaseInput {
  messages: readonly AgentMessage[];
}

export function hasNativeExecutionPlan(messages: readonly AgentMessage[]): boolean {
  return selectNativeExecutionPlan([messages]).present;
}

function workspaceTaskFallback({
  initialized,
  tasks,
  session,
}: TaskProgressBaseInput): WorkspaceTask[] {
  if (!initialized) return [];

  const taskNoteId = session?.metadata?.taskNoteId ?? session?.agentMetadata?.taskNoteId;
  if (typeof taskNoteId === 'string' && taskNoteId.length > 0) {
    const linkedTask = tasks.find((task) => task.id === taskNoteId && task.status !== 'cancelled');
    return linkedTask ? [linkedTask] : [];
  }

  const hasSpecLinkedMetadata = tasks.some((task) => task.specLinked !== undefined);
  return tasks.filter(
    (task) => task.status !== 'cancelled' && (!hasSpecLinkedMetadata || task.specLinked === true),
  );
}

/** Select the zero-token task fallback without changing canonical task order. */
export function deriveWorkspaceTaskFallback(input: WorkspaceTaskFallbackInput): WorkspaceTask[] {
  if (hasNativeExecutionPlan(input.messages)) return [];
  return workspaceTaskFallback(input);
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

/** Select the newest native plan without joining ordered transcript segments. */
export function selectNativeExecutionPlan(
  messageSources: readonly (readonly AgentMessage[])[],
): NativePlanSelection {
  if (!Array.isArray(messageSources)) return { present: false, items: [] };
  for (let sourceIndex = messageSources.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
    const messages = messageSources[sourceIndex];
    if (!Array.isArray(messages)) continue;
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = messages[messageIndex];
      if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
      const blocks = Array.isArray(message.contentBlocks) ? message.contentBlocks : [];
      for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
        const block = blocks[blockIndex];
        if (!isPlanContentBlock(block)) continue;
        const entries = block.entries;
        if (!Array.isArray(entries)) continue;
        const blockId = block.id ?? `${message.id}:${blockIndex}`;
        return {
          present: true,
          items: entries.map((entry, entryIndex) => ({
            id: `plan:${blockId}:${entryIndex}`,
            title: entry.content,
            status: planStatus(entry.status),
          })),
        };
      }
    }
  }
  return { present: false, items: [] };
}

/** Map one completed authority selection without scanning the transcript again. */
export function deriveTaskProgressFromNativePlan(
  input: TaskProgressBaseInput,
  nativePlan: NativePlanSelection,
): TaskProgressItem[] {
  if (nativePlan.present) return nativePlan.items;
  return workspaceTaskFallback(input).map((task) => ({
    id: `workspace:${task.id}`,
    title: task.title,
    status: workspaceStatus(task.status),
  }));
}

/** Select the newest native plan, or the existing scoped workspace-task fallback. */
export function deriveTaskProgress(input: WorkspaceTaskFallbackInput): TaskProgressItem[] {
  return deriveTaskProgressFromNativePlan(input, selectNativeExecutionPlan([input.messages]));
}
