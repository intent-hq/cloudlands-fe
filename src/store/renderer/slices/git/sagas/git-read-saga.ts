import type { SagaGenerator } from 'typed-redux-saga';
import { call, join, put, takeEvery } from 'typed-redux-saga';

import { gitClient } from '$features/git/git.client';
import { appClient } from '$lib/client';
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

function* loadGitStatusWorker(workspaceId: string): SagaGenerator<void> {
  try {
    const status: GitStatus | null = yield* call(
      [appClient.git, appClient.git.status],
      workspaceId,
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
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  if (action.type === workspaceUnmounted.type) return;
  yield* call(loadGitStatusWorker, workspaceId);
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
