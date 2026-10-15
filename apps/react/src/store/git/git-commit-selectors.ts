import { store } from '../index';
import { getPrincipalSnapshot } from '../../../../../src/store/renderer/slices/principal/principal-projections';
import {
  getGitCurrentIndexCommit,
  getGitWritePending,
  getGitWriteOperations,
} from '../../../../../src/store/renderer/slices/git/git-write-projections';
import { selectGitWriteContext } from './git-write-selectors';
import { selectWorkspaceById } from '../workspace/workspace-selectors';

export const selectGitCommitAuthorityKey = store.createSelector((state, workspaceId: string) => {
  const principal = getPrincipalSnapshot(state);
  const workspace = selectWorkspaceById.select(state, workspaceId);
  const root = workspace?.worktreePath || workspace?.repositoryPath;
  return principal && root && selectGitWriteContext.select(state, workspaceId)
    ? JSON.stringify([
        state.connections.windowBackendId,
        principal.principal.id,
        principal.principal.hostMembershipRevision,
        workspaceId,
        root,
      ])
    : null;
});
export const selectGitCommitState = store.createSelector((state, workspaceId: string) => {
  const context = selectGitWriteContext.select(state, workspaceId);
  const authorityKey = selectGitCommitAuthorityKey.select(state, workspaceId);
  const receipt = getGitCurrentIndexCommit(state, workspaceId, authorityKey);
  const latest =
    receipt?.operation.kind === 'commit' && receipt.operation.authorityKey === authorityKey
      ? receipt
      : undefined;
  const files = state.git.byWorkspaceId[workspaceId]?.status?.files ?? [];
  const paths = [...new Set(files.filter((file) => file.staged).map((file) => file.path))].sort();
  const locks = state.agentLock.byWorkspaceId[workspaceId];
  return {
    context,
    authorityKey,
    paths,
    latest,
    message: state.changes.byWorkspaceId[workspaceId]?.acceptChanges.commitMessage ?? '',
    ready:
      !!context &&
      locks?.authorityContext === context &&
      !!state.git.byWorkspaceId[workspaceId]?.status &&
      !state.git.byWorkspaceId[workspaceId]?.loading,
    locked: paths.some((path) => !!locks?.lockedFilePaths[path]),
    pending: getGitWritePending(state, workspaceId),
    commitBlocked: getGitWriteOperations(state, workspaceId).some(
      (entry) =>
        entry.operation.kind === 'commit' &&
        entry.operation.params.currentIndex &&
        entry.status === 'unknown',
    ),
  };
});
