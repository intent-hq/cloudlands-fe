import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { AgentWorkersState } from '$features/agent-workers/types';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';

export interface WorkerOperation {
  pending: boolean;
  message?: string;
  error?: boolean;
}
interface AgentWorkersEntry extends AgentWorkersState {
  workspaceId: string;
  operations: Record<string, WorkerOperation>;
}
export interface AgentWorkersSliceState {
  byKey: Record<string, AgentWorkersEntry>;
}
/** Store key for one agent's worker view. */
export const agentWorkersKey = (workspaceId: string, agentId: string) =>
  `${workspaceId}\u0000${agentId}`;
export const emptyAgentWorkers: AgentWorkersState & {
  operations: Record<string, WorkerOperation>;
} = { status: 'loading', operations: {} };

export const agentWorkersSubscribeRequested =
  createAction<[workspaceId: string, agentId: string]>('agentWorkers/subscribe');
export const agentWorkersUnsubscribeRequested = createAction<
  [workspaceId: string, agentId: string]
>('agentWorkers/unsubscribe');
export const agentWorkersRetryRequested =
  createAction<[workspaceId: string, agentId: string]>('agentWorkers/retry');
export const agentWorkersUpdated =
  createAction<[workspaceId: string, agentId: string, state: AgentWorkersState]>(
    'agentWorkers/updated',
  );
/** The last lease was released: forget the view so no unobserved rows linger (§5.5b). */
export const agentWorkersRemoved =
  createAction<[workspaceId: string, agentId: string]>('agentWorkers/removed');
export const agentWorkerStopRequested =
  createAction<[workspaceId: string, agentId: string, asyncTaskId: string]>('agentWorkers/stop');
export const agentWorkerOperationUpdated =
  createAction<
    [workspaceId: string, agentId: string, asyncTaskId: string, operation: WorkerOperation]
  >('agentWorkers/operation');

export const agentWorkersReducer = createReducer<AgentWorkersSliceState>({ byKey: {} });
agentWorkersReducer.with(
  agentWorkersUpdated,
  (state, { payload: [workspaceId, agentId, next] }) => {
    const key = agentWorkersKey(workspaceId, agentId);
    const previous = state.byKey[key];
    const live = new Set(next.snapshot?.workers.map((row) => row.identity.asyncTaskId) ?? []);
    // An operation outlives a snapshot only while its worker is still listed.
    const operations = Object.fromEntries(
      Object.entries(previous?.operations ?? {}).filter(([id]) => live.has(id)),
    );
    return {
      ...state,
      byKey: { ...state.byKey, [key]: { ...next, workspaceId, operations } },
    };
  },
);
agentWorkersReducer.with(
  agentWorkerOperationUpdated,
  (state, { payload: [workspaceId, agentId, asyncTaskId, operation] }) => {
    const key = agentWorkersKey(workspaceId, agentId);
    const entry = state.byKey[key];
    if (!entry) return state;
    return {
      ...state,
      byKey: {
        ...state.byKey,
        [key]: { ...entry, operations: { ...entry.operations, [asyncTaskId]: operation } },
      },
    };
  },
);
agentWorkersReducer.with(agentWorkersRemoved, (state, { payload: [workspaceId, agentId] }) => {
  const key = agentWorkersKey(workspaceId, agentId);
  if (!state.byKey[key]) return state;
  const { [key]: _removed, ...byKey } = state.byKey;
  return { ...state, byKey };
});
agentWorkersReducer.with(removeWorkspaceEntity, (state, { payload: [workspaceId] }) => ({
  ...state,
  byKey: Object.fromEntries(
    Object.entries(state.byKey).filter(([, entry]) => entry.workspaceId !== workspaceId),
  ),
}));
