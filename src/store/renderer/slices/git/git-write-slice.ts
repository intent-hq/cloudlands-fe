import { createAction, createAsyncAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  getItems,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type { MutationResult } from '$lib/client';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  GitWriteEntry,
  GitWriteOperation,
  GitWriteState,
  GitWriteWorkspaceState,
} from './git-write-types';

export const gitWriteRequested = createAsyncAction<
  [workspaceId: string, requestId: string, operation: GitWriteOperation],
  MutationResult
>('gitWrite/requested', 'gitWrite/request');
export const gitWriteStarted =
  createAction<[workspaceId: string, requestId: string]>('gitWrite/started');
export const gitWriteFinished =
  createAction<
    [workspaceId: string, requestId: string, result: MutationResult, operation: GitWriteOperation]
  >('gitWrite/finished');
export const cancelQueuedGitWrite =
  createAction<[workspaceId: string, requestId: string]>('gitWrite/cancelQueued');
export const gitWriteConsumerReleased = createAction<[workspaceId: string, consumerId: string]>(
  'gitWrite/consumerReleased',
);

const emptyWorkspace: GitWriteWorkspaceState = {
  operations: createCollection<GitWriteEntry, 'id'>('id'),
};
const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspace);
export const gitWriteReducer = createReducer<GitWriteState>({ byWorkspaceId: {} });

gitWriteReducer.with(gitWriteRequested, (state, { payload: [workspaceId, id, operation] }) => {
  const current = getWorkspaceState(state, workspaceId);
  if (getItem(current.operations, id)) return state;
  // Keep only a bounded completed history; pending requests are never evicted.
  const entries = getItems(current.operations);
  if (
    operation.kind === 'partialCommit' &&
    operation.groupKey &&
    entries.some(
      (entry) =>
        (entry.status === 'queued' || entry.status === 'running') &&
        entry.operation.kind === 'partialCommit' &&
        entry.operation.groupKey === operation.groupKey,
    )
  )
    return state;
  const completed = entries
    .filter((entry) => entry.status !== 'queued' && entry.status !== 'running')
    .slice(-31);
  const operations = createCollection<GitWriteEntry, 'id'>('id', [
    ...entries.filter((entry) => entry.status === 'queued' || entry.status === 'running'),
    ...completed,
    { id, operation, status: 'queued' },
  ]);
  return setWorkspaceState(state, workspaceId, { operations });
});
gitWriteReducer.with(gitWriteStarted, (state, { payload: [workspaceId, id] }) => {
  const current = getWorkspaceState(state, workspaceId);
  const entry = getItem(current.operations, id);
  if (entry?.status !== 'queued') return state;
  return setWorkspaceState(state, workspaceId, {
    operations: upsertItem(current.operations, { ...entry, status: 'running' }),
  });
});
gitWriteReducer.with(gitWriteFinished, (state, { payload: [workspaceId, id, result] }) => {
  const current = getWorkspaceState(state, workspaceId);
  const entry = getItem(current.operations, id);
  if (!entry || (entry.status !== 'queued' && entry.status !== 'running')) return state;
  return setWorkspaceState(state, workspaceId, {
    operations: upsertItem(current.operations, {
      ...entry,
      status: result.success ? 'succeeded' : 'failed',
      result,
    }),
  });
});
gitWriteReducer.with(cancelQueuedGitWrite, (state, { payload: [workspaceId, id] }) => {
  const current = getWorkspaceState(state, workspaceId);
  const entry = getItem(current.operations, id);
  if (entry?.status !== 'queued') return state;
  return setWorkspaceState(state, workspaceId, {
    operations: upsertItem(current.operations, { ...entry, status: 'cancelled' }),
  });
});
gitWriteReducer.with(gitWriteConsumerReleased, (state, { payload: [workspaceId, consumerId] }) => {
  const current = getWorkspaceState(state, workspaceId);
  const entries = getItems(current.operations);
  const retained = entries.filter((entry) => entry.operation.consumerId !== consumerId);
  if (retained.length === entries.length) return state;
  return setWorkspaceState(state, workspaceId, {
    operations: createCollection<GitWriteEntry, 'id'>('id', retained),
  });
});
gitWriteReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(state, workspaceId),
);
