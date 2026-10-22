import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';

export const selectGitWriteOperation = store.createSelector(
  (state, workspaceId: string, requestId: string) => {
    const operations = state.gitWrite.byWorkspaceId[workspaceId]?.operations;
    return operations ? getItem(operations, requestId) : undefined;
  },
);

const selectGitWriteOperations = store.createSelector((state, workspaceId: string) => {
  const operations = state.gitWrite.byWorkspaceId[workspaceId]?.operations;
  return operations ? getItems(operations) : [];
});

export const selectGitWritePending = store.createSelector((state, workspaceId: string) =>
  selectGitWriteOperations
    .select(state, workspaceId)
    .some((entry) => entry.status === 'queued' || entry.status === 'running'),
);

export const selectGitGroupCommits = store.createSelector((state, workspaceId: string) =>
  selectGitWriteOperations
    .select(state, workspaceId)
    .filter(
      (entry) =>
        entry.operation.kind === 'partialCommit' &&
        (entry.status === 'queued' || entry.status === 'running'),
    ),
);
