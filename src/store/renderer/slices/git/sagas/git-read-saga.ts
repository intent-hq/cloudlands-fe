import type { SagaGenerator } from 'typed-redux-saga';
import { call, cancelled, delay, join, put, takeEvery } from 'typed-redux-saga';

import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
import type { AcceptChangesResult } from '$features/accept-changes/types';
import { gitClient } from '$features/git/git.client';
import { gitCache } from '$features/git/git-cache';
import {
  batchedGitBranchBaseDiff,
  batchedGitDiff,
  dedupedGitNumstat,
  dedupedShowFile,
} from '$features/file-tracking/components/diff/diff-ipc-batcher';
import { appClient } from '$lib/client';
import type { MutationResult } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import type { CommitFile } from '$features/file-tracking/types';
import { SYSTEM_CHANNELS } from '$shared/ipc/channels';
import {
  LineType,
  PullRequestStatus,
  type CommitInfo,
  type GitStatus,
  type WorkspaceId,
  type DiffChunk,
} from '$shared/types';
import { posixSingleQuote } from '$shared/utils/posix-single-quote';
import { refreshAcceptChangesStatus, refreshRequested } from '../../changes/changes-slice';
import { refreshPRStatusRequested } from '../../pr-status/pr-status-slice';
import { updateWorkspaceEntity } from '../../workspace/workspace-slice';
import {
  takeLatestInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadGitStatus,
  loadGitBranches,
  readGitStatusRequested,
  loadCommitDetails,
  loadGitDiffs,
  readCommitDetailsRequested,
  readGitDiffsRequested,
  readGitBranchesRequested,
  readGitBranchStatusRequested,
  readGitFileRequested,
  loadGitEnrichment,
  setGitEnrichment,
  setGitEnrichmentError,
  stageGitHunkRequested,
  unstageGitHunkRequested,
  fetchGitRequested,
  pushGitRequested,
  pullGitRequested,
  setCommitDetails,
  setCommitDetailsError,
  setCommitDetailsLoading,
  setGitDiffs,
  setGitDiffsError,
  setGitDiffsLoading,
  setGitBranches,
  setGitBranchesError,
  setGitBranchStatus,
  setGitBranchStatusError,
  loadSecondaryRootCommitFiles,
  loadSecondaryRootGit,
  setGitStatus,
  setGitStatusReadError,
  setGitStatusReadResult,
  setSecondaryRootGit,
  setSecondaryRootGitError,
  setSecondaryRootGitLoading,
  setSecondaryRootCommitFiles,
  addGitRemoteRequested,
  amendCommitMessageRequested,
  createPullRequestRequested,
  executeAcceptChangesRequested,
  readAcceptChangesStatusRequested,
  prepareAcceptChangesRequested,
  mergePullRequestRequested,
  refreshPullRequestRequested,
  setGitOperationFlag,
} from '../git-slice';
import type { GitEnrichmentRequest, GitEnrichmentResult } from '../git-types';
import { gitFileReadKey } from '../utils/git-read-keys';
import { toGitStatus } from '../utils/git-status';

const logger = createLogger('GitReadSaga');
const BRANCH_LOAD_DEBOUNCE_MS = 150;
const BRANCH_CACHE_DURATION_MS = 5 * 60 * 1000;
const branchLoadCache = new Map<
  string,
  { data: ReturnType<typeof setGitBranches>['payload'][1]; timestamp: number }
>();

function* loadGitStatusWorker(workspaceId: string, forceRefresh?: boolean): SagaGenerator<void> {
  try {
    const status: GitStatus | null = yield* call(
      [appClient.git, appClient.git.status],
      workspaceId,
      ...(forceRefresh ? [{ forceRefresh: true }] : []),
    );
    if (status) yield* put(setGitStatus(workspaceId, toGitStatus(status)));
  } catch (error) {
    logger.error('Failed to load git status', error);
  }
}

type GitStatusReadAction = ReturnType<typeof loadGitStatus> | ReturnType<typeof workspaceUnmounted>;

function workspaceReadContext(action: GitStatusReadAction) {
  const workspaceId = action.payload[0];
  return action.type === workspaceUnmounted.type
    ? { context: workspaceId, cancel: true as const }
    : workspaceId;
}

async function readSecondaryRoot(
  workspaceId: string,
  gitRootId: string,
  registeredCommitSha: string | undefined,
  limit: number,
) {
  const [statusResult, firstPage] = await Promise.all([
    gitClient.getStatus(workspaceId as WorkspaceId, { gitRootId }),
    gitClient.getHistory(workspaceId as WorkspaceId, limit, { gitRootId }),
  ]);
  if (!statusResult.ok) throw new Error(statusResult.error);
  if (!firstPage.ok) throw new Error(firstPage.error);

  const commits: CommitInfo[] = [...firstPage.data.items];
  let nextToken = firstPage.data.nextToken;
  while (
    nextToken &&
    registeredCommitSha &&
    !commits.some((commit) => commit.hash === registeredCommitSha)
  ) {
    const page = await gitClient.getHistory(workspaceId as WorkspaceId, limit, {
      gitRootId,
      nextToken,
    });
    if (!page.ok) throw new Error(page.error);
    const seen = new Set(commits.map((commit) => commit.hash));
    commits.push(...page.data.items.filter((commit) => !seen.has(commit.hash)));
    nextToken = page.data.nextToken;
  }

  const statusPaths = statusResult.data.files.map((file) => file.path);
  const [details, unstagedDiffs, stagedDiffs] = await Promise.all([
    Promise.all(
      commits.map((commit) => appClient.git.commitDetails(workspaceId, commit.hash, { gitRootId })),
    ),
    statusPaths.length
      ? appClient.git.diffs(workspaceId, { paths: statusPaths, gitRootId }).catch((error) => {
          logger.warn('Failed to load secondary-root unstaged line counts', error);
          return [];
        })
      : Promise.resolve([]),
    statusPaths.length
      ? appClient.git
          .diffs(workspaceId, { paths: statusPaths, staged: true, gitRootId })
          .catch((error) => {
            logger.warn('Failed to load secondary-root staged line counts', error);
            return [];
          })
      : Promise.resolve([]),
  ]);
  const statsByStage = new Map<string, { additions: number; deletions: number }>();
  for (const [staged, diffs] of [
    [false, unstagedDiffs],
    [true, stagedDiffs],
  ] as const) {
    for (const diff of diffs) {
      let additions = 0;
      let deletions = 0;
      for (const hunk of diff.chunks) {
        for (const line of hunk.lines) {
          if (line.type === LineType.Addition) additions++;
          if (line.type === LineType.Deletion) deletions++;
        }
      }
      statsByStage.set(`${staged}:${diff.file}`, { additions, deletions });
    }
  }
  const status = {
    ...statusResult.data,
    files: statusResult.data.files.map((file) => ({
      ...file,
      ...(statsByStage.get(`${file.staged}:${file.path}`) ?? { additions: 0, deletions: 0 }),
    })),
  };
  const commitFiles: Record<string, CommitFile[] | null> = {};
  commits.forEach((commit, index) => {
    const detail = details[index];
    commitFiles[commit.hash] = detail
      ? detail.fileDetails.length > 0
        ? detail.fileDetails
        : detail.files.map((path) => ({ path, additions: 0, deletions: 0 }))
      : null;
  });
  return { status, commits, nextToken, commitFiles };
}

function* loadSecondaryRootWorker(
  versions: SecondaryRootReadVersions,
  action: ReturnType<typeof loadSecondaryRootGit>,
): SagaGenerator<void> {
  const [workspaceId, gitRootId, registeredCommitSha, limit = 30] = action.payload;
  const workspaceVersion = versions.workspaces.get(workspaceId) ?? 0;
  yield* put(setSecondaryRootGitLoading(workspaceId, gitRootId));
  try {
    const data = yield* call(readSecondaryRoot, workspaceId, gitRootId, registeredCommitSha, limit);
    if ((versions.workspaces.get(workspaceId) ?? 0) !== workspaceVersion) return;
    yield* put(setSecondaryRootGit(workspaceId, gitRootId, data));
  } catch (error) {
    if ((versions.workspaces.get(workspaceId) ?? 0) !== workspaceVersion) return;
    logger.error('Failed to load secondary Git root', error);
    yield* put(
      setSecondaryRootGitError(
        workspaceId,
        gitRootId,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

function* loadSecondaryRootCommitFilesWorker(
  versions: SecondaryRootReadVersions,
  action: ReturnType<typeof loadSecondaryRootCommitFiles>,
): SagaGenerator<void> {
  const [workspaceId, gitRootId, commitHash] = action.payload;
  const workspaceVersion = versions.workspaces.get(workspaceId) ?? 0;
  const rootKey = secondaryRootContext(action);
  const rootVersion = versions.roots.get(rootKey) ?? 0;
  try {
    const detail = yield* call(
      [appClient.git, appClient.git.commitDetails],
      workspaceId,
      commitHash,
      { gitRootId },
    );
    if (!detail) return;
    if (
      (versions.workspaces.get(workspaceId) ?? 0) !== workspaceVersion ||
      (versions.roots.get(rootKey) ?? 0) !== rootVersion
    )
      return;
    const files: CommitFile[] =
      detail.fileDetails.length > 0
        ? detail.fileDetails
        : detail.files.map((path) => ({ path, additions: 0, deletions: 0 }));
    yield* put(setSecondaryRootCommitFiles(workspaceId, gitRootId, commitHash, files));
  } catch (error) {
    logger.error('Failed to load secondary-root commit details', error);
  }
}

type SecondaryRootReadVersions = {
  workspaces: Map<string, number>;
  roots: Map<string, number>;
};

function secondaryRootContext(
  action: ReturnType<typeof loadSecondaryRootGit> | ReturnType<typeof loadSecondaryRootCommitFiles>,
) {
  return `${action.payload[0]}:${action.payload[1]}`;
}

function secondaryRootCommitContext(action: ReturnType<typeof loadSecondaryRootCommitFiles>) {
  return `${secondaryRootContext(action)}:${action.payload[2]}`;
}

function* loadLatestSecondaryRootWorker(
  versions: SecondaryRootReadVersions,
  action: ReturnType<typeof loadSecondaryRootGit>,
): SagaGenerator<void> {
  const context = secondaryRootContext(action);
  versions.roots.set(context, (versions.roots.get(context) ?? 0) + 1);
  yield* loadSecondaryRootWorker(versions, action);
}

function* invalidateSecondaryRootWorkspace(
  versions: SecondaryRootReadVersions,
  action: ReturnType<typeof workspaceUnmounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  versions.workspaces.set(workspaceId, (versions.workspaces.get(workspaceId) ?? 0) + 1);
}

function* loadGitStatusRequestWorker(action: GitStatusReadAction): SagaGenerator<void> {
  const [workspaceId, forceRefresh] = action.payload;
  if (!workspaceId) return;
  if (action.type === workspaceUnmounted.type) return;
  yield* call(loadGitStatusWorker, workspaceId, forceRefresh as boolean | undefined);
}

function* readGitStatusWorker(
  action: ReturnType<typeof readGitStatusRequested>,
): SagaGenerator<void> {
  try {
    const [workspaceId, forceRefresh, requestId] = action.payload;
    const status = yield* call(
      [appClient.git, appClient.git.status],
      workspaceId,
      ...(forceRefresh ? [{ forceRefresh: true }] : []),
    );
    yield* put(setGitStatusReadResult(workspaceId, requestId, status ? toGitStatus(status) : null));
  } catch (error) {
    const [workspaceId, , requestId] = action.payload;
    yield* put(setGitStatusReadError(workspaceId, requestId, toError(error).message));
  }
}

type WorkspaceReadAction =
  | ReturnType<typeof loadCommitDetails>
  | ReturnType<typeof loadGitDiffs>
  | ReturnType<typeof workspaceUnmounted>;

function commitDetailsContext(
  action: ReturnType<typeof loadCommitDetails> | ReturnType<typeof workspaceUnmounted>,
) {
  const workspaceId = action.payload[0];
  if (action.type === workspaceUnmounted.type)
    return { context: `${workspaceId}\0`, cancel: true as const, match: 'prefix' as const };
  const [, commitHash, gitRootId] = action.payload as ReturnType<
    typeof loadCommitDetails
  >['payload'];
  return `${workspaceId}\0${JSON.stringify([gitRootId ?? '', commitHash])}`;
}

function diffReadContext(
  action: ReturnType<typeof loadGitDiffs> | ReturnType<typeof workspaceUnmounted>,
) {
  const workspaceId = action.payload[0];
  if (action.type === workspaceUnmounted.type)
    return { context: `${workspaceId}\0`, cancel: true as const, match: 'prefix' as const };
  const options = (action as ReturnType<typeof loadGitDiffs>).payload[1];
  return `${workspaceId}\0${JSON.stringify(options ?? {})}`;
}

function* loadCommitDetailsWorker(action: WorkspaceReadAction): SagaGenerator<void> {
  if (action.type === workspaceUnmounted.type) return;
  const [workspaceId, commitHash, gitRootId] = (action as ReturnType<typeof loadCommitDetails>)
    .payload;
  yield* put(setCommitDetailsLoading(workspaceId, commitHash, gitRootId));
  try {
    const result = yield* call(
      [appClient.git, appClient.git.commitDetails],
      workspaceId,
      commitHash,
      gitRootId ? { gitRootId } : undefined,
    );
    if (!result) throw new Error('Commit details unavailable');
    const files =
      result.fileDetails.length > 0
        ? result.fileDetails
        : result.files.map((path) => ({ path, additions: 0, deletions: 0 }));
    yield* put(setCommitDetails(workspaceId, commitHash, { ...result, files }, gitRootId));
  } catch (error) {
    yield* put(setCommitDetailsError(workspaceId, commitHash, toError(error).message, gitRootId));
  }
}

function* readCommitDetailsWorker(
  action: ReturnType<typeof readCommitDetailsRequested>,
): SagaGenerator<void> {
  const [workspaceId, commitHash, gitRootId] = action.payload;
  yield* put(setCommitDetailsLoading(workspaceId, commitHash, gitRootId));
  let settled = false;
  try {
    const result = yield* call(
      [appClient.git, appClient.git.commitDetails],
      workspaceId,
      commitHash,
      gitRootId ? { gitRootId } : undefined,
    );
    if (!result) throw new Error('Commit details unavailable');
    const files =
      result.fileDetails.length > 0
        ? result.fileDetails
        : result.files.map((path) => ({ path, additions: 0, deletions: 0 }));
    const data = { ...result, files };
    yield* put(setCommitDetails(workspaceId, commitHash, data, gitRootId));
    yield* put(action.success(data));
    settled = true;
  } catch (error) {
    const failure = toError(error);
    yield* put(setCommitDetailsError(workspaceId, commitHash, failure.message, gitRootId));
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Commit details read cancelled')));
    }
  }
}

function* loadGitDiffsWorker(action: WorkspaceReadAction): SagaGenerator<void> {
  if (action.type === workspaceUnmounted.type) return;
  const [workspaceId, options] = (action as ReturnType<typeof loadGitDiffs>).payload;
  yield* put(setGitDiffsLoading(workspaceId, options));
  try {
    const result = yield* call([appClient.git, appClient.git.diffs], workspaceId, options);
    yield* put(setGitDiffs(workspaceId, options, result));
  } catch (error) {
    yield* put(setGitDiffsError(workspaceId, options, toError(error).message));
  }
}

function* readGitDiffsWorker(
  action: ReturnType<typeof readGitDiffsRequested>,
): SagaGenerator<void> {
  const [workspaceId, options] = action.payload;
  yield* put(setGitDiffsLoading(workspaceId, options));
  let settled = false;
  try {
    const result = yield* call([appClient.git, appClient.git.diffs], workspaceId, options);
    yield* put(setGitDiffs(workspaceId, options, result));
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    const failure = toError(error);
    yield* put(setGitDiffsError(workspaceId, options, failure.message));
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Git diff read cancelled')));
    }
  }
}

function* readGitBranchesWorker(
  action: ReturnType<typeof readGitBranchesRequested>,
): SagaGenerator<void> {
  const [repoPath, includeRemote] = action.payload;
  let settled = false;
  try {
    const result = yield* call([appClient.git, appClient.git.getBranches], repoPath, includeRemote);
    if (!result) throw new Error('Branches unavailable');
    yield* put(setGitBranches(repoPath, result));
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    const failure = toError(error);
    yield* put(setGitBranchesError(repoPath, failure.message));
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Git branches read cancelled')));
    }
  }
}

function* loadGitBranchesWorker(action: ReturnType<typeof loadGitBranches>): SagaGenerator<void> {
  const [repoPath, includeRemote, forceRefresh, cacheEnabled, networkDelayMs] = action.payload;
  yield* delay(BRANCH_LOAD_DEBOUNCE_MS);
  if (networkDelayMs && networkDelayMs > 0) yield* delay(networkDelayMs);
  if (forceRefresh) branchLoadCache.delete(repoPath);

  const cached = branchLoadCache.get(repoPath);
  if (
    cacheEnabled &&
    !forceRefresh &&
    cached &&
    Date.now() - cached.timestamp < BRANCH_CACHE_DURATION_MS
  ) {
    yield* put(setGitBranches(repoPath, cached.data));
    return;
  }

  try {
    const result = yield* call([appClient.git, appClient.git.getBranches], repoPath, includeRemote);
    if (!result) throw new Error('Branches unavailable');
    if (cacheEnabled) branchLoadCache.set(repoPath, { data: result, timestamp: Date.now() });
    yield* put(setGitBranches(repoPath, result));
  } catch (error) {
    yield* put(setGitBranchesError(repoPath, toError(error).message));
  }
}

function* readGitBranchStatusWorker(
  action: ReturnType<typeof readGitBranchStatusRequested>,
): SagaGenerator<void> {
  const [repoPath, branchName] = action.payload;
  let settled = false;
  try {
    const result = yield* call([appClient.git, appClient.git.branchStatus], repoPath, branchName);
    if (!result) throw new Error('Branch status unavailable');
    yield* put(setGitBranchStatus(repoPath, branchName, result));
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    const failure = toError(error);
    yield* put(setGitBranchStatusError(repoPath, branchName, failure.message));
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Git branch status read cancelled')));
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function mutationResult(result: { ok: boolean; error?: string }): MutationResult {
  return result.ok ? { success: true } : { success: false, error: result.error };
}

type AsyncRequestAction<Result> = {
  promise: Promise<Result>;
  success(result: Result): { type: string };
  failure(error: Error): { type: string };
};

function* settleAsyncAction<Result>(
  action: AsyncRequestAction<Result>,
  operation: () => SagaGenerator<Result>,
): SagaGenerator<void> {
  void action.promise.catch(() => {});
  let settled = false;
  try {
    const result = yield* operation();
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Git operation cancelled')));
  }
}

function* readAcceptChangesStatusWorker(
  action: ReturnType<typeof readAcceptChangesStatusRequested>,
): SagaGenerator<void> {
  yield* settleAsyncAction(action, function* () {
    const [workspaceId, forceRefresh] = action.payload;
    return yield* call(
      [AcceptChangesClient, AcceptChangesClient.getStatus],
      workspaceId as WorkspaceId,
      forceRefresh ? { forceRefresh: true } : undefined,
    );
  });
}

function* prepareAcceptChangesWorker(
  action: ReturnType<typeof prepareAcceptChangesRequested>,
): SagaGenerator<void> {
  yield* settleAsyncAction(action, function* () {
    const [workspaceId, acceptAction, files] = action.payload;
    return yield* call(
      [AcceptChangesClient, AcceptChangesClient.prepare],
      workspaceId as WorkspaceId,
      acceptAction,
      files,
    );
  });
}

function* mergePullRequestWorker(
  action: ReturnType<typeof mergePullRequestRequested>,
): SagaGenerator<void> {
  yield* settleAsyncAction(action, function* () {
    const [workspaceId, prNumber, mergeMethod] = action.payload;
    const result = yield* call(
      [AcceptChangesClient, AcceptChangesClient.mergePR],
      workspaceId as WorkspaceId,
      prNumber,
      { mergeMethod },
    );
    if (result.success) {
      const [statusAction, changesAction] = refreshGitWorkspace(workspaceId);
      yield* put(statusAction);
      yield* put(changesAction);
      yield* put(refreshPRStatusRequested(workspaceId, true, false));
    }
    return result;
  });
}

function refreshGitWorkspace(workspaceId: string) {
  gitCache.invalidate(`git-status-${workspaceId}`);
  return [loadGitStatus(workspaceId, true), refreshRequested(workspaceId, true)] as const;
}

function acceptChangesFlag(action: string) {
  if (action === 'push') return 'isPushing' as const;
  if (action === 'rebase-onto-trunk') return 'isRebasing' as const;
  return null;
}

function* executeAcceptChangesWorker(
  action: ReturnType<typeof executeAcceptChangesRequested>,
): SagaGenerator<void> {
  const [workspaceId, acceptAction, options] = action.payload;
  const flag = acceptChangesFlag(acceptAction);
  if (flag) yield* put(setGitOperationFlag(workspaceId, flag, true));
  try {
    yield* settleAsyncAction(action, function* () {
      const result = yield* call(
        [AcceptChangesClient, AcceptChangesClient.execute],
        workspaceId as WorkspaceId,
        acceptAction,
        options,
      );
      if (result.success) {
        const [statusAction, changesAction] = refreshGitWorkspace(workspaceId);
        yield* put(statusAction);
        yield* put(changesAction);
        yield* put(refreshAcceptChangesStatus(workspaceId));
      }
      return result;
    });
  } finally {
    if (flag) yield* put(setGitOperationFlag(workspaceId, flag, false));
  }
}

function* createPullRequestWorker(
  action: ReturnType<typeof createPullRequestRequested>,
): SagaGenerator<void> {
  yield* settleAsyncAction(action, function* () {
    const [workspaceId, prTitle, prDescription, targetBranch, hasStaged] = action.payload;
    if (hasStaged) {
      const commitResult: AcceptChangesResult = yield* call(() =>
        AcceptChangesClient.execute(workspaceId as WorkspaceId, 'commit', {
          commitMessage: prTitle,
        }),
      );
      if (!commitResult.success) return commitResult;
    }
    const result: AcceptChangesResult = yield* call(() =>
      AcceptChangesClient.execute(workspaceId as WorkspaceId, 'create-pr', {
        prTitle,
        prBody: prDescription,
        targetBranch,
      }),
    );
    if (result.success) {
      const prNumber = result.result?.prNumber;
      const prUrl = result.result?.prHtmlUrl;
      if (prNumber && prUrl) {
        const now = new Date().toISOString();
        yield* put(
          updateWorkspaceEntity(workspaceId, {
            activePullRequest: {
              id: String(prNumber),
              number: prNumber,
              url: prUrl,
              title: prTitle,
              status: PullRequestStatus.Open,
              createdAt: now,
              updatedAt: now,
            },
            prUrl,
            prNumber,
            prStatus: PullRequestStatus.Open,
          }),
        );
      }
      const [statusAction, changesAction] = refreshGitWorkspace(workspaceId);
      yield* put(statusAction);
      yield* put(changesAction);
    }
    return result;
  });
}

function* addRemoteWorker(action: ReturnType<typeof addGitRemoteRequested>): SagaGenerator<void> {
  yield* settleAsyncAction(action, function* () {
    const [workspaceId, remoteUrl] = action.payload;
    const result = yield* call(
      [AcceptChangesClient, AcceptChangesClient.addRemote],
      workspaceId as WorkspaceId,
      remoteUrl,
    );
    yield* put(refreshAcceptChangesStatus(workspaceId));
    return result;
  });
}

type ExecuteCommandResult = {
  success: boolean;
  error?: string;
  data?: { stdout?: string; stderr?: string };
};

function* amendCommitWorker(
  action: ReturnType<typeof amendCommitMessageRequested>,
): SagaGenerator<void> {
  yield* settleAsyncAction(action, function* () {
    const [workspaceId, repoPath, message, wasPushed] = action.payload;
    const amend: ExecuteCommandResult = yield* call(
      invoke<ExecuteCommandResult>,
      SYSTEM_CHANNELS.EXECUTE_COMMAND,
      { command: `git commit --amend -m ${posixSingleQuote(message)}`, cwd: repoPath, workspaceId },
    );
    if (!amend.success) return { success: false, error: amend.error };
    if (wasPushed) {
      let push: ExecuteCommandResult = yield* call(
        invoke<ExecuteCommandResult>,
        SYSTEM_CHANNELS.EXECUTE_COMMAND,
        { command: 'git push --force-with-lease', cwd: repoPath, workspaceId },
      );
      if (!push.success && push.data?.stderr?.includes('has no upstream branch')) {
        const branch: ExecuteCommandResult = yield* call(
          invoke<ExecuteCommandResult>,
          SYSTEM_CHANNELS.EXECUTE_COMMAND,
          { command: 'git rev-parse --abbrev-ref HEAD', cwd: repoPath, workspaceId },
        );
        if (branch.success && branch.data?.stdout) {
          push = yield* call(invoke<ExecuteCommandResult>, SYSTEM_CHANNELS.EXECUTE_COMMAND, {
            command: `git push --force-with-lease --set-upstream origin ${branch.data.stdout.trim()}`,
            cwd: repoPath,
            workspaceId,
          });
        }
      }
      if (!push.success) return { success: false, error: push.error };
    }
    const [statusAction, changesAction] = refreshGitWorkspace(workspaceId);
    yield* put(statusAction);
    yield* put(changesAction);
    return { success: true };
  });
}

function* refreshPullRequestWorker(
  action: ReturnType<typeof refreshPullRequestRequested>,
): SagaGenerator<void> {
  const workspaceId = action.payload[0];
  yield* put(setGitOperationFlag(workspaceId, 'isRefreshingPR', true));
  try {
    yield* settleAsyncAction(action, function* () {
      const result = mutationResult(
        yield* call([gitClient, gitClient.fetch], workspaceId as WorkspaceId),
      );
      if (result.success) {
        gitCache.invalidate(`git-status-${workspaceId}`);
        yield* put(loadGitStatus(workspaceId, true));
        yield* put(refreshPRStatusRequested(workspaceId, true, true));
      }
      return result;
    });
  } finally {
    yield* delay(300);
    yield* put(setGitOperationFlag(workspaceId, 'isRefreshingPR', false));
  }
}

function* readGitFileWorker(action: ReturnType<typeof readGitFileRequested>): SagaGenerator<void> {
  yield* settleAsyncAction(action, function* () {
    const [workspaceId, filePath, ref, gitRootId] = action.payload;
    const result = yield* call(backendRequest<{ content?: unknown }>, 'git.showFile', {
      workspaceId,
      filePath,
      ref,
      ...(gitRootId ? { gitRootId } : {}),
    });
    return typeof result?.content === 'string' ? result.content : '';
  });
}

function* stageHunkWorker(action: ReturnType<typeof stageGitHunkRequested>): SagaGenerator<void> {
  yield* settleAsyncAction(action, function* () {
    const [workspaceId, path, patch] = action.payload;
    const result = yield* call(
      [gitClient, gitClient.stageHunk],
      workspaceId as WorkspaceId,
      path,
      patch,
    );
    const mapped = mutationResult(result);
    if (mapped.success) {
      const [statusAction, changesAction] = refreshGitWorkspace(workspaceId);
      yield* put(statusAction);
      yield* put(changesAction);
    }
    return mapped;
  });
}

function* unstageHunkWorker(
  action: ReturnType<typeof unstageGitHunkRequested>,
): SagaGenerator<void> {
  yield* settleAsyncAction(action, function* () {
    const [workspaceId, path, patch] = action.payload;
    const result = yield* call(
      [gitClient, gitClient.unstageHunk],
      workspaceId as WorkspaceId,
      path,
      patch,
    );
    const mapped = mutationResult(result);
    if (mapped.success) {
      const [statusAction, changesAction] = refreshGitWorkspace(workspaceId);
      yield* put(statusAction);
      yield* put(changesAction);
    }
    return mapped;
  });
}

function* fetchWorker(action: ReturnType<typeof fetchGitRequested>): SagaGenerator<void> {
  yield* settleAsyncAction(action, function* () {
    const result = yield* call([gitClient, gitClient.fetch], action.payload[0] as WorkspaceId);
    return mutationResult(result);
  });
}

function* pushWorker(action: ReturnType<typeof pushGitRequested>): SagaGenerator<void> {
  yield* settleAsyncAction(action, function* () {
    const [workspaceId, branch, force] = action.payload;
    const result = yield* call(
      [gitClient, gitClient.push],
      workspaceId as WorkspaceId,
      branch,
      force,
    );
    return mutationResult(result);
  });
}

function* pullWorker(action: ReturnType<typeof pullGitRequested>): SagaGenerator<void> {
  yield* settleAsyncAction(action, function* () {
    const [, repoPath, branchName] = action.payload;
    return yield* call([appClient.git, appClient.git.pull], repoPath, branchName);
  });
}

async function resolveGitEnrichment(
  workspaceId: string,
  request: GitEnrichmentRequest,
): Promise<GitEnrichmentResult> {
  const [diffs, branchDiffs, numstats, showFiles] = await Promise.all([
    Promise.all(
      request.diffs.map(async (item) => {
        try {
          const chunk = await batchedGitDiff(workspaceId, item.staged, item.path, {
            gitlink: item.gitlink,
            gitRootId: item.gitRootId,
            gitRootPath: item.gitRootPath,
          });
          return [item.key, (chunk as DiffChunk | undefined) ?? null] as const;
        } catch (error) {
          logger.warn('Failed to resolve Git enrichment diff', {
            workspaceId,
            path: item.path,
            error,
          });
          return [item.key, null] as const;
        }
      }),
    ),
    Promise.all(
      request.branchDiffs.map(async (item) => {
        try {
          const chunk = await batchedGitBranchBaseDiff(
            workspaceId,
            { baseRef: item.baseRef, baseCommitSha: item.baseCommitSha },
            item.path,
          );
          return [item.key, (chunk as DiffChunk | undefined) ?? null] as const;
        } catch (error) {
          logger.warn('Failed to resolve branch-base Git enrichment diff', {
            workspaceId,
            path: item.path,
            error,
          });
          return [item.key, null] as const;
        }
      }),
    ),
    Promise.all(
      request.numstats.map(async ({ key, ...options }) => {
        try {
          return [key, await dedupedGitNumstat(workspaceId, options)] as const;
        } catch (error) {
          logger.warn('Failed to resolve Git enrichment numstat', { workspaceId, error });
          return [key, []] as const;
        }
      }),
    ),
    Promise.all(
      request.showFiles.map(
        async (item) =>
          [
            item.key,
            await dedupedShowFile(
              workspaceId,
              item.ref,
              item.path,
              item.gitRootId ? { gitRootId: item.gitRootId } : undefined,
            ),
          ] as const,
      ),
    ),
  ]);
  return {
    diffs: Object.fromEntries(diffs),
    branchDiffs: Object.fromEntries(branchDiffs),
    numstats: Object.fromEntries(numstats),
    showFiles: Object.fromEntries(showFiles),
  };
}

function* loadGitEnrichmentWorker(
  action: ReturnType<typeof loadGitEnrichment>,
): SagaGenerator<void> {
  const [workspaceId, key, requestId, request] = action.payload;
  try {
    const result = yield* call(resolveGitEnrichment, workspaceId, request);
    yield* put(setGitEnrichment(workspaceId, key, requestId, result));
  } catch (error) {
    yield* put(setGitEnrichmentError(workspaceId, key, requestId, toError(error).message));
  }
}

type WorkspaceAsyncAction = { type: string; payload: [workspaceId: string, ...args: unknown[]] };

function workspaceAsyncContext(action: WorkspaceAsyncAction) {
  return action.type === workspaceUnmounted.type
    ? { context: action.payload[0], cancel: true as const }
    : action.payload[0];
}

function fileAsyncContext(
  action: ReturnType<typeof readGitFileRequested> | ReturnType<typeof workspaceUnmounted>,
) {
  if (action.type === workspaceUnmounted.type) {
    return { context: `${action.payload[0]}\0`, cancel: true as const, match: 'prefix' as const };
  }
  const [workspaceId, path, ref, gitRootId] = action.payload as ReturnType<
    typeof readGitFileRequested
  >['payload'];
  return `${workspaceId}\0${gitFileReadKey(path, ref, gitRootId)}`;
}

function enrichmentContext(
  action: ReturnType<typeof loadGitEnrichment> | ReturnType<typeof workspaceUnmounted>,
) {
  if (action.type === workspaceUnmounted.type) {
    return { context: `${action.payload[0]}\0`, cancel: true as const, match: 'prefix' as const };
  }
  const [workspaceId, key] = action.payload as ReturnType<typeof loadGitEnrichment>['payload'];
  return `${workspaceId}\0${key}`;
}

function* ignoreWorkspaceCleanup<Action extends WorkspaceAsyncAction>(
  worker: (request: Action) => SagaGenerator<void>,
  action: Action | ReturnType<typeof workspaceUnmounted>,
): SagaGenerator<void> {
  if (action.type !== workspaceUnmounted.type) yield* worker(action as Action);
}

export function* gitReadSaga() {
  const secondaryRootReadVersions: SecondaryRootReadVersions = {
    workspaces: new Map<string, number>(),
    roots: new Map<string, number>(),
  };
  const watcher = yield* takeSingleFlightInContext(
    [loadGitStatus, workspaceUnmounted],
    workspaceReadContext,
    loadGitStatusRequestWorker,
  );
  yield* takeSingleFlightInContext(
    [loadCommitDetails, workspaceUnmounted],
    commitDetailsContext,
    loadCommitDetailsWorker,
  );
  yield* takeSingleFlightInContext(
    [loadGitDiffs, workspaceUnmounted],
    diffReadContext,
    loadGitDiffsWorker,
  );
  yield* takeLatestInContext(
    [readGitStatusRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    readGitStatusWorker,
  );
  yield* takeLatestInContext(
    [readCommitDetailsRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    readCommitDetailsWorker,
  );
  yield* takeLatestInContext(
    [readGitDiffsRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    readGitDiffsWorker,
  );
  yield* takeLatestInContext(
    [readGitFileRequested, workspaceUnmounted],
    fileAsyncContext,
    ignoreWorkspaceCleanup,
    readGitFileWorker,
  );
  yield* takeLatestInContext(
    [loadGitEnrichment, workspaceUnmounted],
    enrichmentContext,
    ignoreWorkspaceCleanup,
    loadGitEnrichmentWorker,
  );
  yield* takeLatestInContext(
    [stageGitHunkRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    stageHunkWorker,
  );
  yield* takeLatestInContext(
    [unstageGitHunkRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    unstageHunkWorker,
  );
  yield* takeLatestInContext(
    [fetchGitRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    fetchWorker,
  );
  yield* takeLatestInContext(
    [pushGitRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    pushWorker,
  );
  yield* takeLatestInContext(
    [pullGitRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    pullWorker,
  );
  yield* takeLatestInContext(
    [executeAcceptChangesRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    executeAcceptChangesWorker,
  );
  yield* takeLatestInContext(
    [readAcceptChangesStatusRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    readAcceptChangesStatusWorker,
  );
  yield* takeLatestInContext(
    [prepareAcceptChangesRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    prepareAcceptChangesWorker,
  );
  yield* takeLatestInContext(
    [mergePullRequestRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    mergePullRequestWorker,
  );
  yield* takeLatestInContext(
    [createPullRequestRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    createPullRequestWorker,
  );
  yield* takeLatestInContext(
    [addGitRemoteRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    addRemoteWorker,
  );
  yield* takeLatestInContext(
    [amendCommitMessageRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    amendCommitWorker,
  );
  yield* takeLatestInContext(
    [refreshPullRequestRequested, workspaceUnmounted],
    workspaceAsyncContext,
    ignoreWorkspaceCleanup,
    refreshPullRequestWorker,
  );
  yield* takeLatestInContext(loadGitBranches, (action) => action.payload[0], loadGitBranchesWorker);
  yield* takeLatestInContext(
    readGitBranchesRequested,
    (action) => action.payload[0],
    readGitBranchesWorker,
  );
  yield* takeLatestInContext(
    readGitBranchStatusRequested,
    (action) => JSON.stringify(action.payload),
    readGitBranchStatusWorker,
  );
  yield* takeLatestInContext(
    loadSecondaryRootGit,
    secondaryRootContext,
    loadLatestSecondaryRootWorker,
    secondaryRootReadVersions,
  );
  yield* takeLatestInContext(
    loadSecondaryRootCommitFiles,
    secondaryRootCommitContext,
    loadSecondaryRootCommitFilesWorker,
    secondaryRootReadVersions,
  );
  yield* takeEvery(workspaceUnmounted, invalidateSecondaryRootWorkspace, secondaryRootReadVersions);
  yield* join(watcher);
}
