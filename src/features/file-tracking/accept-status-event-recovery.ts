import { trackWorktreeSnapshotRead } from './worktree-read-lane';
import type { RendererRecoveryScope } from '$features/events/renderer-event-recovery';
import type { WorkspaceGitStatus } from '$features/accept-changes/types';
import { isPushedAcceptChangesStatus } from '$features/events/accept-changes-status-events';
import { acceptStatusRecoveryKey } from './worktree-recovery-keys';

export function registerAcceptStatusRecovery(
  scope: RendererRecoveryScope,
  workspaceId: string,
  owner: {
    isCurrent(): boolean;
    active: boolean;
    apply(status: WorkspaceGitStatus): undefined;
    invalidate(): void;
    retire(): undefined;
  },
) {
  return scope.registerResource({
    ...owner,
    key: acceptStatusRecoveryKey(workspaceId),
    workspaceId,
    eventTypes: ['git:*', 'pr:*', 'changes:git-status', 'file:*'],
    read: ({ request, lifetime }) =>
      trackWorktreeSnapshotRead(
        acceptStatusRecoveryKey(workspaceId),
        async () => {
          if (!lifetime.isCurrent()) throw new Error('Accept status authority expired');
          const status = await request('accept-changes.getStatus', { workspaceId });
          if (!isPushedAcceptChangesStatus(status))
            throw new Error('Invalid recovered accept status');
          return status;
        },
        'recovery',
      ),
  });
}
