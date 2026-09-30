import {
  all,
  call,
  cancelled,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { acceptChangesTransport } from '$features/accept-changes/accept-changes.transport';
import type { AcceptChangesResult, UndoCommitMetadata } from '$features/accept-changes/types';
import { appClient } from '$lib/client';
import { notify } from '$lib/components/patterns/notify';
import { isDaemonManagedRepoPath } from '$lib/components/workspace/initializer/recent-repo-display';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { store as appStore } from '../../../store';
import { prWorkflowRequested } from '../../pr-workflow/pr-workflow-slice';
import { reserveGitMutation, type GitMutationLease } from '../../../utils/worktree-mutation-queue';
import { clearOlderCommits, refreshRequested, setCommitMessage } from '../../changes/changes-slice';
import {
  selectAcceptChangesState,
  selectFileTrackingCommits,
} from '../../changes/changes-selectors';
import {
  acceptChangesStatusInvalidated,
  gitReadsInvalidated,
  loadGitStatus,
  setPostMergeState,
} from '../../git/git-slice';
import { selectPostMergeState } from '../../git/git-selectors';
import { refreshPRStatusRequested } from '../../pr-status/pr-status-slice';
import { setShowCreateModal } from '../../sidebar-nav/sidebar-nav-slice';
import {
  selectIsWorkspaceCollaborator,
  selectWorkspaceById,
} from '../../workspace/workspace-selectors';
import { loadWorkspacesRequested, setWorkspaceEntity } from '../../workspace/workspace-slice';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  acceptOperationFinished,
  acceptOperationStarted,
  addAcceptRemoteRequested,
  archiveAndStartRequested,
  executeAcceptRequested,
  mergePRAcceptRequested,
  mergePRWorkflowRequested,
  mergeToTrunkRequested,
  prepareAcceptRequested,
  resetAcceptToTrunkRequested,
  resetAndContinueRequested,
  setMergeDrawerOpen,
  undoAcceptRequested,
} from '../accept-workflow-slice';
import type { AcceptOperation, AcceptOperationKind } from '../accept-workflow-types';

class MergeNeedsRebase extends Error {
  constructor(
    readonly workspaceId: string,
    readonly targetBranch: string,
  ) {
    super(m.workspace_mergePanel_conflicts_error());
  }
}

/** Mutation authorization is re-read after waiting for the queue, never captured from a component. */
function* requireOwner(workspaceId: string): SagaGenerator<void> {
  if (yield* selectIsWorkspaceCollaborator.effect(workspaceId)) {
    throw new Error(m.workspace_gitError_permissionDenied());
  }
}

function* invalidate(workspaceId: string): SagaGenerator<void> {
  // Preserve the established status-before-changes request order.
  yield* put(loadGitStatus(workspaceId, true));
  yield* put(refreshRequested(workspaceId, true));
  yield* put(gitReadsInvalidated(workspaceId));
  yield* put(acceptChangesStatusInvalidated(workspaceId));
}

function* runOperation<T>(
  workspaceId: string,
  kind: AcceptOperationKind,
  work: (lease: GitMutationLease) => SagaGenerator<T>,
  settlement?: {
    success: (result: T) => { type: string };
    failure: (error: Error) => { type: string };
  },
  inBandFailure?: (error: string) => T,
): SagaGenerator<void> {
  const lease = reserveGitMutation(workspaceId);
  const operation: AcceptOperation = {
    kind,
    requestId: crypto.randomUUID(),
    status: 'running',
    error: null,
  };
  let lifetimeEnded = false;
  function* worker(): SagaGenerator<void> {
    try {
      yield* put(acceptOperationStarted(workspaceId, operation));
      yield* call(() => lease.ready);
      if (kind !== 'prepare') yield* call(requireOwner, workspaceId);
      const result = yield* call(work, lease);
      const failure =
        typeof result === 'object' &&
        result !== null &&
        'success' in result &&
        result.success === false;
      const error =
        failure && 'error' in result && typeof result.error === 'string' ? result.error : null;
      yield* put(
        acceptOperationFinished(workspaceId, {
          ...operation,
          status: failure ? 'failed' : 'succeeded',
          error,
        }),
      );
      // Transport completion is not domain success: the original in-band result is preserved.
      if (settlement) yield* put(settlement.success(result));
    } catch (thrown) {
      const error =
        thrown instanceof Error ? thrown : new Error(m.acceptChanges_client_executeFailed_error());
      yield* put(
        acceptOperationFinished(workspaceId, {
          ...operation,
          status: 'failed',
          error: error.message,
        }),
      );
      if (settlement) {
        if (inBandFailure) yield* put(settlement.success(inBandFailure(error.message)));
        else yield* put(settlement.failure(error));
      } else if (error instanceof MergeNeedsRebase) {
        yield* call(notify.error, error.message, {
          description: m.workspace_mergePanel_conflicts_description(),
          action: {
            label: m.workspace_mergePanel_rebaseInTerminal_label(),
            onClick: () => {
              void appStore.dispatch(
                prWorkflowRequested(error.workspaceId, {
                  kind: 'rebase-terminal',
                  targetBranch: error.targetBranch,
                }),
              );
            },
          },
          duration: 10000,
        });
      } else {
        yield* call(notify.error, error.message);
      }
    } finally {
      const released = lease.release();
      if (yield* cancelled()) {
        if (!lifetimeEnded)
          yield* put(
            acceptOperationFinished(workspaceId, {
              ...operation,
              status: 'cancelled',
              error: null,
            }),
          );
        if (settlement) {
          const error = new Error('Accept workflow cancelled');
          if (inBandFailure) yield* put(settlement.success(inBandFailure(error.message)));
          else yield* put(settlement.failure(error));
        }
      } else {
        yield* call(() => released);
        if (kind !== 'prepare') yield* call(invalidate, workspaceId);
      }
    }
  }
  // Subscribe before starting work, including its queue wait and reconciliation.
  // Cancellation releases the lease, whose transport tail remains a write barrier.
  yield* race({
    ended: call(function* () {
      while (true) {
        const {
          payload: [endedWorkspaceId],
        } = yield* take(workspaceUnmounted);
        if (endedWorkspaceId === workspaceId) {
          lifetimeEnded = true;
          return;
        }
      }
    }),
    operation: call(worker),
  });
}

function failedResult(error: string): AcceptChangesResult {
  return { success: false, steps: [], error };
}

function* prepare(action: ReturnType<typeof prepareAcceptRequested>): SagaGenerator<void> {
  const [workspaceId, acceptAction, files] = action.payload;
  yield* runOperation(
    workspaceId,
    'prepare',
    function* (lease) {
      return yield* call(() =>
        lease.run(() =>
          acceptChangesTransport.prepare(workspaceId as WorkspaceId, acceptAction, files),
        ),
      );
    },
    action,
  );
}

function* execute(action: ReturnType<typeof executeAcceptRequested>): SagaGenerator<void> {
  const [workspaceId, acceptAction, options] = action.payload;
  yield* runOperation(
    workspaceId,
    'execute',
    function* (lease) {
      const result = yield* call(() =>
        lease.run(() =>
          acceptChangesTransport.execute(workspaceId as WorkspaceId, acceptAction, options),
        ),
      );
      return result;
    },
    action,
    failedResult,
  );
}

function* mergePR(action: ReturnType<typeof mergePRAcceptRequested>): SagaGenerator<void> {
  const [workspaceId, prNumber, options] = action.payload;
  yield* runOperation(
    workspaceId,
    'mergePR',
    function* (lease) {
      const result = yield* call(() =>
        lease.run(() =>
          acceptChangesTransport.mergePR(workspaceId as WorkspaceId, prNumber, options),
        ),
      );
      return result;
    },
    action,
    failedResult,
  );
}

function* addRemote(action: ReturnType<typeof addAcceptRemoteRequested>): SagaGenerator<void> {
  const [workspaceId, remoteUrl] = action.payload;
  yield* runOperation(
    workspaceId,
    'addRemote',
    function* (lease) {
      const result = yield* call(() =>
        lease.run(() => acceptChangesTransport.addRemote(workspaceId as WorkspaceId, remoteUrl)),
      );
      return result;
    },
    action,
  );
}

function* resetToTrunk(
  action: ReturnType<typeof resetAcceptToTrunkRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* runOperation(
    workspaceId,
    'resetToTrunk',
    function* (lease) {
      const result = yield* call(() =>
        lease.run(() => acceptChangesTransport.resetToTrunk(workspaceId as WorkspaceId)),
      );
      return result;
    },
    action,
    failedResult,
  );
}

function* persistBase(
  workspaceId: string,
  baseCommitSha: string,
  lease: GitMutationLease,
): SagaGenerator<void> {
  const result = yield* call(() =>
    lease.run(() => workspaceClient.update({ id: workspaceId as WorkspaceId, baseCommitSha })),
  );
  if (!result.ok) throw new Error(result.error);
  yield* put(setWorkspaceEntity(result.data));
  yield* put(clearOlderCommits(workspaceId));
}

function* merged(workspaceId: string, mergeHeadSha: string | null): SagaGenerator<void> {
  const previous = yield* selectPostMergeState.effect(workspaceId);
  yield* put(setPostMergeState(workspaceId, { ...previous, isMergedToTrunk: true, mergeHeadSha }));
  yield* put(setMergeDrawerOpen(workspaceId, false));
  // One-shot presentation effect owned by the successful workflow, never a mount observer.
  try {
    const { default: confetti } = yield* call(() => import('canvas-confetti'));
    yield* call(() => {
      void confetti({ disableForReducedMotion: true });
    });
  } catch {
    /* Celebration is optional; a completed merge remains successful. */
  }
}

function* mergeWorkflow(
  action: ReturnType<typeof mergeToTrunkRequested>,
  lease: GitMutationLease,
): SagaGenerator<AcceptChangesResult> {
  const [workspaceId, options] = action.payload;
  if (options.hasStaged) {
    if (!options.commitMessage.trim())
      throw new Error(m.workspace_mergePanel_commitMessageRequired_error());
    const commit = yield* call(() =>
      lease.run(() =>
        acceptChangesTransport.execute(workspaceId as WorkspaceId, 'commit', {
          commitMessage: options.commitMessage.trim(),
        }),
      ),
    );
    if (!commit.success)
      throw new Error(commit.error || m.workspace_mergePanel_commitFailed_error());
  }
  yield* call(requireOwner, workspaceId);
  const result = yield* call(() =>
    lease.run(() =>
      acceptChangesTransport.execute(workspaceId as WorkspaceId, 'merge', {
        targetBranch: options.targetBranch,
        mergeStrategy: options.squash ? 'squash' : 'merge',
        rebaseFirst: options.rebaseFirst,
        localOnly: options.localOnly,
      }),
    ),
  );
  if (!result.success) {
    // i18n-ignore (matching daemon error strings)
    const needsRebase = ['Conflicts detected', 'behind', 'Please rebase'].some((text) =>
      result.error?.includes(text),
    );
    if (needsRebase && !options.rebaseFirst)
      throw new MergeNeedsRebase(workspaceId, options.targetBranch);
    throw new Error(result.error || m.workspace_mergePanel_mergeFailed_error());
  }
  yield* call(merged, workspaceId, options.mergeHeadSha);
  const form = yield* selectAcceptChangesState.effect(workspaceId);
  if (form.commitMessage === options.commitMessage) yield* put(setCommitMessage(workspaceId, ''));
  if (result.result?.autoRebased && result.result.newBaseSha) {
    try {
      yield* call(persistBase, workspaceId, result.result.newBaseSha, lease);
    } catch {
      /* Merge succeeded; a failed boundary refresh must not report the merge as failed. */
    }
  }
  yield* call(
    notify.success,
    result.result?.autoRebased
      ? m.workspace_mergePanel_rebasedAndMerged_label({ branch: options.targetBranch })
      : m.workspace_mergePanel_merged_label({ branch: options.targetBranch }),
  );
  return result;
}

function* mergePRWorkflow(
  action: ReturnType<typeof mergePRWorkflowRequested>,
  lease: GitMutationLease,
): SagaGenerator<AcceptChangesResult> {
  const [workspaceId, options] = action.payload;
  const result = yield* call(() =>
    lease.run(() =>
      acceptChangesTransport.mergePR(workspaceId as WorkspaceId, options.prNumber, options),
    ),
  );
  if (!result.success)
    throw new Error(result.error || m.workspace_mergePanel_prMergeFailed_error());
  yield* call(merged, workspaceId, options.mergeHeadSha);
  yield* put(refreshPRStatusRequested(workspaceId, true, false));
  yield* call(
    notify.success,
    m.workspace_mergePanel_prMergedOnGithub_label({ number: options.prNumber }),
  );
  return result;
}

function* resetWorkflow(
  action: ReturnType<typeof resetAndContinueRequested>,
  lease: GitMutationLease,
): SagaGenerator<AcceptChangesResult> {
  const [workspaceId] = action.payload;
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) throw new Error(m.workspace_postMerge_resetFailed_error());
  const result = yield* call(() =>
    lease.run(() => acceptChangesTransport.resetToTrunk(workspaceId as WorkspaceId)),
  );
  if (!result.success || !result.result?.newHeadSha)
    throw new Error(result.error || m.workspace_postMerge_resetFailed_error());
  let refreshFailed = false;
  try {
    yield* call(persistBase, workspaceId, result.result.newHeadSha, lease);
  } catch {
    refreshFailed = true;
  }
  const previous = yield* selectPostMergeState.effect(workspaceId);
  yield* put(
    setPostMergeState(workspaceId, {
      ...previous,
      isMergedToTrunk: false,
      mergeHeadSha: null,
      isContentMergedToTrunk: false,
      hasResetToTrunk: true,
    }),
  );
  yield* call(
    notify.success,
    refreshFailed
      ? m.workspace_postMerge_resetSuccessReload_label()
      : m.workspace_postMerge_resetSuccess_label(),
  );
  if (workspace.archived) {
    try {
      yield* call(requireOwner, workspaceId);
      const unarchive = yield* call(() => lease.run(() => workspaceClient.unarchive(workspace.id)));
      if (unarchive.ok) yield* put(loadWorkspacesRequested());
    } catch {
      /* Reset succeeded; unarchive is best-effort. */
    }
  }
  return result;
}

function* archiveWorkflow(
  action: ReturnType<typeof archiveAndStartRequested>,
  lease: GitMutationLease,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) throw new Error(m.workspace_postMerge_archiveFailed_error());
  const result = yield* call(() => lease.run(() => workspaceClient.archive(workspace.id)));
  if (!result.ok) throw new Error(m.workspace_postMerge_archiveFailed_error());
  yield* put(loadWorkspacesRequested());
  const repo = workspace.repositoryPath;
  if (repo && repo !== workspace.worktreePath && !isDaemonManagedRepoPath(repo)) {
    yield* call(
      [sessionStorage, sessionStorage.setItem],
      'workspace-prefill',
      JSON.stringify({ repoPath: repo }),
    );
  }
  yield* put(setShowCreateModal(true));
}

function* undoWorkflow(
  action: ReturnType<typeof undoAcceptRequested>,
  lease: GitMutationLease,
): SagaGenerator<AcceptChangesResult> {
  const [workspaceId, options] = action.payload;
  const commits = yield* selectFileTrackingCommits.effect(workspaceId);
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  const index = commits.findIndex((commit) => commit.hash === options.commitHash);
  const upToCommitHash = commits[index + 1]?.hash ?? workspace?.baseCommitSha;
  if (index < 0 || !upToCommitHash) throw new Error(m.workspace_commitsTimeline_cannotUndo_error());
  const selected = commits
    .slice(0, index + 1)
    .filter((commit) => (options.action === 'undo-push' ? commit.isPushed : !commit.isPushed));
  const undoCommitsMetadata: UndoCommitMetadata[] = [];
  if (options.action === 'undo-commit') {
    for (const commit of selected) {
      let files = commit.files?.map((file) => file.path);
      if (!files) {
        try {
          const details = yield* call(() =>
            lease.run(() => appClient.git.commitDetails(workspaceId, commit.hash)),
          );
          files = details?.files ?? [];
        } catch {
          files = [];
        }
      }
      undoCommitsMetadata.push({
        hash: commit.hash,
        agentId: commit.agentId,
        linkedNoteId: commit.linkedNoteId,
        files,
      });
    }
  }
  yield* call(requireOwner, workspaceId);
  const result = yield* call(() =>
    lease.run(() =>
      acceptChangesTransport.execute(workspaceId as WorkspaceId, options.action, {
        upToCommitHash,
        ...(options.action === 'undo-commit' ? { undoCommitsMetadata } : {}),
      }),
    ),
  );
  if (!result.success)
    throw new Error(
      result.error ||
        (options.action === 'undo-commit'
          ? m.workspace_commitsTimeline_undoCommitFailed_error()
          : m.workspace_commitsTimeline_undoPushFailed_error()),
    );
  yield* call(
    notify.warning,
    options.action === 'undo-commit'
      ? selected.length === 1
        ? m.workspace_commitsTimeline_commitsUndone_one()
        : m.workspace_commitsTimeline_commitsUndone_many({ count: formatInteger(selected.length) })
      : selected.length === 1
        ? m.workspace_commitsTimeline_removedFromRemote_one()
        : m.workspace_commitsTimeline_removedFromRemote_many({
            count: formatInteger(selected.length),
          }),
  );
  return result;
}

/** Root lifetime: mounted components render state, and cannot replay completed workflows. */
export function* acceptWorkflowSaga(): SagaGenerator<void> {
  const activeUI = new Set<string>();
  function* ui<A extends { payload: [string, ...unknown[]] }>(
    kind: AcceptOperationKind,
    work: (action: A, lease: GitMutationLease) => SagaGenerator<unknown>,
    action: A,
  ): SagaGenerator<void> {
    const [workspaceId] = action.payload;
    const key = JSON.stringify([workspaceId, kind]);
    if (activeUI.has(key)) return;
    activeUI.add(key);
    try {
      yield* runOperation(workspaceId, kind, function* (lease) {
        return yield* call(work, action, lease);
      });
    } finally {
      activeUI.delete(key);
    }
  }
  yield* all([
    takeEvery(prepareAcceptRequested, prepare),
    takeEvery(executeAcceptRequested, execute),
    takeEvery(mergePRAcceptRequested, mergePR),
    takeEvery(addAcceptRemoteRequested, addRemote),
    takeEvery(resetAcceptToTrunkRequested, resetToTrunk),
    takeEvery(mergeToTrunkRequested, function* (action) {
      yield* ui('merge', mergeWorkflow, action);
    }),
    takeEvery(mergePRWorkflowRequested, function* (action) {
      yield* ui('mergePRWorkflow', mergePRWorkflow, action);
    }),
    takeEvery(resetAndContinueRequested, function* (action) {
      yield* ui('resetAndContinue', resetWorkflow, action);
    }),
    takeEvery(archiveAndStartRequested, function* (action) {
      yield* ui('archiveAndStart', archiveWorkflow, action);
    }),
    takeEvery(undoAcceptRequested, function* (action) {
      yield* ui('undo', undoWorkflow, action);
    }),
  ]);
}
