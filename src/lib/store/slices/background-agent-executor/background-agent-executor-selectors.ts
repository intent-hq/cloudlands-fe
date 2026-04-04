/**
 * Selectors for the background-agent-executor slice.
 */

import { createSelector } from "../../utils/create-selector";
import type { ExecutorInstanceState, ExecutorStatus } from "./background-agent-executor-types";
import { emptyExecutorState } from "./background-agent-executor-types";

/** Select executor state for a specific workspace + executor type */
export const selectExecutorState = createSelector(
  (state, workspaceId: string, executorType: string): ExecutorInstanceState => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType] ?? emptyExecutorState;
  }
);

/** Select executor status */
export const selectExecutorStatus = createSelector(
  (state, workspaceId: string, executorType: string): ExecutorStatus => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType]?.status ?? 'idle';
  }
);

/** Select executor result */
export const selectExecutorResult = createSelector(
  (state, workspaceId: string, executorType: string): string | null => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType]?.result ?? null;
  }
);

/** Select executor error */
export const selectExecutorError = createSelector(
  (state, workspaceId: string, executorType: string): string | null => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType]?.error ?? null;
  }
);

/** Select executor progress */
export const selectExecutorProgress = createSelector(
  (state, workspaceId: string, executorType: string): number => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType]?.progress ?? 0;
  }
);

/** Select executor agentId */
export const selectExecutorAgentId = createSelector(
  (state, workspaceId: string, executorType: string): string | null => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType]?.agentId ?? null;
  }
);

/** Select whether executor is running (initializing or running) */
export const selectExecutorIsRunning = createSelector(
  (state, workspaceId: string, executorType: string): boolean => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    const status = ws?.executors[executorType]?.status ?? 'idle';
    return status === 'initializing' || status === 'running';
  }
);

/** Select whether executor is complete (success, error, or cancelled) */
export const selectExecutorIsComplete = createSelector(
  (state, workspaceId: string, executorType: string): boolean => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    const status = ws?.executors[executorType]?.status ?? 'idle';
    return status === 'success' || status === 'error' || status === 'cancelled';
  }
);

