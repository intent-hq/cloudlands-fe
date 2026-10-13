import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import {
  rendererEventRecovery,
  type RendererRecoveryScope,
} from '$features/events/renderer-event-recovery';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  selectWorkspaceParticipationContext,
  selectWorkspaceListLoadedForBackend,
} from '$store/renderer/slices/workspace/workspace-selectors';
import type { WorktreeRecoveryStore } from './worktree-snapshots-recovery';

/** Capture root incarnation independently of mutable branch/history metadata. */
export function captureGitAuthority(
  scope: RendererRecoveryScope,
  store: WorktreeRecoveryStore,
  workspaceId: string,
  gitRootId?: string,
) {
  const state = store.getState();
  const principal = selectPrincipalActionContext.select(state);
  const participation = selectWorkspaceParticipationContext.select(state, workspaceId);
  const backend = state.connections.windowBackendId;
  const deleted = state.workspace.deletionTokens[workspaceId];
  const roots = state.gitRoots.byWorkspaceId[workspaceId]?.gitRoots;
  const root = gitRootId && roots ? getItem(roots, gitRootId) : undefined;
  let retired = false;
  return () => {
    const next = store.getState();
    const nextRoots = next.gitRoots.byWorkspaceId[workspaceId]?.gitRoots;
    const nextRoot = gitRootId && nextRoots ? getItem(nextRoots, gitRootId) : undefined;
    const current =
      !retired &&
      scope.isCurrent() &&
      !!principal &&
      !!participation &&
      selectPrincipalActionContext.select(next) === principal &&
      next.connections.windowBackendId === backend &&
      next.workspace.deletionTokens[workspaceId] === deleted &&
      selectWorkspaceListLoadedForBackend.select(next, backend) &&
      selectWorkspaceParticipationContext.select(next, workspaceId) === participation &&
      (!gitRootId ||
        (!!root &&
          !!nextRoot &&
          nextRoot.path === root.path &&
          nextRoot.createdAt === root.createdAt));
    if (!current) retired = true;
    return current;
  };
}

export function gitEventMatchesRoot(
  notification: import('$shared/event-recovery/session').RecoveryNotification,
  rootId?: string,
) {
  const event = (
    notification.params as {
      event?: { type?: string; data?: { gitRootId?: string; gitRoot?: { id: string } } };
    }
  )?.event;
  const id = event?.data?.gitRootId ?? event?.data?.gitRoot?.id;
  return (id || undefined) === rootId;
}

/** Only canonical denial/deletion replies retire retained protected projections. */
export function gitReadAuthorityDenied(error: unknown): boolean {
  const value = error as { rpcCode?: unknown; data?: { code?: unknown } } | null;
  return (
    value?.rpcCode === -32003 ||
    value?.rpcCode === -32001 ||
    (value?.rpcCode === -32602 && value.data?.code === 'not-found')
  );
}

/** Domain classification with a retirement callback captured before any asynchronous read. */
export function captureGitReadRetirement(key: string): (error: unknown) => void {
  const retire = rendererEventRecovery.captureRetirement(key);
  return (error) => {
    if (gitReadAuthorityDenied(error)) retire(error);
  };
}
