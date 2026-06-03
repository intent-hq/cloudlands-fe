/**
 * Selectors for the background-agent-executor slice.
 */

import { store } from "../../store";
import type { ExecutorInstanceState, ExecutorStatus } from "./background-agent-executor-types";
import { emptyExecutorState } from "./background-agent-executor-types";

/** Select executor state for a specific workspace + executor type */
export const selectExecutorState = store.createSelector(
  (state, workspaceId: string, executorType: string): ExecutorInstanceState => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType] ?? emptyExecutorState;
  }
);

/** Select executor status */
export const selectExecutorStatus = store.createSelector(
  (state, workspaceId: string, executorType: string): ExecutorStatus => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType]?.status ?? 'idle';
  }
);

/** Select executor result */
export const selectExecutorResult = store.createSelector(
  (state, workspaceId: string, executorType: string): string | null => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType]?.result ?? null;
  }
);

/** Select executor error */
export const selectExecutorError = store.createSelector(
  (state, workspaceId: string, executorType: string): string | null => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType]?.error ?? null;
  }
);

/** Select executor progress */
export const selectExecutorProgress = store.createSelector(
  (state, workspaceId: string, executorType: string): number => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    return ws?.executors[executorType]?.progress ?? 0;
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

/** Select whether executor is complete (success, error, or cancelled) */
export const selectExecutorIsComplete = store.createSelector(
  (state, workspaceId: string, executorType: string): boolean => {
    const ws = state.bgExecutor?.byWorkspaceId[workspaceId];
    const status = ws?.executors[executorType]?.status ?? 'idle';
    return status === 'success' || status === 'error' || status === 'cancelled';
  }
);

