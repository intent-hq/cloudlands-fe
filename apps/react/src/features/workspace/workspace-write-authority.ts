import { getPrincipalSnapshot } from '../../../../../src/store/renderer/slices/principal/principal-projections';
import { store } from '@/store';
import { selectGitWriteContext } from '@/store/git/git-write-selectors';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';

/** Mutation admission is captured before queueing, independently of the read consumer. */
export function captureWorkspaceWriteAuthority(
  workspaceId: string,
  admissionContext: string | undefined,
) {
  const context = selectGitWriteContext.select(store.state, workspaceId);
  const snapshot = getPrincipalSnapshot(store.state);
  const backendId = store.state.connections.windowBackendId;
  const workspace = selectWorkspaceById.select(store.state, workspaceId);
  const root = workspace?.worktreePath || workspace?.repositoryPath;
  const canPublish = () => {
    const current = getPrincipalSnapshot(store.state);
    const currentWorkspace = selectWorkspaceById.select(store.state, workspaceId);
    return (
      !!context &&
      !!root &&
      admissionContext === context &&
      selectGitWriteContext.select(store.state, workspaceId) !== null &&
      store.state.connections.windowBackendId === backendId &&
      current?.principal.id === snapshot?.principal.id &&
      current?.principal.hostMembershipRevision === snapshot?.principal.hostMembershipRevision &&
      (currentWorkspace?.worktreePath || currentWorkspace?.repositoryPath) === root
    );
  };
  return {
    canPublish,
    canDispatch: () =>
      canPublish() && selectGitWriteContext.select(store.state, workspaceId) === context,
  };
}
