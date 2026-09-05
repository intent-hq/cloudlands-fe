import type { AgentMessage, AgentSession, WorkspaceTask } from '$shared/types';
import type { TranscriptSnapshotMeta } from '$store/renderer/slices/chat-state/chat-state-types';
import {
  deriveTaskProgressFromNativePlan,
  selectNativeExecutionPlan,
  type TaskProgressItem,
} from './workspace-task-fallback';

export interface AgentTaskProgressInput {
  agentId: string;
  initialized: boolean;
  tasks: readonly WorkspaceTask[];
  session: AgentSession;
  historyMessages: readonly AgentMessage[];
  liveMessages: readonly AgentMessage[];
  snapshotMeta: TranscriptSnapshotMeta | undefined;
}

type DeriveAgentTaskProgress = (input: AgentTaskProgressInput) => TaskProgressItem[] | undefined;

interface CacheEntry {
  input: AgentTaskProgressInput;
  result: TaskProgressItem[] | undefined;
}

function hasSameInputs(previous: AgentTaskProgressInput, next: AgentTaskProgressInput): boolean {
  return (
    previous.initialized === next.initialized &&
    previous.tasks === next.tasks &&
    previous.session === next.session &&
    previous.historyMessages === next.historyMessages &&
    previous.liveMessages === next.liveMessages &&
    previous.snapshotMeta === next.snapshotMeta
  );
}

/** Derive one row from ordered transcript segments with one reverse plan scan. */
export function deriveAgentTaskProgress(
  input: AgentTaskProgressInput,
): TaskProgressItem[] | undefined {
  const nativePlan = selectNativeExecutionPlan([input.historyMessages, input.liveMessages]);
  if (!nativePlan.present && !input.snapshotMeta) return undefined;
  return deriveTaskProgressFromNativePlan(input, nativePlan);
}

/** Keep task derivations only while every input reference for a watched agent stays exact. */
export function createAgentTaskProgressDeriver(
  derive: DeriveAgentTaskProgress = deriveAgentTaskProgress,
): (inputs: readonly AgentTaskProgressInput[]) => Record<string, TaskProgressItem[]> {
  const cache = new Map<string, CacheEntry>();

  return (inputs) => {
    const watchedAgentIds = new Set<string>();
    const progress: Record<string, TaskProgressItem[]> = {};

    for (const input of inputs) {
      watchedAgentIds.add(input.agentId);
      const cached = cache.get(input.agentId);
      const cacheHit = cached ? hasSameInputs(cached.input, input) : false;
      let result: TaskProgressItem[] | undefined;
      if (cacheHit && cached) {
        result = cached.result;
      } else {
        result = derive(input);
        cache.set(input.agentId, { input, result });
      }
      if (result !== undefined) progress[input.agentId] = result;
    }

    for (const agentId of cache.keys()) {
      if (!watchedAgentIds.has(agentId)) cache.delete(agentId);
    }
    return progress;
  };
}
