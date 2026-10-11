import { call, put, type SagaGenerator } from 'typed-redux-saga';
import type { Workspace } from '$shared/types';
import {
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
  refreshWorkspaceMembershipRequested,
} from '../../workspace/workspace-slice';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
export function createWorkspaceMembershipSaga({
  principalContextEffect,
  workspaceByIdEffect,
  getWorkspace,
  runRead,
}: {
  principalContextEffect: () => SagaGenerator<string | null>;
  workspaceByIdEffect: (id: string) => SagaGenerator<Workspace | undefined>;
  getWorkspace: (id: string) => Promise<Workspace | null>;
  runRead: (id: string, read: (id: string) => SagaGenerator<void>) => SagaGenerator<void>;
}) {
  /**
   * Targeted `workspace.get` (§5.1) that merges membership rights and summary
   * onto the stored row. Invite create / revoke deltas carry no counts, and
   * the archive teardown's per-member `memberCount` frames say nothing about
   * the invites it revoked, so the row is re-derived from the daemon instead
   * of patched client-side. Never a per-workspace fan-out: one read per
   * delta-bearing workspace, coalesced by the watcher.
   */
  function* refreshMembershipSummary(
    workspaceId: string,
    isLatest: () => boolean,
  ): SagaGenerator<void> {
    const context = yield* principalContextEffect();
    const previous = yield* workspaceByIdEffect(workspaceId);
    const workspace: Workspace | null = yield* call(getWorkspace, workspaceId);
    if (!workspace || !isLatest() || context !== (yield* principalContextEffect())) return;
    const current = yield* workspaceByIdEffect(workspaceId);
    // Another authoritative hydration must not be overwritten by an older read.
    if (current?.canManage !== previous?.canManage || current?.myRole !== previous?.myRole) return;
    const changes: Partial<Workspace> = {};
    if (context !== null) {
      if (typeof workspace.canManage === 'boolean') changes.canManage = workspace.canManage;
      if (workspace.myRole === 'owner' || workspace.myRole === 'collaborator') {
        changes.myRole = workspace.myRole;
      }
    }
    if (typeof workspace.memberCount === 'number' && Number.isFinite(workspace.memberCount)) {
      changes.memberCount = workspace.memberCount;
    }
    if (
      typeof workspace.openInviteCount === 'number' &&
      Number.isFinite(workspace.openInviteCount)
    ) {
      changes.openInviteCount = workspace.openInviteCount;
    }
    if (Object.keys(changes).length === 0) return;
    yield* put(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, changes)]));
  }

  function* membershipSummaryWorker(
    revisions: Map<string, symbol>,
    action: ReturnType<typeof refreshWorkspaceMembershipRequested>,
  ) {
    const workspaceId = action.payload[0];
    const revision = revisions.get(workspaceId);
    const isLatest = () => revisions.get(workspaceId) === revision;
    try {
      yield* runRead(workspaceId, function* (id) {
        yield* refreshMembershipSummary(id, isLatest);
      });
    } finally {
      if (isLatest()) revisions.delete(workspaceId);
    }
  }

  return function* workspaceMembershipSaga() {
    const membershipRevisions = new Map<string, symbol>();
    yield* takeSingleFlightInContext(
      refreshWorkspaceMembershipRequested,
      (action) => {
        const workspaceId = action.payload[0];
        membershipRevisions.set(workspaceId, Symbol());
        return workspaceId;
      },
      membershipSummaryWorker,
      membershipRevisions,
    );
  };
}
