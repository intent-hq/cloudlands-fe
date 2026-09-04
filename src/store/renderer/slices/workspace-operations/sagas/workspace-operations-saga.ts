import { buffers, channel, type Channel } from 'redux-saga';
import {
  all,
  call,
  cancelled,
  delay,
  fork,
  put,
  race,
  spawn,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { invoke } from '$lib/electron-bridge';
import { getProposalId } from '$lib/components/chat/proposals/proposal-id';
import { withToastCountdown } from '$lib/components/ui/toast';
import { getActiveWorkNames, type ActiveWorkNames } from '$lib/utils/delete-warning-utils';
import { createLogger } from '$lib/utils/client-logger';
import type { WorkspaceProposalApplyPayload } from '$shared/app-workspace-operations';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { m } from '$shared/paraglide/messages.js';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { isBulkOperationProposal, isWorkspaceCreateProposal } from '$shared/types/proposal';
import { navigateAwayIfViewing } from '$features/workspace/navigate-away-if-viewing';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { removeRepo } from '../../known-repos/known-repos-slice';
import { openWorkspaceTab } from '../../tab-state/tab-state-slice';
import {
  proposalApplyStarted,
  proposalApplySucceeded,
  proposalFailed,
} from '../../proposal-lifecycle/proposal-lifecycle-slice';
import { selectProposalLifecycleEntry } from '../../proposal-lifecycle/proposal-lifecycle-selectors';
import {
  bulkUpdateWorkspaceEntities,
  clearWorkspacePendingDeletion,
  markWorkspacePendingDeletion,
  removeWorkspaceEntity,
  setWorkspaceEntity,
  updateWorkspaceEntity,
} from '../../workspace/workspace-slice';
import { selectWorkspaceById, selectWorkspaceItems } from '../../workspace/workspace-selectors';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import {
  applyWorkspaceProposal,
  bulkArchiveActiveWorkComputed,
  closeArchiveWarning,
  closeBulkArchiveConfirm,
  closeBulkDeleteArchivedConfirm,
  closeBulkDeleteWarningConfirm,
  closeDeleteWarning,
  closeRemoveRepoConfirm,
  confirmArchiveWorkspace,
  confirmBulkArchive,
  confirmBulkDeleteArchived,
  confirmBulkDeleteWarning,
  confirmDeleteWorkspace,
  confirmRemoveRepo,
  openBulkDeleteWarningConfirm,
  openArchiveWarning,
  openBulkArchiveConfirm,
  openDeleteWarning,
  requestArchiveWorkspace,
  requestDeleteWorkspace,
  requestUnarchiveWorkspace,
} from '../workspace-operations-slice';
import {
  selectBulkArchiveComputeToken,
  selectPendingArchiveWorkspaceId,
  selectPendingBulkDeleteRepoKey,
  selectPendingBulkRepoKey,
  selectPendingDeleteWorkspaceId,
  selectPendingRemoveRepoPath,
} from '../workspace-operations-selectors';
import { buildCreateWorkspaceRequestFromProposal } from '../utils/workspace-create-proposal';

const logger = createLogger('WorkspaceOperationsSaga');
export const WORKSPACE_OPERATION_UNDO_DURATION_MS = 15_000;
/**
 * How long the pendingDeletions tombstone outlives a successful workspace
 * delete. Stale workspace.get/workspace.list responses (background polls,
 * bulk refetches) computed before the daemon committed the delete can land
 * after it; the reducers reject tombstoned ids until this grace window ends.
 */
export const WORKSPACE_DELETION_TOMBSTONE_TTL_MS = 60_000;
type RemoveRepoResponse = { success: boolean; data?: { removed: boolean }; error?: string };

async function getToast() {
  const { toast } = await import('svelte-sonner');
  return toast;
}

function* applyWorkspaceChanges(
  workspaceId: string,
  changes: Partial<Workspace>,
): SagaGenerator<void> {
  yield* put(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, changes)]));
}

function workspaceMatchesRepoKey(workspace: Workspace, repoKey: string): boolean {
  if (workspace.repositoryOwner && workspace.repositoryName) {
    return `${workspace.repositoryOwner}/${workspace.repositoryName}` === repoKey;
  }
  return workspace.repositoryPath ? workspace.repositoryPath === repoKey : repoKey === 'unknown';
}

function activeForRepo(repoKey: string, workspaces: Workspace[]): Workspace[] {
  return workspaces.filter(
    (workspace) =>
      workspace.status !== WorkspaceStatusEnum.Archived &&
      workspace.status !== WorkspaceStatusEnum.Deleted &&
      workspaceMatchesRepoKey(workspace, repoKey),
  );
}

function hasActiveWork({ agentNames, hookNames, openPrs, localChanges }: ActiveWorkNames): boolean {
  return (
    agentNames.length > 0 ||
    hookNames.length > 0 ||
    openPrs.length > 0 ||
    Boolean(localChanges?.hasUnpushedCommits || localChanges?.hasUncommittedChanges)
  );
}

// Single-workspace gating: the only path that fetches `workspace.localChanges`.
function getSingleWorkspaceActiveWork(workspaceId: string): Promise<ActiveWorkNames> {
  return getActiveWorkNames(workspaceId, { includeLocalChanges: true });
}

// Bulk flows count only agents/hooks — open PRs never change bulk counts and
// local changes are never fetched (no `workspace.localChanges` fan-out).
function countActiveWork(items: ActiveWorkNames[]): { agentCount: number; hookCount: number } {
  return items.reduce(
    (counts, item) => ({
      agentCount: counts.agentCount + item.agentNames.length,
      hookCount: counts.hookCount + item.hookNames.length,
    }),
    { agentCount: 0, hookCount: 0 },
  );
}

function* collectActiveWork(workspaces: Workspace[]): SagaGenerator<ActiveWorkNames[]> {
  return yield* call(() =>
    Promise.all(workspaces.map((workspace) => getActiveWorkNames(workspace.id))),
  );
}

function archivedForRepo(repoKey: string, workspaces: Workspace[]): Workspace[] {
  return workspaces.filter(
    (workspace) =>
      workspace.status === WorkspaceStatusEnum.Archived &&
      workspaceMatchesRepoKey(workspace, repoKey),
  );
}

function createUndoChannel(): Channel<true> {
  return channel<true>(buffers.sliding(1));
}

function* clearTombstoneAfterGrace(workspaceId: string): SagaGenerator<void> {
  yield* delay(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
  yield* put(clearWorkspacePendingDeletion(workspaceId));
}

function* restoreWorkspace(workspace: Workspace): SagaGenerator<void> {
  yield* put(clearWorkspacePendingDeletion(workspace.id));
  yield* put(setWorkspaceEntity(workspace));
}

/**
 * Daemon-owned delete grace window (PROTOCOL §5.1, delete grace window):
 * `workspace.delete { undoDelayMs }` is sent IMMEDIATELY, so the deletion
 * commits daemon-side at the deadline even if the FE quits or crashes. The FE
 * soft-hides the row and shows the Undo toast; Undo issues the race-safe
 * `workspace.cancelDelete` — `{ cancelled: true }` restores the workspace,
 * `{ cancelled: false }` (already committed) surfaces "could not undo"
 * without resurrecting it.
 */
function* deleteWithUndo(workspace: Workspace): SagaGenerator<void> {
  const undo = createUndoChannel();
  let settled = false;
  try {
    yield* put(removeWorkspaceEntity(workspace.id));
    yield* put(markWorkspacePendingDeletion(workspace.id));

    const toast = yield* call(getToast);
    try {
      const result = yield* call([workspaceClient, workspaceClient.delete], workspace.id, {
        undoDelayMs: WORKSPACE_OPERATION_UNDO_DURATION_MS,
      });
      if (!result.ok) {
        settled = true;
        yield* restoreWorkspace(workspace);
        toast.error(m.workspace_ops_deleteFailed_error());
        return;
      }
    } catch (error) {
      logger.error('workspace.delete failed', { workspaceId: workspace.id, error });
      settled = true;
      yield* restoreWorkspace(workspace);
      toast.error(m.workspace_ops_deleteFailed_error());
      return;
    }

    toast.warning(
      m.workspace_ops_deleted_toast({ title: workspace.title || m.workspace_ops_space_fallback() }),
      withToastCountdown(
        {
          duration: WORKSPACE_OPERATION_UNDO_DURATION_MS,
          action: { label: m.workspace_ops_undo_label(), onClick: () => undo.put(true) },
        },
        { pauseOnHover: false },
      ),
    );
    const outcome = yield* race({
      undo: take(undo),
      timeout: delay(WORKSPACE_OPERATION_UNDO_DURATION_MS),
    });
    if (outcome.undo) {
      try {
        const cancel = yield* call([workspaceClient, workspaceClient.cancelDelete], workspace.id);
        if (cancel.ok && cancel.data.cancelled) {
          settled = true;
          yield* restoreWorkspace(workspace);
          return;
        }
      } catch (error) {
        logger.error('workspace.cancelDelete failed', { workspaceId: workspace.id, error });
      }
      // Race-safe non-error: the daemon already committed (or the cancel RPC
      // failed) — never resurrect the workspace locally.
      toast.error(m.workspace_ops_undoFailed_error());
    }
    settled = true;
    // The daemon commits at the deadline. Keep the tombstone for a grace
    // window so stale refetch responses cannot resurrect the deleted
    // workspace. Detached so it survives task teardown.
    yield* spawn(clearTombstoneAfterGrace, workspace.id);
  } finally {
    undo.close();
    // Teardown mid-window: the daemon still owns the commit; just make sure
    // the tombstone is eventually lifted.
    if ((yield* cancelled()) && !settled) {
      yield* spawn(clearTombstoneAfterGrace, workspace.id);
    }
  }
}

function* requestDelete(action: ReturnType<typeof requestDeleteWorkspace>): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) return;
  const activeWork = yield* call(getSingleWorkspaceActiveWork, workspaceId);
  if (hasActiveWork(activeWork)) {
    yield* put(openDeleteWarning({ workspaceId, ...activeWork }));
    return;
  }
  yield* call(navigateAwayIfViewing, workspaceId);
  const current = yield* selectWorkspaceById.effect(workspaceId);
  if (current) yield* call(deleteWithUndo, current);
}

function* confirmDelete(): SagaGenerator<void> {
  const workspaceId = yield* selectPendingDeleteWorkspaceId.effect();
  yield* put(closeDeleteWarning());
  if (!workspaceId) return;
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) return;
  yield* call(navigateAwayIfViewing, workspaceId);
  const current = yield* selectWorkspaceById.effect(workspaceId);
  if (current) yield* call(deleteWithUndo, current);
}

function* confirmArchive(): SagaGenerator<void> {
  const workspaceId = yield* selectPendingArchiveWorkspaceId.effect();
  yield* put(closeArchiveWarning());
  if (!workspaceId) return;
  yield* call(archiveWorkspaceById, workspaceId);
}

function* watchArchiveUndo(workspaceId: WorkspaceId, undo: Channel<true>): SagaGenerator<void> {
  try {
    const outcome = yield* race({
      undo: take(undo),
      timeout: delay(WORKSPACE_OPERATION_UNDO_DURATION_MS),
    });
    if (!outcome.undo) return;
    const result = yield* call([workspaceClient, workspaceClient.unarchive], workspaceId);
    if (result.ok) {
      yield* applyWorkspaceChanges(workspaceId, {
        status: WorkspaceStatusEnum.Active,
        archived: false,
      });
      // The daemon `workspace:updated` event restores the tab in the background;
      // an explicit undo also focuses the restored workspace.
      yield* put(openWorkspaceTab(workspaceId));
      try {
        yield* call(navigateToRoute, `/workspace/${workspaceId}`);
      } catch (error) {
        logger.warn('Failed to navigate to the unarchived workspace', { workspaceId, error });
      }
    }
  } finally {
    undo.close();
  }
}

function* archive(action: ReturnType<typeof requestArchiveWorkspace>): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) return;
  const activeWork = yield* call(getSingleWorkspaceActiveWork, workspaceId);
  if (hasActiveWork(activeWork)) {
    yield* put(openArchiveWarning({ workspaceId, ...activeWork }));
    return;
  }
  yield* call(archiveWorkspaceById, workspaceId);
}

function* archiveWorkspaceById(workspaceId: string): SagaGenerator<void> {
  const toast = yield* call(getToast);
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  try {
    const result = yield* call(
      [workspaceClient, workspaceClient.archive],
      workspaceId as WorkspaceId,
    );
    if (!result.ok) {
      toast.error(m.workspace_ops_archiveFailed_error());
      return;
    }
    yield* applyWorkspaceChanges(workspaceId, {
      status: WorkspaceStatusEnum.Archived,
      archived: true,
    });
    const undo = createUndoChannel();
    yield* fork(watchArchiveUndo, workspaceId as WorkspaceId, undo);
    toast.warning(
      m.workspace_ops_archived_toast({
        title: workspace?.title || m.workspace_ops_space_fallback(),
      }),
      withToastCountdown(
        {
          duration: WORKSPACE_OPERATION_UNDO_DURATION_MS,
          action: { label: m.workspace_ops_undo_label(), onClick: () => undo.put(true) },
        },
        { pauseOnHover: false },
      ),
    );
  } catch (error) {
    logger.error('workspace.archive failed', { workspaceId, error });
    toast.error(m.workspace_ops_archiveFailed_error());
  }
}

function* unarchive(action: ReturnType<typeof requestUnarchiveWorkspace>): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const toast = yield* call(getToast);
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  try {
    const result = yield* call(
      [workspaceClient, workspaceClient.unarchive],
      workspaceId as WorkspaceId,
    );
    if (!result.ok) {
      toast.error(m.workspace_ops_unarchiveFailed_error());
      return;
    }
    yield* applyWorkspaceChanges(workspaceId, {
      status: WorkspaceStatusEnum.Active,
      archived: false,
    });
    toast.success(
      m.workspace_ops_unarchived_toast({
        title: workspace?.title || m.workspace_ops_space_fallback(),
      }),
    );
  } catch (error) {
    logger.error('workspace.unarchive failed', { workspaceId, error });
    toast.error(m.workspace_ops_unarchiveFailed_error());
  }
}

function* watchBulkArchiveUndo(ids: WorkspaceId[], undo: Channel<true>): SagaGenerator<void> {
  try {
    const outcome = yield* race({
      undo: take(undo),
      timeout: delay(WORKSPACE_OPERATION_UNDO_DURATION_MS),
    });
    if (!outcome.undo) return;
    for (const id of ids) {
      const result = yield* call([workspaceClient, workspaceClient.unarchive], id);
      if (result.ok) {
        yield* applyWorkspaceChanges(id, { status: WorkspaceStatusEnum.Active, archived: false });
      }
    }
  } finally {
    undo.close();
  }
}

function* bulkArchive(): SagaGenerator<void> {
  const repoKey = yield* selectPendingBulkRepoKey.effect();
  yield* put(closeBulkArchiveConfirm());
  if (!repoKey) {
    logger.error('bulkArchive called without a repo key');
    return;
  }
  const toast = yield* call(getToast);
  const workspaces = yield* selectWorkspaceItems.effect();
  const targets = activeForRepo(repoKey, workspaces);
  if (targets.length === 0) {
    toast.info(m.workspace_ops_noActiveToArchive_message());
    return;
  }
  const results = yield* call(() =>
    Promise.allSettled(
      targets.map((workspace) =>
        workspaceClient.archive(workspace.id).then((result) => ({ id: workspace.id, result })),
      ),
    ),
  );
  const archivedIds: WorkspaceId[] = [];
  let failCount = 0;
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.result.ok) {
      archivedIds.push(result.value.id);
      yield* applyWorkspaceChanges(result.value.id, {
        status: WorkspaceStatusEnum.Archived,
        archived: true,
      });
    } else failCount++;
  }
  if (archivedIds.length > 0) {
    const undo = createUndoChannel();
    yield* fork(watchBulkArchiveUndo, archivedIds, undo);
    const message =
      archivedIds.length === 1
        ? m.workspace_ops_archivedCount_one({ count: archivedIds.length })
        : m.workspace_ops_archivedCount_many({ count: archivedIds.length });
    toast.warning(
      message,
      withToastCountdown(
        {
          duration: WORKSPACE_OPERATION_UNDO_DURATION_MS,
          action: { label: m.workspace_ops_undo_label(), onClick: () => undo.put(true) },
        },
        { pauseOnHover: false },
      ),
    );
  }
  if (failCount > 0) {
    toast.error(
      failCount === 1
        ? m.workspace_ops_archiveFailedCount_one({ count: failCount })
        : m.workspace_ops_archiveFailedCount_many({ count: failCount }),
    );
  }
}

function* computeBulkArchiveActiveWork(
  action: ReturnType<typeof openBulkArchiveConfirm>,
): SagaGenerator<void> {
  const [repoKey] = action.payload;
  const token = yield* selectBulkArchiveComputeToken.effect();
  const workspaces = yield* selectWorkspaceItems.effect();
  const targets = activeForRepo(repoKey, workspaces);
  const counts = countActiveWork(yield* collectActiveWork(targets));
  yield* put(bulkArchiveActiveWorkComputed({ repoKey, ...counts, token }));
}

function* performBulkDelete(repoKey: string): SagaGenerator<void> {
  const toast = yield* call(getToast);
  const workspaces = yield* selectWorkspaceItems.effect();
  const targets = archivedForRepo(repoKey, workspaces);
  if (targets.length === 0) {
    toast.info(m.workspace_ops_noArchivedToDelete_message());
    return;
  }
  let deleteCount = 0;
  let timeoutCount = 0;
  let failCount = 0;
  for (const workspace of targets) {
    try {
      const result = yield* call([workspaceClient, workspaceClient.delete], workspace.id);
      if (result.ok) {
        deleteCount++;
        yield* put(removeWorkspaceEntity(workspace.id));
        yield* put(markWorkspacePendingDeletion(workspace.id));
        yield* spawn(clearTombstoneAfterGrace, workspace.id);
      } else if (result.error?.includes('timed out')) timeoutCount++;
      else failCount++;
    } catch {
      failCount++;
    }
  }
  if (deleteCount > 0) {
    toast.success(
      deleteCount === 1
        ? m.workspace_ops_permanentlyDeletedCount_one({ count: deleteCount })
        : m.workspace_ops_permanentlyDeletedCount_many({ count: deleteCount }),
    );
  }
  if (timeoutCount > 0) {
    toast.info(
      timeoutCount === 1
        ? m.workspace_ops_stillDeleting_one({ count: timeoutCount })
        : m.workspace_ops_stillDeleting_many({ count: timeoutCount }),
    );
  }
  if (failCount > 0) {
    toast.error(
      failCount === 1
        ? m.workspace_ops_deleteFailedCount_one({ count: failCount })
        : m.workspace_ops_deleteFailedCount_many({ count: failCount }),
    );
  }
}

function* bulkDeleteArchived(): SagaGenerator<void> {
  const repoKey = yield* selectPendingBulkRepoKey.effect();
  yield* put(closeBulkDeleteArchivedConfirm());
  if (!repoKey) {
    logger.error('bulkDeleteArchived called without a repo key');
    return;
  }
  const workspaces = yield* selectWorkspaceItems.effect();
  const targets = archivedForRepo(repoKey, workspaces);
  if (targets.length === 0) {
    (yield* call(getToast)).info(m.workspace_ops_noArchivedToDelete_message());
    return;
  }
  const counts = countActiveWork(yield* collectActiveWork(targets));
  if (counts.agentCount > 0 || counts.hookCount > 0) {
    yield* put(
      openBulkDeleteWarningConfirm({ repoKey, workspaceCount: targets.length, ...counts }),
    );
    return;
  }
  yield* performBulkDelete(repoKey);
}

function* bulkDeleteAfterWarning(): SagaGenerator<void> {
  const repoKey = yield* selectPendingBulkDeleteRepoKey.effect();
  yield* put(closeBulkDeleteWarningConfirm());
  if (!repoKey) {
    logger.error('bulkDeleteAfterWarning called without a repo key');
    return;
  }
  yield* performBulkDelete(repoKey);
}

function* removeRepoFromRegistry(): SagaGenerator<void> {
  const repoPath = yield* selectPendingRemoveRepoPath.effect();
  yield* put(closeRemoveRepoConfirm());
  if (!repoPath) return;
  try {
    const result = yield* call(
      invoke<RemoveRepoResponse>,
      WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
      {
        repository: repoPath,
      },
    );
    if (!result?.success) throw new Error(result?.error || m.workspace_ops_removeFailed_error());
    yield* put(removeRepo(repoPath));
  } catch (error) {
    logger.error('Failed to remove repository from registry', error);
    (yield* call(getToast)).error(m.workspace_ops_removeRepoFailed_error());
  }
}

function* failProposal(proposalId: string, error: string, errorCode?: string): SagaGenerator<void> {
  yield* put(
    proposalFailed({
      proposalId,
      error,
      ...(errorCode ? { errorCode } : {}),
      completedAt: Date.now(),
      lastAction: 'apply',
    }),
  );
  (yield* call(getToast)).error(error);
}

function* applyCreateProposal(payload: WorkspaceProposalApplyPayload): SagaGenerator<void> {
  const { proposal, editedFields } = payload;
  if (!isWorkspaceCreateProposal(proposal)) return;
  const proposalId = getProposalId(proposal);
  const lifecycle = yield* selectProposalLifecycleEntry.effect(proposalId);
  if (lifecycle?.status === 'applying' || lifecycle?.status === 'applied') return;
  yield* put(proposalApplyStarted({ proposalId, startedAt: Date.now() }));
  try {
    const result = yield* call(
      [workspaceClient, workspaceClient.create],
      buildCreateWorkspaceRequestFromProposal(proposal, editedFields),
    );
    if (!result.ok) {
      yield* failProposal(proposalId, result.error, result.errorCode);
      return;
    }
    yield* put(setWorkspaceEntity(result.data.workspace));
    yield* put(
      proposalApplySucceeded({
        proposalId,
        completedAt: Date.now(),
        result: { workspaceId: result.data.workspace.id },
      }),
    );
  } catch (error) {
    yield* failProposal(proposalId, error instanceof Error ? error.message : String(error));
  }
}

function* applyBulkProposal(payload: WorkspaceProposalApplyPayload): SagaGenerator<void> {
  const { proposal, selectedBulkItemIds } = payload;
  if (!isBulkOperationProposal(proposal)) return;
  const proposalId = getProposalId(proposal);
  const lifecycle = yield* selectProposalLifecycleEntry.effect(proposalId);
  if (lifecycle?.status === 'applying' || lifecycle?.status === 'applied') return;
  const isDelete = proposal.payload.operation === 'workspace.bulkDelete';
  const ids = selectedBulkItemIds ?? proposal.payload.ids;
  if (ids.length === 0) {
    yield* failProposal(
      proposalId,
      isDelete
        ? m.workspace_ops_noneSelectedDelete_error()
        : m.workspace_ops_noneSelectedArchive_error(),
    );
    return;
  }
  yield* put(proposalApplyStarted({ proposalId, startedAt: Date.now() }));
  const toast = yield* call(getToast);
  if (!isDelete) {
    const results = yield* call(() =>
      Promise.allSettled(
        ids.map((id) =>
          workspaceClient.archive(id as WorkspaceId).then((result) => ({ id, result })),
        ),
      ),
    );
    let count = 0;
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.result.ok) {
        count++;
        yield* applyWorkspaceChanges(result.value.id, {
          status: WorkspaceStatusEnum.Archived,
          archived: true,
        });
      }
    }
    const failed = ids.length - count;
    if (failed > 0) {
      yield* failProposal(
        proposalId,
        ids.length === 1
          ? m.workspace_ops_archiveFailedOfCount_one({ failCount: failed, total: ids.length })
          : m.workspace_ops_archiveFailedOfCount_many({ failCount: failed, total: ids.length }),
      );
      return;
    }
    yield* put(proposalApplySucceeded({ proposalId, completedAt: Date.now() }));
    toast.success(
      count === 1
        ? m.workspace_ops_archivedCount_one({ count })
        : m.workspace_ops_archivedCount_many({ count }),
    );
    return;
  }
  let deleted = 0;
  let timedOut = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const result = yield* call([workspaceClient, workspaceClient.delete], id as WorkspaceId);
      if (result.ok) {
        deleted++;
        yield* put(removeWorkspaceEntity(id as WorkspaceId));
        yield* put(markWorkspacePendingDeletion(id as WorkspaceId));
        yield* spawn(clearTombstoneAfterGrace, id as WorkspaceId);
      } else if (result.error?.includes('timed out')) timedOut++;
      else failed++;
    } catch {
      failed++;
    }
  }
  if (failed > 0) {
    yield* failProposal(
      proposalId,
      ids.length === 1
        ? m.workspace_ops_deleteFailedOfCount_one({ failCount: failed, total: ids.length })
        : m.workspace_ops_deleteFailedOfCount_many({ failCount: failed, total: ids.length }),
    );
    return;
  }
  yield* put(proposalApplySucceeded({ proposalId, completedAt: Date.now() }));
  if (deleted > 0) {
    toast.success(
      deleted === 1
        ? m.workspace_ops_deletedCount_one({ count: deleted })
        : m.workspace_ops_deletedCount_many({ count: deleted }),
    );
  }
  if (timedOut > 0) {
    toast.info(
      timedOut === 1
        ? m.workspace_ops_stillDeleting_one({ count: timedOut })
        : m.workspace_ops_stillDeleting_many({ count: timedOut }),
    );
  }
}

function* applyProposal(action: ReturnType<typeof applyWorkspaceProposal>): SagaGenerator<void> {
  const [payload] = action.payload;
  if (isBulkOperationProposal(payload.proposal)) yield* applyBulkProposal(payload);
  else yield* applyCreateProposal(payload);
}

export function* workspaceOperationsSaga(): SagaGenerator<void> {
  yield* all([
    takeEvery(requestDeleteWorkspace, requestDelete),
    takeEvery(confirmDeleteWorkspace, confirmDelete),
    takeEvery(confirmArchiveWorkspace, confirmArchive),
    takeEvery(requestArchiveWorkspace, archive),
    takeEvery(openBulkArchiveConfirm, computeBulkArchiveActiveWork),
    takeEvery(requestUnarchiveWorkspace, unarchive),
    takeEvery(confirmBulkArchive, bulkArchive),
    takeEvery(confirmBulkDeleteArchived, bulkDeleteArchived),
    takeEvery(confirmBulkDeleteWarning, bulkDeleteAfterWarning),
    takeEvery(confirmRemoveRepo, removeRepoFromRegistry),
    takeEvery(applyWorkspaceProposal, applyProposal),
  ]);
}
