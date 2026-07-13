/**
 * Selectors for the background-agent-executor slice.
 */

import { store } from "../../store";
import type { ExecutorInstanceState } from "./background-agent-executor-types";
import { emptyExecutorState } from "./background-agent-executor-types";

/** Select executor state for a specific workspace + executor type */
export const selectExecutorState = store.createSelector(
  (state, workspaceId: string, executorType: string): ExecutorInstanceState => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType] ?? emptyExecutorState;
  }
);

/** Select executor agentId */
export const selectExecutorAgentId = store.createSelector(
  (state, workspaceId: string, executorType: string): string | null => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType]?.agentId ?? null;
  }
);

/** Select whether executor is running (initializing or running) */
export const selectExecutorIsRunning = store.createSelector(
  (state, workspaceId: string, executorType: string): boolean => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    const status = ws?.executors[executorType]?.status ?? 'idle';
    return status === 'initializing' || status === 'running';
  }
);



