import { call, put, type SagaGenerator } from 'typed-redux-saga';
import { appClient, type MutationResult } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { acceptChangesTransport } from '$features/accept-changes/accept-changes.transport';
import { gitCache } from '$features/git/git-cache';
import { reconcileGitStatusChanges } from '$features/file-tracking/git-status-reconciliation';
import { ChangeStage } from '$features/file-tracking/types';
import { notify } from '$lib/components/patterns/notify';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceId } from '$shared/types';
import { hasNodeOwnedAgentPath } from '$shared/utils/agent-node';
import { posixSingleQuote } from '$shared/utils/posix-single-quote';
import { SYSTEM_CHANNELS } from '$shared/ipc/channels';
import type { GitMutationLease } from '../../../utils/worktree-mutation-queue';
import { selectLockedAgentIds } from '../../agent-lock/agent-lock-selectors';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { selectFileTrackingChanges } from '../../changes/changes-selectors';
import { refreshRequested, setChangesData } from '../../changes/changes-slice';
import { openWorkspaceDiff } from '../../workspace-navigation/workspace-navigation-slice';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { selectGitStatus } from '../git-selectors';
import { gitReadsInvalidated, setGitStatus } from '../git-slice';
import { selectGitWriteOperation } from '../git-write-selectors';
import { createGitWriteSaga } from './git-write-saga-factory';
import type { GitWriteOperation } from '../git-write-types';

const logger = createLogger('GitWriteSaga');

function assertSuccess(result: MutationResult): void {
  if (!result.success) throw new Error(result.error || m.workspace_prSection_unknownError_label());
}

/** Preserve Timeline's shell transport and upstream fallback as one Git lease. */
async function amendCommit(
  workspaceId: string,
  operation: Extract<GitWriteOperation, { kind: 'amend' }>,
): Promise<MutationResult> {
  type CommandResult = MutationResult & { data?: { stdout?: string; stderr?: string } };
  const execute = (command: string) =>
    invoke<CommandResult>(SYSTEM_CHANNELS.EXECUTE_COMMAND, {
      command,
      cwd: operation.cwd,
      workspaceId,
    });
  // Existing POSIX quoting contract; cmd.exe does not honor single quotes.
  const amended = await execute(`git commit --amend -m ${posixSingleQuote(operation.message)}`);
  assertSuccess(amended);
  if (operation.wasPushed) {
    let pushed = await execute('git push --force-with-lease');
    if (!pushed.success && pushed.data?.stderr?.includes('has no upstream branch')) {
      const branch = await execute('git rev-parse --abbrev-ref HEAD');
      if (branch.success && branch.data?.stdout) {
        pushed = await execute(
          `git push --force-with-lease --set-upstream origin ${branch.data.stdout.trim()}`,
        );
      }
    }
    assertSuccess(pushed);
  }
  return { success: true };
}

/** One transport-lifetime transaction: cancellation cannot strand a temporary index. */
async function commitPartialGroup(
  workspaceId: string,
  operation: Extract<GitWriteOperation, { kind: 'partialCommit' }>,
  cwd?: string,
): Promise<MutationResult> {
  const before = await appClient.git.status(workspaceId, { forceRefresh: true });
  if (!before) return { success: false, error: m.workspace_fileChanges_commitFailed_error() };
  const targets = new Set(operation.paths);
  const staged = before.files.filter((file) => file.staged).map((file) => file.path);
  const unstaged = new Set(before.files.filter((file) => !file.staged).map((file) => file.path));
  const otherStaged = staged.filter((path) => !targets.has(path));
  const newlyStaged =
    operation.section === 'unstaged'
      ? operation.paths.filter((path) => !staged.includes(path))
      : [];
  // Snapshot before ANY index mutation. Display diffs lose binary/mode/newline
  // information, so preserve Git's raw patch and replay it unchanged. Keep the
  // patch transport-local: never log it or put file content in Redux.
  const snapshots = new Map<string, string>();
  for (const path of staged) {
    if (!unstaged.has(path) || (targets.has(path) && operation.section === 'staged')) continue;
    const captured = await backendRequest<{
      stdout: string;
      stderr: string;
      exitCode: number;
      timedOut?: boolean;
    }>('host.exec', {
      workspaceId,
      ...(cwd ? { cwd } : {}),
      command: 'git',
      args: [
        '--literal-pathspecs',
        '-c',
        'core.quotePath=false',
        'diff',
        '--cached',
        '--binary',
        '--full-index',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--no-color',
        '--no-relative',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        '--',
        path,
      ],
      timeoutMs: 30_000,
    });
    // The existing daemon stageHunk contract requires an unquoted single-file
    // header. Validate compatibility before temporarily removing index content.
    if (
      captured.exitCode !== 0 ||
      captured.timedOut ||
      !captured.stdout.startsWith(`diff --git a/${path} b/${path}\n`)
    ) {
      return { success: false, error: m.workspace_fileChanges_commitFailed_error() };
    }
    snapshots.set(path, captured.stdout);
  }
  let committed = false;
  let result: MutationResult = { success: false };
  const restoreErrors: string[] = [];
  try {
    if (otherStaged.length) assertSuccess(await appClient.git.unstage(workspaceId, otherStaged));
    if (operation.section === 'unstaged')
      assertSuccess(await appClient.git.stage(workspaceId, operation.paths));
    const accepted = await acceptChangesTransport.execute(workspaceId as WorkspaceId, 'commit', {
      commitMessage: operation.message,
    });
    assertSuccess(accepted);
    committed = true;
    result = { success: true };
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    // Attempt every restoration even if an earlier restoration fails. A failed
    // stage can have partially applied; unstaging the new paths is idempotent.
    if (!committed && newlyStaged.length) {
      try {
        assertSuccess(await appClient.git.unstage(workspaceId, newlyStaged));
      } catch (error) {
        restoreErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    const wholePaths = otherStaged.filter((path) => !snapshots.has(path));
    if (wholePaths.length) {
      try {
        assertSuccess(await appClient.git.stage(workspaceId, wholePaths));
      } catch (error) {
        restoreErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    for (const [filePath, hunkPatch] of snapshots) {
      if (committed && targets.has(filePath)) continue;
      try {
        // Reset first: a failed stage/unstage may have partially applied.
        assertSuccess(await appClient.git.unstage(workspaceId, [filePath]));
        await backendRequest('git.stageHunk', { workspaceId, filePath, hunkPatch });
      } catch (error) {
        restoreErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  // Restoration is a separate outcome: an already-created commit must never
  // become a failed commit (which would invite a duplicate retry).
  return restoreErrors.length
    ? { ...result, error: [result.error, ...restoreErrors].filter(Boolean).join('; ') }
    : result;
}

function* reconcile(
  workspaceId: string,
  requestId: string,
  lease: GitMutationLease,
  canPublish: () => boolean,
): SagaGenerator<void> {
  try {
    const status = yield* call(() =>
      lease.run(() => appClient.git.status(workspaceId, { forceRefresh: true })),
    );
    const current = yield* selectGitWriteOperation.effect(workspaceId, requestId);
    if (!status || !current || current.consumerReleased || !canPublish()) return;
    yield* put(setGitStatus(workspaceId, status));
    const tracked = yield* selectFileTrackingChanges.effect(workspaceId);
    const changes = reconcileGitStatusChanges(status.files, tracked);
    if (canPublish()) yield* put(setChangesData(workspaceId, changes, false, changes.length));
  } catch (error) {
    logger.error('Failed to reconcile Git mutation', error);
  }
}

function* notifyOutcome(operation: GitWriteOperation, result: MutationResult): SagaGenerator<void> {
  if (!operation.source) return;
  if (operation.kind === 'partialCommit' && result.success && result.error) {
    yield* call(() =>
      notify.warning(m.fileTracking_acceptChanges_changesCommitted_success(), {
        description: result.error,
      }),
    );
    return;
  }
  if (operation.kind === 'amend') {
    if (result.success) {
      yield* call(() =>
        notify.success(
          operation.wasPushed
            ? m.workspace_commitsTimeline_messageUpdatedPushed_label()
            : m.workspace_commitsTimeline_messageUpdated_label(),
        ),
      );
    } else {
      yield* call(() => notify.error(m.workspace_commitsTimeline_messageUpdateFailed_error()));
    }
    return;
  }
  const staged = operation.kind === 'stageHunk';
  if (operation.kind === 'stageHunk' || operation.kind === 'unstageHunk') {
    if (result.success) {
      const message =
        operation.source === 'chat'
          ? staged
            ? m.chat_changesPanel_hunkStaged_toast()
            : m.chat_changesPanel_hunkUnstaged_toast()
          : staged
            ? m.layout_diffTab_hunkStaged_toast()
            : m.layout_diffTab_hunkUnstaged_toast();
      yield* call(() => notify.success(message));
    } else {
      const fallback =
        operation.source === 'chat'
          ? staged
            ? m.chat_changesPanel_stageHunkFailed_error()
            : m.chat_changesPanel_unstageHunkFailed_error()
          : staged
            ? m.layout_diffTab_stageHunkFailed_error()
            : m.layout_diffTab_unstageHunkFailed_error();
      yield* call(() => notify.error(result.error || fallback));
    }
    return;
  }
  if (!result.success) {
    const title =
      operation.kind === 'stage'
        ? m.workspace_fileChanges_stageFailed_error()
        : operation.kind === 'unstage'
          ? m.workspace_fileChanges_unstageFailed_error()
          : operation.kind === 'discard'
            ? m.workspace_fileChanges_revertFailed_error()
            : m.workspace_fileChanges_commitFailed_error();
    yield* call(() =>
      notify.error(title, {
        description:
          result.error ||
          (operation.source === 'changes' || operation.source === 'localChanges'
            ? m.ui_workspaceActions_unknown_error()
            : m.workspace_prSection_unknownError_label()),
      }),
    );
  }
}

/** Source-only policy and transports stay bound here; the factory owns write lifetime. */
function* prepare(
  workspaceId: string,
  operation: GitWriteOperation,
): SagaGenerator<(() => Promise<MutationResult>) | undefined> {
  if (operation.sourceAgentId) {
    const agent = yield* selectAgentSession.effect(operation.sourceAgentId);
    if (!agent || hasNodeOwnedAgentPath(agent)) return;
  }
  if (operation.kind === 'partialCommit') {
    const locks = yield* selectLockedAgentIds.effect(workspaceId);
    if (operation.agentId && operation.agentId in locks)
      throw new Error(m.workspace_fileChanges_commitFailed_error());
    const workspace = yield* selectWorkspaceById.effect(workspaceId);
    return () =>
      commitPartialGroup(
        workspaceId,
        operation,
        workspace?.worktreePath || workspace?.repositoryPath,
      );
  }
  if (operation.kind === 'stageHunk' || operation.kind === 'unstageHunk') {
    if (
      !operation.hunkPatch.includes('@@') ||
      (!operation.hunkPatch.includes('---') && !operation.hunkPatch.includes('diff --git'))
    ) {
      throw new Error(
        operation.kind === 'stageHunk'
          ? m.chat_changesPanel_stageInvalidPatch_error()
          : m.chat_changesPanel_unstageInvalidPatch_error(),
      );
    }
    return async () => {
      await backendRequest(operation.kind === 'stageHunk' ? 'git.stageHunk' : 'git.unstageHunk', {
        workspaceId,
        filePath: operation.filePath,
        hunkPatch: operation.hunkPatch,
      });
      return { success: true };
    };
  }
  if (operation.kind === 'commit') return () => appClient.git.commit(workspaceId, operation.params);
  if (operation.kind === 'amend') return () => amendCommit(workspaceId, operation);
  if (operation.kind === 'stage' || operation.kind === 'unstage' || operation.kind === 'discard') {
    const kind = operation.kind;
    return () => appClient.git[kind](workspaceId, operation.paths);
  }
}

function* publish(
  workspaceId: string,
  operation: GitWriteOperation,
  result: MutationResult,
  canPublish: () => boolean,
): SagaGenerator<void> {
  if (!canPublish()) return;
  yield* put(gitReadsInvalidated(workspaceId));
  if (!canPublish()) return;
  yield* put(refreshRequested(workspaceId, true));
  if (
    result.success &&
    (operation.kind === 'stage' || operation.kind === 'unstage') &&
    operation.openDiff &&
    operation.paths.length === 1
  ) {
    const changes = yield* selectFileTrackingChanges.effect(workspaceId);
    const stage = operation.kind === 'stage' ? ChangeStage.Staged : ChangeStage.Unstaged;
    const change = changes.find(
      (row) => row.stage === stage && (row.relativePath || row.file) === operation.paths[0],
    );
    if (change && canPublish())
      yield* put(
        openWorkspaceDiff(workspaceId, change, {
          changeId: change.id,
          filePath: change.relativePath || change.file,
          forceUpdate: true,
        }),
      );
  }
  if (canPublish()) yield* notifyOutcome(operation, result);
}

export const gitWriteSaga = createGitWriteSaga({
  selectOperation: selectGitWriteOperation.effect,
  selectStatus: selectGitStatus.effect,
  prepare,
  reconcile,
  invalidate: (workspaceId) => gitCache.invalidateWorkspace(workspaceId),
  publish,
  unknownError: () => m.workspace_prSection_unknownError_label(),
  logError: (message, error) => logger.error(message, error),
});
