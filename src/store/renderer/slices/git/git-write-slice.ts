import { createAction, createAsyncAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  getItems,
  removeItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type { MutationResult } from '$lib/client/client-types';
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
    [
      workspaceId: string,
      requestId: string,
      result: MutationResult,
      operation: GitWriteOperation,
      retired?: boolean,
    ]
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
    operation.kind === 'commit' &&
    operation.params.currentIndex &&
    entries.some(
      (entry) =>
        entry.operation.kind === 'commit' &&
        entry.operation.params.currentIndex &&
        (entry.status === 'queued' || entry.status === 'running' || entry.status === 'unknown'),
    )
  )
    return state;
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
  if (
    operation.admissionContext &&
    (operation.kind === 'stage' || operation.kind === 'unstage') &&
    entries.some(
      (entry) =>
        (entry.status === 'queued' || entry.status === 'running') &&
        'paths' in entry.operation &&
        entry.operation.paths.some((path) => operation.paths.includes(path)),
    )
  )
    return state;
  const completed = entries
    .filter(
      (entry) =>
        entry.status !== 'queued' && entry.status !== 'running' && entry.status !== 'unknown',
    )
    .slice(-31);
  const operations = createCollection<GitWriteEntry, 'id'>('id', [
    ...entries.filter(
      (entry) =>
        entry.status === 'queued' || entry.status === 'running' || entry.status === 'unknown',
    ),
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
gitWriteReducer.with(
  gitWriteFinished,
  (state, { payload: [workspaceId, id, result, operation, retired] }) => {
    const current = getWorkspaceState(state, workspaceId);
    const entry = getItem(current.operations, id);
    if (
      !entry ||
      entry.operation !== operation ||
      (entry.status !== 'queued' && entry.status !== 'running')
    )
      return state;
    const retainReceipt =
      operation.kind === 'commit' && operation.params.currentIndex && !!result.commitOutcome;
    const unknown = retainReceipt && result.commitOutcome?.state === 'unknown';
    if ((entry.consumerReleased || retired) && !retainReceipt) {
      const operations = removeItem(current.operations, id);
      return getItems(operations).length
        ? setWorkspaceState(state, workspaceId, { operations })
        : clearWorkspaceState(state, workspaceId);
    }
    return setWorkspaceState(state, workspaceId, {
      operations: upsertItem(current.operations, {
        ...entry,
        status: unknown ? 'unknown' : result.success ? 'succeeded' : 'failed',
        result,
      }),
    });
  },
);
gitWriteReducer.with(cancelQueuedGitWrite, (state, { payload: [workspaceId, id] }) => {
  const current = getWorkspaceState(state, workspaceId);
  const entry = getItem(current.operations, id);
  if (entry?.status !== 'queued') return state;
  return setWorkspaceState(state, workspaceId, {
    operations: upsertItem(current.operations, { ...entry, status: 'cancelled' }),
  });
});

/** Consumer departure retires presentation, never an already-owned transaction. */
function retireEntries(state: GitWriteState, workspaceId: string, consumerId?: string) {
  const current = getWorkspaceState(state, workspaceId);
  const entries = getItems(current.operations);
  let changed = false;
  const retained = entries.flatMap((entry) => {
    if (consumerId !== undefined && entry.operation.consumerId !== consumerId) return [entry];
    if (
      entry.status === 'queued' ||
      entry.status === 'running' ||
      entry.status === 'unknown' ||
      (entry.operation.kind === 'commit' &&
        entry.operation.params.currentIndex &&
        entry.result?.commitOutcome?.state === 'confirmed')
    ) {
      if (entry.consumerReleased) return [entry];
      changed = true;
      return [{ ...entry, consumerReleased: true }];
    }
    changed = true;
    return [];
  });
  if (changed && !retained.length) return clearWorkspaceState(state, workspaceId);
  return changed
    ? setWorkspaceState(state, workspaceId, {
        operations: createCollection<GitWriteEntry, 'id'>('id', retained),
      })
    : state;
}
gitWriteReducer.with(gitWriteConsumerReleased, (state, { payload: [workspaceId, consumerId] }) =>
  retireEntries(state, workspaceId, consumerId),
);
gitWriteReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) =>
  retireEntries(state, workspaceId),
);
