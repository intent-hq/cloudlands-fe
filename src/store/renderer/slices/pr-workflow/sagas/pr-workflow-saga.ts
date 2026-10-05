import {
  all,
  call,
  cancelled,
  delay,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { acceptChangesTransport } from '$features/accept-changes/accept-changes.transport';
import { gitClient } from '$features/git/git.client';
import { gitCache } from '$features/git/git-cache';
import { invoke } from '$shared/generated/ipc-client';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store } from '../../../store';
import { reserveGitMutation, type GitMutationLease } from '../../../utils/worktree-mutation-queue';
import {
  selectIsWorkspaceCollaborator,
  selectWorkspaceById,
} from '../../workspace/workspace-selectors';
import { setWorkspaceEntity } from '../../workspace/workspace-slice';
import { selectGitHubAuthIsAuthenticated } from '../../github-auth/github-auth-selectors';
import { initializeGitHubAuth } from '../../github-auth/github-auth-slice';
import {
  clearOlderCommits,
  refreshAcceptChangesStatus,
  refreshRequested,
  setCommitMessage,
  setPendingAutoAction,
  setPRContent,
  setSidebarCommitWhenReady,
  setSidebarCreatePRWhenReady,
  setSidebarMergeWhenReady,
} from '../../changes/changes-slice';
import {
  selectAcceptChangesState,
  selectStagedWorkingChanges,
  selectFileTrackingCommits,
} from '../../changes/changes-selectors';
import { selectExecutorState } from '../../background-agent-executor/background-agent-executor-selectors';
import {
  setExecutorState,
  resetExecutor,
  cancelExecution,
} from '../../background-agent-executor/background-agent-executor-slice';
import {
  mergeToTrunkRequested,
  setMergeDrawerOpen,
} from '../../accept-workflow/accept-workflow-slice';
import { selectMergeOptions } from '../../accept-workflow/accept-workflow-selectors';
import { gitReadsInvalidated, loadGitStatus, setGitOperationFlag } from '../../git/git-slice';
import type { GitOperationFlagName } from '../../git/git-types';
import { refreshPRStatusRequested } from '../../pr-status/pr-status-slice';
import { addTerminal, openTerminalOverlay } from '../../terminals/terminals-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectPRWorkflow } from '../pr-workflow-selectors';
import {
  prWorkflowRequested,
  prCreatorRequested,
  resumePRWorkflowAfterAuth,
  setPRWorkflowDrawer,
  setPRWorkflowPendingAuth,
} from '../pr-workflow-slice';
import type { PRWorkflowCommand, PRWorkflowResult } from '../pr-workflow-types';

// Preserve the sidebar refresh acknowledgement window, not an animation duration.
const REFRESH_MIN_VISIBLE_MS = 300;

const flags: Partial<Record<PRWorkflowCommand['kind'], GitOperationFlagName>> = {
  push: 'isPushing',
  pull: 'isPulling',
  'force-push': 'isForcePushing',
  rebase: 'isRebasing',
  'refresh-pr': 'isRefreshingPR',
  refresh: 'isRefreshingGitStatus',
};

function* reconcile(workspaceId: string, includeWorkspace = false): SagaGenerator<void> {
  gitCache.invalidateWorkspace(WorkspaceId(workspaceId));
  yield* put(gitReadsInvalidated(workspaceId));
  yield* put(loadGitStatus(workspaceId, true));
  yield* put(refreshRequested(workspaceId, true));
  if (!(yield* selectIsWorkspaceCollaborator.effect(workspaceId)))
    yield* put(refreshAcceptChangesStatus(workspaceId));
  if (includeWorkspace) {
    try {
      const workspace = yield* call([appClient.workspaces, appClient.workspaces.get], workspaceId);
      if (workspace) yield* put(setWorkspaceEntity(workspace, { detailRead: true }));
    } catch {
      // A completed mutation stays successful when a subsequent read fails.
    }
  }
}

function* perform(
  workspaceId: string,
  command: PRWorkflowCommand,
  lease: GitMutationLease,
): SagaGenerator<PRWorkflowResult> {
  const wsId = WorkspaceId(workspaceId);
  switch (command.kind) {
    case 'commit': {
      if (!command.commitMessage.trim())
        return {
          success: false,
          error: m.acceptChanges_backgroundGit_commitMessageRequired_error(),
        };
      const result = yield* call(() =>
        lease.run(() =>
          appClient.git.commit(workspaceId, {
            message: command.commitMessage.trim(),
            userRequested: true,
          }),
        ),
      );
      if (result.success) {
        yield* put(setCommitMessage(workspaceId, ''));
        yield* put(setPRWorkflowDrawer(workspaceId, 'commitDrawerOpen', false));
      }
      return result;
    }
    case 'prepare-pr': {
      const workspace = yield* selectWorkspaceById.effect(workspaceId);
      const prepared = yield* call(() =>
        lease.run(() => acceptChangesTransport.prepare(wsId, 'create-pr')),
      );
      const title = prepared.suggestedPRTitle || workspace?.title || '';
      const description = prepared.suggestedPRBody || '';
      yield* put(setPRContent(workspaceId, title, description));
      if (!command.createAfter) return { success: true };
      return yield* perform(
        workspaceId,
        {
          kind: 'create-pr',
          prTitle: title,
          prDescription: description,
          targetBranch: workspace?.baseRef || 'main',
        },
        lease,
      );
    }
    case 'create-pr': {
      const prTitle = command.prTitle.trim();
      if (!prTitle)
        return { success: false, error: m.acceptChanges_backgroundGit_prTitleRequired_error() };
      if (command.hasStaged) {
        const committed = yield* call(() =>
          lease.run(() =>
            acceptChangesTransport.execute(wsId, 'commit', { commitMessage: prTitle }),
          ),
        );
        if (!committed.success)
          return {
            success: false,
            error: committed.error || m.acceptChanges_backgroundGit_commitStagedFailed_error(),
          };
      }
      const result = yield* call(() =>
        lease.run(() =>
          acceptChangesTransport.execute(wsId, 'create-pr', {
            prTitle,
            prBody: command.prDescription.trim(),
            targetBranch: command.targetBranch,
          }),
        ),
      );
      if (!result.success)
        return {
          success: false,
          error: result.error || m.acceptChanges_backgroundGit_createPrFailed_error(),
          ...(result.error?.toLowerCase().includes('github authentication')
            ? { needsAuth: true }
            : {}),
        };
      yield* put(setPRWorkflowDrawer(workspaceId, 'prDrawerOpen', false));
      yield* put(setPRContent(workspaceId, '', ''));
      return {
        success: true,
        prNumber: result.result?.prNumber,
        prHtmlUrl: result.result?.prHtmlUrl || result.result?.prUrl,
      };
    }
    case 'push': {
      const result = yield* call(() =>
        lease.run(() =>
          acceptChangesTransport.execute(wsId, 'push', {
            targetBranch: command.targetBranch,
            upToCommitHash: command.upToCommitHash,
          }),
        ),
      );
      return { success: result.success, error: result.error };
    }
    case 'pull': {
      const workspace = yield* selectWorkspaceById.effect(workspaceId);
      const path = workspace?.worktreePath || workspace?.path;
      const branch = workspace?.branch;
      if (!path || !branch)
        return { success: false, error: m.workspace_prSection_pullUnavailable_error() };
      const result = yield* call(() =>
        lease.run(() => appClient.git.pull(path, branch, workspaceId)),
      );
      if (result.success) yield* call(notify.success, m.workspace_prSection_pullSuccess_label());
      return result;
    }
    case 'force-push': {
      const result = yield* call(() => lease.run(() => gitClient.push(wsId, undefined, true)));
      if (!result.ok) return { success: false, error: result.error };
      yield* put(setPRWorkflowDrawer(workspaceId, 'forcePushDrawerOpen', false));
      yield* call(notify.warning, m.workspace_prSection_forcePushDone_label());
      return { success: true };
    }
    case 'refresh-pr': {
      // Fetch failure does not prevent the existing PR-status owner refreshing the forge.
      yield* call(() => lease.run(() => gitClient.fetch(wsId)));
      yield* put(refreshPRStatusRequested(workspaceId, true, true));
      return { success: true };
    }
    case 'rebase': {
      const result = yield* call(() =>
        lease.run(() => acceptChangesTransport.execute(wsId, 'rebase-onto-trunk')),
      );
      if (!result.success) {
        const error = result.error || m.workspace_prSection_rebaseFailed_error();
        const details = result.steps
          .filter((step) => step.status === 'failed' && step.error && step.error !== error)
          .map((step) => step.error);
        return { success: false, error: [error, ...details].join('\n') };
      }
      yield* put(clearOlderCommits(workspaceId));
      const newBaseSha = result.result?.newBaseSha;
      if (newBaseSha) {
        const updated = yield* call(() =>
          lease.run(() => appClient.workspaces.update({ id: wsId, baseCommitSha: newBaseSha })),
        );
        if (updated.success && updated.workspace) yield* put(setWorkspaceEntity(updated.workspace));
      }
      yield* call(
        notify.success,
        m.workspace_prSection_rebasedOnto_label({ branch: command.trunkBranch }),
      );
      return { success: true };
    }
    case 'connect-remote':
      yield* call(() =>
        lease.run(() => acceptChangesTransport.addRemote(wsId, command.remoteUrl.trim())),
      );
      yield* put(setPRWorkflowDrawer(workspaceId, 'connectRemoteDrawerOpen', false));
      yield* call(notify.success, m.workspace_prSection_remoteAdded_label());
      return { success: true };
    case 'rebase-terminal': {
      const workspace = yield* selectWorkspaceById.effect(workspaceId);
      const cwd = workspace?.worktreePath || workspace?.repositoryPath;
      if (!cwd) return { success: false, error: m.workspace_commitsTimeline_noSpacePath_error() };
      const branch = command.targetBranch;
      const title = m.workspace_prSection_rebaseOnto_label({ branch });
      const result = yield* call(() =>
        lease.run(() =>
          invoke<{ ok: boolean; terminalId?: string; error?: string }>(
            'terminal:createWithCommand',
            {
              workspaceId,
              command: `git fetch origin ${branch} && git rebase origin/${branch}`,
              cwd,
              title,
            },
          ),
        ),
      );
      if (!result.ok || !result.terminalId)
        return {
          success: false,
          error: result.error || m.workspace_commitsTimeline_openTerminalFailed_error(),
        };
      yield* put(addTerminal(workspaceId, result.terminalId, title));
      yield* put(openTerminalOverlay(workspaceId, result.terminalId));
      yield* call(notify.success, m.workspace_sidebarChanges_rebaseStarted_label(), {
        description: m.workspace_sidebarChanges_rebaseStarted_description(),
      });
      return { success: true };
    }
    case 'refresh':
      return { success: true };
  }
}

function* reportFailure(
  workspaceId: string,
  command: PRWorkflowCommand,
  error: string,
): SagaGenerator<void> {
  // i18n-ignore (matching backend error strings)
  if (command.kind === 'push' && /Pull the latest changes|behind/.test(error)) {
    const workspace = yield* selectWorkspaceById.effect(workspaceId);
    const targetBranch = command.targetBranch || workspace?.branch || 'HEAD';
    yield* call(notify.error, m.workspace_commitsTimeline_remoteHasNewCommits_error(), {
      description: m.workspace_commitsTimeline_pullBeforePush_description(),
      action: {
        label: m.workspace_commitsTimeline_pullInTerminal_label(),
        onClick: () => {
          store.dispatch(
            prWorkflowRequested(workspaceId, { kind: 'rebase-terminal', targetBranch }),
          );
        },
      },
    });
    return;
  }
  yield* call(notify.error, error);
}

function* worker(
  action: ReturnType<typeof prWorkflowRequested>,
  lifetime: { ended: boolean },
): SagaGenerator<void> {
  const { workspaceId, command } = action.payload;
  const flag = flags[command.kind];
  const shouldReconcile = command.kind !== 'prepare-pr' || command.createAfter;
  const includeWorkspace =
    command.kind === 'create-pr' || command.kind === 'rebase' || command.kind === 'prepare-pr';
  let lease: GitMutationLease | undefined;
  let started = false;
  try {
    if (command.kind !== 'refresh' && (yield* selectIsWorkspaceCollaborator.effect(workspaceId))) {
      yield* put(
        action.success({ success: false, error: m.workspace_gitError_permissionDenied() }),
      );
      return;
    }
    if (
      (command.kind === 'create-pr' || command.kind === 'refresh-pr') &&
      command.requireAuth &&
      !(yield* selectGitHubAuthIsAuthenticated.effect())
    ) {
      yield* put(initializeGitHubAuth());
      yield* put(setPRWorkflowPendingAuth(workspaceId, command));
      yield* call(notify.info, m.workspace_prSection_connectGithub_label());
      yield* put(action.success({ success: false, needsAuth: true }));
      return;
    }
    const reservation = reserveGitMutation(workspaceId);
    lease = reservation;
    yield* call(() => reservation.ready);
    if (command.kind !== 'refresh' && (yield* selectIsWorkspaceCollaborator.effect(workspaceId))) {
      yield* put(
        action.success({ success: false, error: m.workspace_gitError_permissionDenied() }),
      );
      return;
    }
    started = true;
    const startedAt = Date.now();
    if (flag) yield* put(setGitOperationFlag(workspaceId, flag, true));
    const result = yield* call(perform, workspaceId, command, lease);
    yield* call(() => lease?.release());
    if (result.needsAuth) yield* put(setPRWorkflowPendingAuth(workspaceId, command));
    if (!result.success && !result.needsAuth)
      yield* call(
        reportFailure,
        workspaceId,
        command,
        result.error || m.workspace_prCreator_createFailed_error(),
      );
    if (shouldReconcile) yield* call(reconcile, workspaceId, includeWorkspace);
    // Reads are routed, not awaited. Keep feedback visible without retaining the
    // transport lease; cancellation still goes straight to the existing cleanup.
    if (command.kind === 'refresh') {
      const remaining = REFRESH_MIN_VISIBLE_MS - (Date.now() - startedAt);
      if (remaining > 0) yield* delay(remaining);
    }
    yield* put(action.success(result));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : m.workspace_prCreator_createFailed_error();
    const needsAuth =
      command.kind === 'create-pr' && message.toLowerCase().includes('github authentication');
    yield* call(() => lease?.release());
    if (started && shouldReconcile) yield* call(reconcile, workspaceId, includeWorkspace);
    if (needsAuth) yield* put(setPRWorkflowPendingAuth(workspaceId, command));
    else yield* call(reportFailure, workspaceId, command, message);
    yield* put(
      action.success({ success: false, error: message, ...(needsAuth ? { needsAuth: true } : {}) }),
    );
  } finally {
    if (yield* cancelled())
      yield* put(action.success({ success: false, error: 'Git workflow cancelled' })); // i18n-ignore (compatibility cancellation outcome)
    if (flag && started && !lifetime.ended)
      yield* put(setGitOperationFlag(workspaceId, flag, false));
    lease?.release();
  }
}

function* waitForWorkspaceUnmount(workspaceId: string): SagaGenerator<void> {
  while (true) {
    const {
      payload: [endedWorkspaceId],
    } = yield* take(workspaceUnmounted);
    if (endedWorkspaceId === workspaceId) return;
  }
}

function* endOfLifetime(workspaceId: string, lifetime: { ended: boolean }): SagaGenerator<void> {
  // Reconnects do not cancel or replay mutations: the existing transport may
  // still commit, so retain its lease and report its real outcome before reads.
  yield* call(waitForWorkspaceUnmount, workspaceId);
  lifetime.ended = true;
}

function* runWorkflow(action: ReturnType<typeof prWorkflowRequested>): SagaGenerator<void> {
  const lifetime = { ended: false };
  yield* race({
    operation: call(worker, action, lifetime),
    ended: call(endOfLifetime, action.payload.workspaceId, lifetime),
  });
}

function* resumeAfterAuth({
  payload: [workspaceId],
}: ReturnType<typeof resumePRWorkflowAfterAuth>): SagaGenerator<void> {
  if (!(yield* selectGitHubAuthIsAuthenticated.effect())) return;
  const { pendingAuth } = yield* selectPRWorkflow.effect(workspaceId);
  if (!pendingAuth) return;
  yield* put(setPRWorkflowPendingAuth(workspaceId, null));
  yield* put(prWorkflowRequested(workspaceId, pendingAuth));
}

function* pendingAutoAction({
  payload: [workspaceId, pending],
}: ReturnType<typeof setPendingAutoAction>): SagaGenerator<void> {
  // Native review owns its prepared intent and explicit confirmation in the original sidebar.
  if (!pending || pending.action === 'native-review') return;
  yield* put(setPendingAutoAction(workspaceId, null));
  if (yield* selectIsWorkspaceCollaborator.effect(pending.workspaceId)) return;
  const draft = yield* selectAcceptChangesState.effect(pending.workspaceId);
  if (pending.action === 'commit')
    yield* put(
      prWorkflowRequested(pending.workspaceId, {
        kind: 'commit',
        commitMessage: draft.commitMessage,
      }),
    );
  if (pending.action === 'create-pr') {
    const staged = yield* selectStagedWorkingChanges.effect(pending.workspaceId);
    yield* put(
      prWorkflowRequested(pending.workspaceId, {
        kind: 'create-pr',
        prTitle: draft.prTitle,
        prDescription: draft.prDescription,
        targetBranch: pending.targetBranch,
        hasStaged: staged.length > 0,
        requireAuth: true,
      }),
    );
  }
  if (pending.action === 'merge') {
    const options = yield* selectMergeOptions.effect(pending.workspaceId);
    const staged = yield* selectStagedWorkingChanges.effect(pending.workspaceId);
    const commits = yield* selectFileTrackingCommits.effect(pending.workspaceId);
    const workspace = yield* selectWorkspaceById.effect(pending.workspaceId);
    yield* put(
      mergeToTrunkRequested(pending.workspaceId, {
        hasStaged: staged.length > 0,
        commitMessage: draft.commitMessage,
        targetBranch: draft.targetBranch || workspace?.baseRef || 'main',
        mergeHeadSha: commits[0]?.hash ?? null,
        squash: options.squash,
        localOnly: !options.pushAfter,
      }),
    );
    yield* put(setMergeDrawerOpen(pending.workspaceId, false));
  }
}

function* executorResult({
  payload: [workspaceId, kind, updates],
}: ReturnType<typeof setExecutorState>): SagaGenerator<void> {
  if (!['commit', 'commit-merge', 'pr'].includes(kind)) return;
  if (updates.status !== 'success' || !updates.result) return;
  const executor = yield* selectExecutorState.effect(workspaceId, kind);
  const draft = yield* selectAcceptChangesState.effect(workspaceId);
  if (kind === 'pr') {
    const [heading, ...body] = updates.result.trim().split('\n');
    yield* put(
      setPRContent(workspaceId, heading.replace(/^#\s*/, '').trim(), body.join('\n').trim()),
    );
    yield* put(setSidebarCreatePRWhenReady(workspaceId, false));
    if (draft.createPRWhenReady)
      yield* put(
        setPendingAutoAction(workspaceId, {
          action: 'create-pr',
          workspaceId,
          targetBranch: executor.executionContext?.targetBranch,
        }),
      );
  } else {
    yield* put(setCommitMessage(workspaceId, updates.result));
    if (kind === 'commit') {
      yield* put(setSidebarCommitWhenReady(workspaceId, false));
      if (draft.commitWhenReady)
        yield* put(setPendingAutoAction(workspaceId, { action: 'commit', workspaceId }));
    } else {
      yield* put(setSidebarMergeWhenReady(workspaceId, false));
      if (draft.mergeWhenReady)
        yield* put(setPendingAutoAction(workspaceId, { action: 'merge', workspaceId }));
    }
  }
  yield* put(resetExecutor(workspaceId, kind));
}

function* creatorWorker(action: ReturnType<typeof prCreatorRequested>): SagaGenerator<void> {
  const [workspaceId, generate, requestId] = action.payload;
  const draft = yield* selectAcceptChangesState.effect(workspaceId);
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  const command: PRWorkflowCommand = generate
    ? { kind: 'prepare-pr', createAfter: true }
    : {
        kind: 'create-pr',
        prTitle: draft.prTitle,
        prDescription: draft.prDescription,
        targetBranch: workspace?.baseRef || 'main',
      };
  const request = prWorkflowRequested(workspaceId, command, requestId);
  try {
    yield* put(request);
    const result = yield* call(() => request.promise);
    if (result.success) yield* delay(2000);
    yield* put(action.success(result));
  } finally {
    if (yield* cancelled()) yield* put(action.success({ success: false }));
  }
}

function* creator(action: ReturnType<typeof prCreatorRequested>): SagaGenerator<void> {
  yield* race({
    operation: call(creatorWorker, action),
    ended: call(endOfLifetime, action.payload[0], { ended: false }),
  });
}

function* stopExecutorFollowups({
  payload: [workspaceId],
}: ReturnType<typeof workspaceUnmounted>): SagaGenerator<void> {
  for (const kind of ['commit', 'commit-merge', 'pr'])
    yield* put(cancelExecution(workspaceId, kind));
  yield* put(setSidebarCommitWhenReady(workspaceId, false));
  yield* put(setSidebarCreatePRWhenReady(workspaceId, false));
  yield* put(setSidebarMergeWhenReady(workspaceId, false));
}

/** Root-owned PR workflows. Existing PR status and monitor sagas remain their sole read owners. */
export function* prWorkflowSaga(): SagaGenerator<void> {
  yield* all([
    takeEvery(prWorkflowRequested, runWorkflow),
    takeEvery(resumePRWorkflowAfterAuth, resumeAfterAuth),
    takeEvery(setPendingAutoAction, pendingAutoAction),
    takeEvery(setExecutorState, executorResult),
    takeEvery(prCreatorRequested, creator),
    takeEvery(workspaceUnmounted, stopExecutorFollowups),
  ]);
}
