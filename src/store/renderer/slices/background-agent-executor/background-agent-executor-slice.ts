/**
 * Background Agent Executor - Redux Slice
 *
 * Manages state for background agent executions (commit messages, PR descriptions,
 * code reviews, walkthroughs). Each executor instance is workspace-scoped and keyed
 * by executor type.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import type {
  BackgroundAgentExecutorState,
  ExecutorInstanceState,
  ExecutorStatus,
  AgentExecutorContext,
  BackgroundAgentExecutorWorkspaceState,
} from './background-agent-executor-types';
import { emptyExecutorState, emptyWorkspaceState } from './background-agent-executor-types';

// ============================================================================
// Workspace-scoped helpers
// ============================================================================

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceState);

function getExecutor(
  state: BackgroundAgentExecutorState,
  workspaceId: string,
  executorType: string,
): ExecutorInstanceState {
  const ws = getWorkspaceState(state, workspaceId);
  return ws.executors[executorType] ?? emptyExecutorState;
}

function setExecutor(
  state: BackgroundAgentExecutorState,
  workspaceId: string,
  executorType: string,
  executor: ExecutorInstanceState,
): BackgroundAgentExecutorState {
  const ws = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    executors: { ...ws.executors, [executorType]: executor },
  });
}

// ============================================================================
// Saga trigger actions (dispatched by consumers, handled by sagas)
// ============================================================================

export const executeBackgroundAgent =
  createAction<[workspaceId: string, executorType: string, context?: AgentExecutorContext]>(
    'bgExecutor/execute',
  );

export const cancelExecution =
  createAction<[workspaceId: string, executorType: string]>('bgExecutor/cancel');

export const reconnectAgent =
  createAction<
    [
      workspaceId: string,
      executorType: string,
      agentId: string,
      savedState?: { status: ExecutorStatus; result: string | null },
    ]
  >('bgExecutor/reconnect');

// ============================================================================
// Reducer actions (pure state updates, dispatched by sagas)
// ============================================================================

export const setExecutorState = createAction<
  [workspaceId: string, executorType: string, updates: Partial<ExecutorInstanceState>]
>('bgExecutor/setExecutorState');

export const resetExecutor = createAction<[workspaceId: string, executorType: string]>(
  'bgExecutor/resetExecutor',
);

export const clearWorkspaceExecutors = createAction<[workspaceId: string]>(
  'bgExecutor/clearWorkspaceExecutors',
);

const hydrateBgExecutorState =
  createAction<[workspaceId: string, workspaceState: BackgroundAgentExecutorWorkspaceState]>(
    'bgExecutor/hydrate',
  );

// ============================================================================
// Initial state
// ============================================================================

export const initialState: BackgroundAgentExecutorState = {
  byWorkspaceId: {},
};

// ============================================================================
// Reducer
// ============================================================================

export const backgroundAgentExecutorReducer =
  createReducer<BackgroundAgentExecutorState>(initialState);
backgroundAgentExecutorReducer.with(
  setExecutorState,
  (state, { payload: [workspaceId, executorType, updates] }) => {
    const current = getExecutor(state, workspaceId, executorType);
    return setExecutor(state, workspaceId, executorType, { ...current, ...updates });
  },
);
backgroundAgentExecutorReducer.with(
  resetExecutor,
  (state, { payload: [workspaceId, executorType] }) => {
    return setExecutor(state, workspaceId, executorType, { ...emptyExecutorState });
  },
);
backgroundAgentExecutorReducer.with(
  clearWorkspaceExecutors,
  (state, { payload: [workspaceId] }) => {
    return clearWorkspaceState(state, workspaceId);
  },
);
backgroundAgentExecutorReducer.with(
  hydrateBgExecutorState,
  (state, { payload: [workspaceId, workspaceState] }) => {
    return setWorkspaceState(state, workspaceId, workspaceState);
  },
);

// Re-export types for convenience
export type {
  ExecutorStatus,
  AgentExecutorContext,
  ExecutorInstanceState,
} from './background-agent-executor-types';
