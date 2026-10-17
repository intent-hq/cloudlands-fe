import { observeGitReadFailure } from '$features/file-tracking/git-recovery-read-lane';
import {
  captureSecondaryRootRead,
  readSecondaryRootSnapshot,
} from '$features/file-tracking/git-secondary-root-recovery';
import { normalizeCommitDetails } from '$lib/client/live/live-git-client';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { gitStatusRecoveryKey } from '$features/file-tracking/worktree-recovery-keys';
import { getRecoveryAdmission, withRecoveryLifetime } from '../../../middlewares/event-recovery';
import type { SagaGenerator } from 'typed-redux-saga';
import { call, fork, join, put, select, takeEvery } from 'typed-redux-saga';
import type { StoreState } from '../../../types';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { gitConsumerReadSaga } from './git-consumer-read-saga';
import {
  getGitMutationVersion,
  isGitMutationPending,
  waitForGitMutations,
} from '../../../utils/worktree-mutation-queue';

import { gitClient } from '$features/git/git.client';
import { appClient } from '$lib/client';
import { parsePushedGitStatus } from '$lib/client/live/live-git-client';
import { changesEventReceived } from '../../changes/changes-slice';
import { createLogger } from '$lib/utils/client-logger';
import type { CommitFile } from '$features/file-tracking/types';
import { LineType, type CommitInfo, type GitStatus, type WorkspaceId } from '$shared/types';
import {
  takeLatestInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadGitStatus,
  loadSecondaryRootCommitFiles,
  loadSecondaryRootGit,
  setGitStatus,
  setSecondaryRootGit,
  setSecondaryRootGitError,
  setSecondaryRootGitLoading,
  setSecondaryRootCommitFiles,
} from '../git-slice';
import { toGitStatus } from '../utils/git-status';

const logger = createLogger('GitReadSaga');

function* currentStatusReadContext(): SagaGenerator<string | null> {
  const state: StoreState | undefined = yield* select();
  return state ? selectPrincipalActionContext.select(state) : null;
}

function* loadGitStatusWorker(
  versions: Map<string, number>,
  workspaceId: string,
  forceRefresh?: boolean,
): SagaGenerator<void> {
  const receipt = rendererEventRecovery.capture(gitStatusRecoveryKey(workspaceId));
  const version = versions.get(workspaceId);
  const context = yield* currentStatusReadContext();
  for (;;) {
    if (isGitMutationPending(workspaceId)) yield* call(waitForGitMutations, workspaceId);
    const epoch = getGitMutationVersion(workspaceId);
    try {
      const status: GitStatus | null = yield* call(
        [appClient.git, appClient.git.status],
        workspaceId,
        ...(forceRefresh ? [{ forceRefresh: true }] : []),
      );
      if (
        !receipt.commit(() => undefined) ||
        versions.get(workspaceId) !== version ||
        (yield* currentStatusReadContext()) !== context
      )
        return;
      if (epoch !== getGitMutationVersion(workspaceId)) continue;
      if (status)
        yield* put(withRecoveryLifetime(setGitStatus(workspaceId, toGitStatus(status)), receipt));
    } catch (error) {
      if (epoch !== getGitMutationVersion(workspaceId)) continue;
      logger.error('Failed to load git status', error);
    }
    return;
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
  const captured = captureSecondaryRootRead(workspaceId, gitRootId);
  if (!captured.receipt.commit(() => undefined)) return;
  const workspaceVersion = versions.workspaces.get(workspaceId) ?? 0;
  yield* put(
    withRecoveryLifetime(setSecondaryRootGitLoading(workspaceId, gitRootId), captured.receipt),
  );
  for (;;) {
    if (isGitMutationPending(workspaceId, gitRootId))
      yield* call(waitForGitMutations, workspaceId, gitRootId);
    if ((versions.workspaces.get(workspaceId) ?? 0) !== workspaceVersion) return;
    const epoch = getGitMutationVersion(workspaceId, gitRootId);
    try {
      const data = yield* call(() =>
        captured.run(() =>
          captured.transport
            ? readSecondaryRootSnapshot(
                workspaceId,
                gitRootId,
                registeredCommitSha,
                limit,
                captured.transport,
              )
            : readSecondaryRoot(workspaceId, gitRootId, registeredCommitSha, limit),
        ),
      );
      if (!captured.receipt.commit(() => undefined)) return;
      if ((versions.workspaces.get(workspaceId) ?? 0) !== workspaceVersion) return;
      if (epoch !== getGitMutationVersion(workspaceId, gitRootId)) continue;
      yield* put(
        withRecoveryLifetime(setSecondaryRootGit(workspaceId, gitRootId, data), captured.receipt),
      );
    } catch (error) {
      if (!captured.receipt.commit(() => undefined)) return;
      if ((versions.workspaces.get(workspaceId) ?? 0) !== workspaceVersion) return;
      if (epoch !== getGitMutationVersion(workspaceId, gitRootId)) continue;
      logger.error('Failed to load secondary Git root', error);
      yield* put(
        withRecoveryLifetime(
          setSecondaryRootGitError(
            workspaceId,
            gitRootId,
            error instanceof Error ? error.message : String(error),
          ),
          captured.receipt,
        ),
      );
    }
    return;
  }
}

function* loadSecondaryRootCommitFilesWorker(
  versions: SecondaryRootReadVersions,
  action: ReturnType<typeof loadSecondaryRootCommitFiles>,
): SagaGenerator<void> {
  const [workspaceId, gitRootId, commitHash] = action.payload;
  const captured = captureSecondaryRootRead(workspaceId, gitRootId);
  if (!captured.receipt.commit(() => undefined)) return;
  const workspaceVersion = versions.workspaces.get(workspaceId) ?? 0;
  const rootKey = secondaryRootContext(action);
  const rootVersion = versions.roots.get(rootKey) ?? 0;
  for (;;) {
    if (isGitMutationPending(workspaceId, gitRootId))
      yield* call(waitForGitMutations, workspaceId, gitRootId);
    if (
      (versions.workspaces.get(workspaceId) ?? 0) !== workspaceVersion ||
      (versions.roots.get(rootKey) ?? 0) !== rootVersion
    )
      return;
    const epoch = getGitMutationVersion(workspaceId, gitRootId);
    try {
      const detail = yield* call(() =>
        captured.run(async () =>
          captured.transport
            ? normalizeCommitDetails(
                await observeGitReadFailure(
                  captured.transport.request<Record<string, unknown>>('git.commitDetails', {
                    workspaceId,
                    gitRootId,
                    commitHash,
                  }),
                  captured.transport.onFailure,
                ),
                commitHash,
              )
            : appClient.git.commitDetails(workspaceId, commitHash, { gitRootId }),
        ),
      );
      if (!captured.receipt.commit(() => undefined)) return;
      if (epoch !== getGitMutationVersion(workspaceId, gitRootId)) continue;
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
      yield* put(
        withRecoveryLifetime(
          setSecondaryRootCommitFiles(workspaceId, gitRootId, commitHash, files),
          captured.receipt,
        ),
      );
    } catch (error) {
      if (!captured.receipt.commit(() => undefined)) return;
      if (epoch !== getGitMutationVersion(workspaceId, gitRootId)) continue;
      logger.error('Failed to load secondary-root commit details', error);
    }
    return;
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

function* loadGitStatusRequestWorker(
  versions: Map<string, number>,
  action: GitStatusReadAction,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  if (action.type === workspaceUnmounted.type) return;
  yield* call(loadGitStatusWorker, versions, workspaceId, action.payload[1]);
}

function* pushedGitStatus(
  versions: Map<string, number>,
  action: ReturnType<typeof changesEventReceived>,
): SagaGenerator<void> {
  const [workspaceId, type, data] = action.payload;
  if (type !== 'changes:git-status' || data.gitRootId) return;
  const admitted = getRecoveryAdmission(action, gitStatusRecoveryKey(workspaceId));
  if (
    admitted === null ||
    (admitted
      ? !admitted.commit(() => undefined)
      : !rendererEventRecovery.push(gitStatusRecoveryKey(workspaceId)))
  )
    return;
  const receipt = admitted ?? rendererEventRecovery.capture(gitStatusRecoveryKey(workspaceId));
  const status = data.status as { gitStatus?: Record<string, unknown> } | undefined;
  const pushed = parsePushedGitStatus(status?.gitStatus);
  if (!pushed) return;
  versions.set(workspaceId, (versions.get(workspaceId) ?? 0) + 1);
  yield* put(withRecoveryLifetime(setGitStatus(workspaceId, pushed), receipt));
}

export function* gitReadSaga() {
  const statusVersions = new Map<string, number>();
  yield* fork(gitConsumerReadSaga);
  const secondaryRootReadVersions: SecondaryRootReadVersions = {
    workspaces: new Map<string, number>(),
    roots: new Map<string, number>(),
  };
  const watcher = yield* takeSingleFlightInContext(
    [loadGitStatus, workspaceUnmounted],
    workspaceReadContext,
    loadGitStatusRequestWorker,
    statusVersions,
  );
  yield* takeEvery(changesEventReceived, pushedGitStatus, statusVersions);
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
