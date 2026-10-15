import { store } from '../index';
import {
  getGitWriteOperation,
  getGitWriteOperations,
  getGitWritePending,
} from '../../../../../src/store/renderer/slices/git/git-write-projections';
import {
  selectWorkspaceActionContext,
  selectWorkspaceById,
} from '../workspace/workspace-selectors';
import { selectAdmittedWorkspaceReadContext } from '../workspace-lifecycle/workspace-lifecycle-selectors';
export const selectGitWriteOperation = store.createSelector(getGitWriteOperation);
export const selectGitWritePending = store.createSelector(getGitWritePending);
export const selectGitWriteContext = store.createSelector((state, workspaceId: string) =>
  selectAdmittedWorkspaceReadContext.select(state, workspaceId) &&
  selectWorkspaceById.select(state, workspaceId)
    ? selectWorkspaceActionContext.select(state, workspaceId)
    : null,
);
export const selectGitWriteFileState = store.createSelector(
  (state, workspaceId: string, path: string, staged: boolean) => {
    const context = selectGitWriteContext.select(state, workspaceId);
    const locks = state.agentLock.byWorkspaceId[workspaceId];
    const entries = getGitWriteOperations(state, workspaceId).filter(
      (entry) => 'paths' in entry.operation && entry.operation.paths.includes(path),
    );
    const latest = entries.at(-1);
    return {
      context,
      present: !!state.git.byWorkspaceId[workspaceId]?.status?.files.some(
        (file) => file.path === path && file.staged === staged,
      ),
      ready: !!context && locks?.authorityContext === context,
      locked: !!locks?.lockedFilePaths[path],
      pending: getGitWritePending(state, workspaceId),
      error:
        !latest?.consumerReleased &&
        latest?.operation.admissionContext === context &&
        latest.status === 'failed'
          ? latest.result?.error
          : undefined,
    };
  },
);

export const selectGitWriteConsumerError = store.createSelector(
  (state, workspaceId: string, consumerId: string) => {
    const context = selectGitWriteContext.select(state, workspaceId);
    const latest = getGitWriteOperations(state, workspaceId)
      .filter(
        (entry) =>
          entry.operation.consumerId === consumerId && entry.operation.admissionContext === context,
      )
      .at(-1);
    return !latest?.consumerReleased && latest?.status === 'failed'
      ? latest.result?.error
      : undefined;
  },
);
