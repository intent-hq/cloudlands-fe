import { store } from '../../../store';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import {
  captureDeletionExpiry,
  captureWorkspaceDeletion,
  type WorkspaceDeletion,
} from '../../workspace/utils/workspace-deletion';
import { buffers, channel, type Channel } from 'redux-saga';
import {
  all,
  call,
  delay,
  fork,
  put,
  race,
  spawn,
  take,
  takeEvery,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';

import { invoke } from '$lib/electron-bridge';
import { getProposalId } from '$lib/components/chat/proposals/proposal-id';
import { withToastCountdown } from '$lib/components/patterns/notify';
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
import { selectSpecialists } from '../../specialists/specialists-selectors';
import {
  bulkUpdateWorkspaceEntities,
  markWorkspacePendingDeletion,
  removeWorkspaceEntity,
  setWorkspaceEntity,
  updateWorkspaceEntity,
} from '../../workspace/workspace-slice';
import { selectWorkspaceById, selectWorkspaceItems } from '../../workspace/workspace-selectors';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import {
  applyWorkspaceProposal,
  bulkActiveWorkComputed,
  bulkOperationFinished,
  bulkOperationStarted,
  closeArchiveWarning,
  closeBulkArchiveConfirm,
  closeBulkDeleteConfirm,
  closeDeleteWarning,
  closeRemoveRepoConfirm,
  confirmArchiveWorkspace,
  confirmBulkArchive,
  confirmBulkDelete,
  confirmDeleteWorkspace,
  confirmRemoveRepo,
  openArchiveWarning,
  openBulkArchiveConfirm,
  openBulkDeleteConfirm,
  openDeleteWarning,
  requestArchiveWorkspace,
  requestDeleteWorkspace,
  requestUnarchiveWorkspace,
} from '../workspace-operations-slice';
import {
  selectBulkComputeToken,
  selectBulkOperationInFlight,
  selectBulkPreflightReady,
  selectPendingArchiveWorkspaceId,
  selectPendingBulkWorkspaceIds,
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
  const { notify } = await import('$lib/components/patterns/notify');
  return notify;
}

function* applyWorkspaceChanges(
  workspaceId: string,
  changes: Partial<Workspace>,
): SagaGenerator<void> {
  yield* put(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, changes)]));
}

function workspacesForIds(workspaceIds: string[], workspaces: Workspace[]): Workspace[] {
  const byId = new Map<string, Workspace>(workspaces.map((workspace) => [workspace.id, workspace]));
  return workspaceIds.flatMap((workspaceId) => {
    const workspace = byId.get(workspaceId);
    return workspace ? [workspace] : [];
  });
}

// Single-workspace gating: guests alone (collaborators or open invites) open
// the warning too, since archive/delete removes them from the workspace.
function hasActiveWork({
  agentNames,
  hookNames,
  openPrs,
  localChanges,
  guests,
}: ActiveWorkNames): boolean {
  return (
    agentNames.length > 0 ||
    hookNames.length > 0 ||
    openPrs.length > 0 ||
    Boolean(localChanges?.hasUnpushedCommits || localChanges?.hasUncommittedChanges) ||
    guests.collaboratorCount + guests.openInviteCount > 0
  );
}

// Single-workspace gating: the only path that fetches `workspace.localChanges`.
function getSingleWorkspaceActiveWork(workspaceId: string): Promise<ActiveWorkNames> {
  return getActiveWorkNames(workspaceId, { includeLocalChanges: true });
}

// Bulk flows count agents/hooks/open PRs and guests but never fetch local changes
// (no `workspace.localChanges` fan-out).
function countActiveWork(items: ActiveWorkNames[]): {
  agentCount: number;
  hookCount: number;
  openPrCount: number;
  guestCount: number;
} {
  return items.reduce(
    (counts, item) => ({
      agentCount: counts.agentCount + item.agentNames.length,
      hookCount: counts.hookCount + item.hookNames.length,
      openPrCount: counts.openPrCount + item.openPrs.length,
      guestCount: counts.guestCount + item.guests.collaboratorCount + item.guests.openInviteCount,
    }),
    { agentCount: 0, hookCount: 0, openPrCount: 0, guestCount: 0 },
  );
}

function* collectActiveWork(workspaces: Workspace[]): SagaGenerator<ActiveWorkNames[]> {
  return yield* call(() =>
    Promise.all(workspaces.map((workspace) => getActiveWorkNames(workspace.id))),
  );
}

function createUndoChannel(): Channel<true> {
  return channel<true>(buffers.sliding(1));
}

function* clearTombstoneAfterGrace(
  workspaceId: string,
  operation?: WorkspaceDeletion,
): SagaGenerator<void> {
  const expire = operation ? operation.expire : captureDeletionExpiry(workspaceId);
  yield* delay(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
  expire();
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
function* deleteWithUndo(workspace: Workspace, operation: WorkspaceDeletion): SagaGenerator<void> {
  if (!operation.begin()) return;
  const undo = createUndoChannel();
  let restored = false;
  let scheduled = false;
  let toastId: string | number | undefined;
  let notify: Awaited<ReturnType<typeof getToast>> | undefined;
  try {
    notify = yield* call(getToast);
    if (!operation.current()) return;
    const result = yield* call(
      [workspaceClient, workspaceClient.delete],
      workspace.id,
      {
        undoDelayMs: WORKSPACE_OPERATION_UNDO_DURATION_MS,
      },
      operation,
    );
    if (!operation.current() || ('obsolete' in result && result.obsolete)) return;
    if (!result.ok) {
      operation.restore();
      restored = true;
      notify.error(m.workspace_ops_deleteFailed_error());
      return;
    }
    scheduled = true;
    toastId = notify.warning(
      m.workspace_ops_deleted_toast({ title: workspace.title || m.workspace_ops_space_fallback() }),
      withToastCountdown(
        {
          duration: WORKSPACE_OPERATION_UNDO_DURATION_MS,
          action: {
            label: m.workspace_ops_undo_label(),
            onClick: () => {
              if (operation.current()) undo.put(true);
            },
          },
        },
        { pauseOnHover: false },
      ),
    );
    const outcome = yield* race({
      undo: take(undo),
      timeout: delay(WORKSPACE_OPERATION_UNDO_DURATION_MS),
      obsolete: take(() => !operation.current()),
    });
    if (!operation.current() || outcome.obsolete) return;
    if (outcome.undo) {
      const cancel = yield* call(
        [workspaceClient, workspaceClient.cancelDelete],
        workspace.id,
        operation,
      );
      if (!operation.current() || ('obsolete' in cancel && cancel.obsolete)) return;
      if (cancel.ok && cancel.data.cancelled) {
        operation.restore();
        restored = true;
        return;
      }
      notify.error(m.workspace_ops_undoFailed_error());
    }
  } catch (error) {
    if (operation.current()) {
      if (!scheduled) {
        operation.restore();
        restored = true;
      }
      notify?.error(
        scheduled ? m.workspace_ops_undoFailed_error() : m.workspace_ops_deleteFailed_error(),
      );
      logger.error('workspace.delete failed', { workspaceId: workspace.id, error });
    }
  } finally {
    undo.close();
    if (toastId !== undefined) notify?.dismiss(toastId);
    if (!restored) yield* spawn(clearTombstoneAfterGrace, workspace.id, operation);
  }
}

function* requestDelete(action: ReturnType<typeof requestDeleteWorkspace>): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) return;
  const operation = captureWorkspaceDeletion(workspace);
  if (!operation) return;
  const activeWork = yield* call(getSingleWorkspaceActiveWork, workspaceId);
  if (!operation.current()) return;
  if (hasActiveWork(activeWork)) {
    yield* put(openDeleteWarning({ workspaceId, ...activeWork }));
    return;
  }
  yield* call(navigateAwayIfViewing, workspaceId);
  const current = yield* selectWorkspaceById.effect(workspaceId);
  if (current && operation.current()) yield* call(deleteWithUndo, current, operation);
}

function* confirmDelete(): SagaGenerator<void> {
  const workspaceId = yield* selectPendingDeleteWorkspaceId.effect();
  yield* put(closeDeleteWarning());
  if (!workspaceId) return;
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) return;
  const operation = captureWorkspaceDeletion(workspace);
  if (!operation) return;
  yield* call(navigateAwayIfViewing, workspaceId);
  const current = yield* selectWorkspaceById.effect(workspaceId);
  if (current && operation.current()) yield* call(deleteWithUndo, current, operation);
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
  const notify = yield* call(getToast);
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  try {
    const result = yield* call(
      [workspaceClient, workspaceClient.archive],
      workspaceId as WorkspaceId,
    );
    if (!result.ok) {
      notify.error(m.workspace_ops_archiveFailed_error());
      return;
    }
    yield* applyWorkspaceChanges(workspaceId, {
      status: WorkspaceStatusEnum.Archived,
      archived: true,
    });
    const undo = createUndoChannel();
    yield* fork(watchArchiveUndo, workspaceId as WorkspaceId, undo);
    notify.warning(
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
    notify.error(m.workspace_ops_archiveFailed_error());
  }
}

function* unarchive(action: ReturnType<typeof requestUnarchiveWorkspace>): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const notify = yield* call(getToast);
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  try {
    const result = yield* call(
      [workspaceClient, workspaceClient.unarchive],
      workspaceId as WorkspaceId,
    );
    if (!result.ok) {
      notify.error(m.workspace_ops_unarchiveFailed_error());
      return;
    }
    yield* applyWorkspaceChanges(workspaceId, {
      status: WorkspaceStatusEnum.Active,
      archived: false,
    });
    notify.success(
      m.workspace_ops_unarchived_toast({
        title: workspace?.title || m.workspace_ops_space_fallback(),
      }),
    );
  } catch (error) {
    logger.error('workspace.unarchive failed', { workspaceId, error });
    notify.error(m.workspace_ops_unarchiveFailed_error());
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
  const preflightReady = yield* selectBulkPreflightReady.effect();
  const operationInFlight = yield* selectBulkOperationInFlight.effect();
  if (!preflightReady || operationInFlight) return;
  const workspaceIds = yield* selectPendingBulkWorkspaceIds.effect();
  const workspaces = yield* selectWorkspaceItems.effect();
  const targets = workspacesForIds(workspaceIds, workspaces).filter(
    (workspace) =>
      workspace.status !== WorkspaceStatusEnum.Archived &&
      workspace.status !== WorkspaceStatusEnum.Deleted,
  );
  yield* put(bulkOperationStarted({ kind: 'archive', workspaceIds: targets.map(({ id }) => id) }));
  yield* put(closeBulkArchiveConfirm());
  try {
    const notify = yield* call(getToast);
    if (targets.length === 0) {
      notify.info(m.workspace_ops_noActiveToArchive_message());
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
      yield* spawn(watchBulkArchiveUndo, archivedIds, undo);
      const message =
        archivedIds.length === 1
          ? m.workspace_ops_archivedCount_one({ count: archivedIds.length })
          : m.workspace_ops_archivedCount_many({ count: archivedIds.length });
      notify.warning(
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
      notify.error(
        failCount === 1
          ? m.workspace_ops_archiveFailedCount_one({ count: failCount })
          : m.workspace_ops_archiveFailedCount_many({ count: failCount }),
      );
    }
  } finally {
    yield* put(bulkOperationFinished());
  }
}

function* computeBulkActiveWork(
  kind: 'archive' | 'delete',
  workspaceIds: string[],
): SagaGenerator<void> {
  const token = yield* selectBulkComputeToken.effect();
  const workspaces = yield* selectWorkspaceItems.effect();
  const targets = workspacesForIds(workspaceIds, workspaces);
  const counts = countActiveWork(yield* collectActiveWork(targets));
  yield* put(bulkActiveWorkComputed({ kind, ...counts, token }));
}

function* computeBulkArchiveActiveWork(
  action: ReturnType<typeof openBulkArchiveConfirm>,
): SagaGenerator<void> {
  yield* computeBulkActiveWork('archive', action.payload[0].workspaceIds);
}

function* computeBulkDeleteActiveWork(
  action: ReturnType<typeof openBulkDeleteConfirm>,
): SagaGenerator<void> {
  yield* computeBulkActiveWork('delete', action.payload[0].workspaceIds);
}

function* performBulkDelete(
  operations: WorkspaceDeletion[],
  current: () => boolean,
  graceIds: string[],
): SagaGenerator<string[]> {
  const notify = yield* call(getToast);
  if (!current()) return [];
  if (operations.length === 0) {
    notify.info(m.workspace_ops_noWorkspacesToDelete_message());
    return [];
  }
  let deleteCount = 0;
  let timeoutCount = 0;
  let failCount = 0;
  for (const operation of operations) {
    if (!current()) break;
    if (operation.terminal() === 'removed') {
      graceIds.push(operation.workspaceId);
      yield* spawn(clearTombstoneAfterGrace, operation.workspaceId, operation);
      continue;
    }
    if (!operation.current()) break;
    try {
      const result = yield* call(
        [workspaceClient, workspaceClient.delete],
        operation.workspaceId,
        undefined,
        operation,
      );
      if (!current() || (!operation.current() && operation.terminal() !== 'removed')) break;
      if (result.ok || operation.terminal() === 'removed') {
        graceIds.push(operation.workspaceId);
        yield* put(removeWorkspaceEntity(operation.workspaceId));
        yield* spawn(clearTombstoneAfterGrace, operation.workspaceId, operation);
      }
      if (result.ok) deleteCount++;
      else if (result.error?.includes('timed out')) timeoutCount++;
      else failCount++;
    } catch {
      if (!current() || (!operation.current() && operation.terminal() !== 'removed')) break;
      if (operation.terminal() === 'removed') {
        graceIds.push(operation.workspaceId);
        yield* spawn(clearTombstoneAfterGrace, operation.workspaceId, operation);
      }
      failCount++;
    }
  }
  if (!current()) return graceIds;
  if (deleteCount > 0) {
    notify.success(
      deleteCount === 1
        ? m.workspace_ops_permanentlyDeletedCount_one({ count: deleteCount })
        : m.workspace_ops_permanentlyDeletedCount_many({ count: deleteCount }),
    );
  }
  if (timeoutCount > 0) {
    notify.info(
      timeoutCount === 1
        ? m.workspace_ops_stillDeleting_one({ count: timeoutCount })
        : m.workspace_ops_stillDeleting_many({ count: timeoutCount }),
    );
  }
  if (failCount > 0) {
    notify.error(
      failCount === 1
        ? m.workspace_ops_deleteFailedCount_one({ count: failCount })
        : m.workspace_ops_deleteFailedCount_many({ count: failCount }),
    );
  }
  return graceIds;
}

function* bulkDelete(): SagaGenerator<void> {
  const preflightReady = yield* selectBulkPreflightReady.effect();
  const operationInFlight = yield* selectBulkOperationInFlight.effect();
  if (!preflightReady || operationInFlight) return;
  const workspaceIds = yield* selectPendingBulkWorkspaceIds.effect();
  const workspaces = yield* selectWorkspaceItems.effect();
  const targets = workspacesForIds(workspaceIds, workspaces);
  // Capture every target before any navigation/read await. Each token keeps its
  // original admission even when a later call would find the same ID again.
  const operations = targets.map(captureWorkspaceDeletion);
  if (operations.some((operation) => operation === null)) return;
  const ownedOperations = operations as WorkspaceDeletion[];
  const dispatch = store.dispatch;
  const backend = store.state.connections.windowBackendId;
  const admission = selectPrincipalActionContext.select(store.state);
  const reservedIds = targets.map(({ id }) => id);
  const ownsBulk = () => {
    try {
      return (
        store.dispatch === dispatch &&
        store.state.connections.windowBackendId === backend &&
        store.state.workspaceOperations.bulkReservedWorkspaceIds === reservedIds
      );
    } catch {
      return false;
    }
  };
  const current = () =>
    ownsBulk() &&
    admission !== null &&
    selectPrincipalActionContext.select(store.state) === admission;
  yield* put(bulkOperationStarted({ kind: 'delete', workspaceIds: reservedIds }));
  yield* put(closeBulkDeleteConfirm());
  const graceIds: string[] = [];
  try {
    for (const operation of ownedOperations) {
      if (!current() || !operation.begin(false)) return;
    }
    for (const operation of ownedOperations) {
      if (!current()) return;
      if (operation.terminal() === 'removed') continue;
      if (!operation.current()) return;
      yield* call(navigateAwayIfViewing, operation.workspaceId);
    }
    yield* performBulkDelete(ownedOperations, current, graceIds);
  } finally {
    const graceIdSet = new Set(graceIds);
    for (const operation of ownedOperations) {
      if (graceIdSet.has(operation.workspaceId)) continue;
      if (operation.terminal() !== null)
        yield* spawn(clearTombstoneAfterGrace, operation.workspaceId, operation);
      else operation.expire();
    }
    // An obsolete admission may settle its own UI lock; it cannot settle a
    // replacement store or another operation's lock/tombstones/notifications.
    if (ownsBulk()) dispatch(bulkOperationFinished());
  }
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
    // Mirror CompactWorkspaceInitializer: the specialist's display name, or
    // the generic "Agent" label when the specialist is General or unknown.
    const specialists = yield* selectSpecialists.effect();
    const result = yield* call(
      [workspaceClient, workspaceClient.create],
      buildCreateWorkspaceRequestFromProposal(proposal, editedFields, {
        resolveAgentName: (specialistId) =>
          (specialistId ? specialists.find((s) => s.id === specialistId)?.name : undefined) ??
          m.workspace_fileChanges_agent_label(),
      }),
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
  const notify = yield* call(getToast);
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
    notify.success(
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
    notify.success(
      deleted === 1
        ? m.workspace_ops_deletedCount_one({ count: deleted })
        : m.workspace_ops_deletedCount_many({ count: deleted }),
    );
  }
  if (timedOut > 0) {
    notify.info(
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
    takeEvery(openBulkDeleteConfirm, computeBulkDeleteActiveWork),
    takeEvery(requestUnarchiveWorkspace, unarchive),
    takeLeading(confirmBulkArchive, bulkArchive),
    takeLeading(confirmBulkDelete, bulkDelete),
    takeEvery(confirmRemoveRepo, removeRepoFromRegistry),
    takeEvery(applyWorkspaceProposal, applyProposal),
  ]);
}
