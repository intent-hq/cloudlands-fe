import { createAction, createAsyncAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  upsertItem,
  createCollection,
  getItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type {
  AcceptAction,
  AcceptChangesResult,
  PrepareAcceptResponse,
  WorkspaceGitStatus,
} from '$features/accept-changes/types';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { acceptChangesConsumerMounted, acceptChangesConsumerUnmounted } from '../git/git-slice';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  AcceptOperation,
  AcceptWorkflowState,
  AcceptWorkflowWorkspaceState,
  ExecuteAcceptOptions,
  MergePRAcceptOptions,
  MergePRWorkflowOptions,
  MergeToTrunkOptions,
  UndoAcceptOptions,
  MergeOptions,
} from './accept-workflow-types';

export const prepareAcceptRequested = createAsyncAction<
  [workspaceId: string, action: AcceptAction, files?: string[]],
  PrepareAcceptResponse
>('acceptWorkflow/prepareRequested', 'acceptWorkflow/prepare');
export const executeAcceptRequested = createAsyncAction<
  [workspaceId: string, action: AcceptAction, options?: ExecuteAcceptOptions],
  AcceptChangesResult
>('acceptWorkflow/executeRequested', 'acceptWorkflow/execute');
export const mergePRAcceptRequested = createAsyncAction<
  [workspaceId: string, prNumber: number, options?: MergePRAcceptOptions],
  AcceptChangesResult
>('acceptWorkflow/mergePRRequested', 'acceptWorkflow/mergePR');
export const addAcceptRemoteRequested = createAsyncAction<
  [workspaceId: string, remoteUrl: string],
  WorkspaceGitStatus
>('acceptWorkflow/addRemoteRequested', 'acceptWorkflow/addRemote');
export const resetAcceptToTrunkRequested = createAsyncAction<
  [workspaceId: string],
  AcceptChangesResult
>('acceptWorkflow/resetToTrunkRequested', 'acceptWorkflow/resetToTrunk');

export const mergeToTrunkRequested = createAction<
  [workspaceId: string, options: MergeToTrunkOptions]
>('acceptWorkflow/mergeToTrunkRequested');
export const mergePRWorkflowRequested = createAction<
  [workspaceId: string, options: MergePRWorkflowOptions]
>('acceptWorkflow/mergePRWorkflowRequested');
export const resetAndContinueRequested = createAction<[workspaceId: string]>(
  'acceptWorkflow/resetAndContinueRequested',
);
export const archiveAndStartRequested = createAction<[workspaceId: string]>(
  'acceptWorkflow/archiveAndStartRequested',
);
export const undoAcceptRequested = createAction<[workspaceId: string, options: UndoAcceptOptions]>(
  'acceptWorkflow/undoRequested',
);
export const setMergeDrawerOpen = createAction<[workspaceId: string, open: boolean]>(
  'acceptWorkflow/setMergeDrawerOpen',
);
export const setMergeOptions = createAction<[workspaceId: string, options: Partial<MergeOptions>]>(
  'acceptWorkflow/setMergeOptions',
);
export const acceptOperationStarted = createAction<
  [workspaceId: string, operation: AcceptOperation]
>('acceptWorkflow/operationStarted');
export const acceptOperationFinished = createAction<
  [workspaceId: string, operation: AcceptOperation]
>('acceptWorkflow/operationFinished');

export const emptyAcceptWorkflowWorkspace: AcceptWorkflowWorkspaceState = {
  operations: createCollection<AcceptOperation, 'kind'>('kind'),
  mergeDrawerOpen: false,
  mergeOptions: {},
  observerRequested: false,
  consumerCount: 0,
};
const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyAcceptWorkflowWorkspace,
);
export const acceptWorkflowReducer = createReducer<AcceptWorkflowState>({ byWorkspaceId: {} });

acceptWorkflowReducer.with(acceptChangesConsumerMounted, (state, { payload: [workspaceId] }) => {
  const current = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...current,
    observerRequested: true,
    consumerCount: current.consumerCount + 1,
  });
});
acceptWorkflowReducer.with(acceptChangesConsumerUnmounted, (state, { payload: [workspaceId] }) => {
  const current = getWorkspaceState(state, workspaceId);
  if (current.consumerCount === 0) return state;
  return setWorkspaceState(state, workspaceId, {
    ...current,
    consumerCount: current.consumerCount - 1,
  });
});
acceptWorkflowReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(state, workspaceId),
);

acceptWorkflowReducer.with(setMergeOptions, (state, { payload: [workspaceId, options] }) => {
  const current = getWorkspaceState(state, workspaceId);
  if (
    Object.entries(options).every(
      ([key, value]) => current.mergeOptions[key as keyof MergeOptions] === value,
    )
  )
    return state;
  return setWorkspaceState(state, workspaceId, {
    ...current,
    mergeOptions: { ...current.mergeOptions, ...options },
  });
});

acceptWorkflowReducer.with(
  setMergeDrawerOpen,
  (state, { payload: [workspaceId, mergeDrawerOpen] }) => {
    const current = getWorkspaceState(state, workspaceId);
    if (current.mergeDrawerOpen === mergeDrawerOpen) return state;
    return setWorkspaceState(state, workspaceId, { ...current, mergeDrawerOpen });
  },
);
acceptWorkflowReducer.with(
  acceptOperationStarted,
  (state, { payload: [workspaceId, operation] }) => {
    const current = getWorkspaceState(state, workspaceId);
    const operations = upsertItem(current.operations, operation);
    return operations === current.operations
      ? state
      : setWorkspaceState(state, workspaceId, { ...current, operations });
  },
);
acceptWorkflowReducer.with(
  acceptOperationFinished,
  (state, { payload: [workspaceId, operation] }) => {
    const current = getWorkspaceState(state, workspaceId);
    if (getItem(current.operations, operation.kind)?.requestId !== operation.requestId)
      return state;
    const operations = upsertItem(current.operations, operation);
    return operations === current.operations
      ? state
      : setWorkspaceState(state, workspaceId, { ...current, operations });
  },
);
