import { store } from '../../store';
import {
  getGitWriteOperation,
  getGitWriteOperations,
  getGitWritePending,
} from './git-write-projections';
export const selectGitWriteOperation = store.createSelector(getGitWriteOperation);
const selectGitWriteOperations = store.createSelector(getGitWriteOperations);
export const selectGitWritePending = store.createSelector(getGitWritePending);

export const selectGitGroupCommits = store.createSelector((state, workspaceId: string) =>
  selectGitWriteOperations
    .select(state, workspaceId)
    .filter(
      (entry) =>
        entry.operation.kind === 'partialCommit' &&
        (entry.status === 'queued' || entry.status === 'running'),
    ),
);
