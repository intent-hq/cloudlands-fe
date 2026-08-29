import type { SagaGenerator } from 'typed-redux-saga';
import { call, cancel, fork, join, put, take } from 'typed-redux-saga';
import type { Task } from 'redux-saga';

import { gitClient } from '$features/git/git.client';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { CommitFile } from '$features/file-tracking/types';
import type { CommitInfo, GitStatus, WorkspaceId } from '$shared/types';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadGitStatus,
  loadSecondaryRootGit,
  setGitStatus,
  setSecondaryRootGit,
  setSecondaryRootGitError,
  setSecondaryRootGitLoading,
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

type GitStatusReadAction =
  | ReturnType<typeof loadGitStatus>
  | ReturnType<typeof workspaceUnmounted>;

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
    (!registeredCommitSha || !commits.some((commit) => commit.hash === registeredCommitSha))
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

  const details = await Promise.all(
    commits.map((commit) =>
      appClient.git.commitDetails(workspaceId, commit.hash, { gitRootId }),
    ),
  );
  const commitFiles: Record<string, CommitFile[]> = {};
  commits.forEach((commit, index) => {
    const detail = details[index];
    if (!detail) throw new Error(`Failed to load commit details for ${commit.hash}`);
    commitFiles[commit.hash] =
      detail.fileDetails.length > 0
        ? detail.fileDetails
        : detail.files.map((path) => ({ path, additions: 0, deletions: 0 }));
  });
  return { status: statusResult.data, commits, nextToken, commitFiles };
}

function* loadSecondaryRootWorker(
  action: ReturnType<typeof loadSecondaryRootGit>,
): SagaGenerator<void> {
  const [workspaceId, gitRootId, registeredCommitSha, limit = 30] = action.payload;
  yield* put(setSecondaryRootGitLoading(workspaceId, gitRootId));
  try {
    const data = yield* call(
      readSecondaryRoot,
      workspaceId,
      gitRootId,
      registeredCommitSha,
      limit,
    );
    yield* put(setSecondaryRootGit(workspaceId, gitRootId, data));
  } catch (error) {
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

function* watchSecondaryRootReads(): SagaGenerator<never> {
  const tasks = new Map<string, Task>();
  while (true) {
    const action: ReturnType<typeof loadSecondaryRootGit> | ReturnType<typeof workspaceUnmounted> =
      yield* take([loadSecondaryRootGit, workspaceUnmounted]);
    const workspaceId = action.payload[0];
    if (action.type === workspaceUnmounted.type) {
      for (const [key, task] of tasks) {
        if (!key.startsWith(`${workspaceId}:`)) continue;
        tasks.delete(key);
        if (task.isRunning()) yield* cancel(task);
      }
      continue;
    }
    const rootAction = action as ReturnType<typeof loadSecondaryRootGit>;
    const key = `${workspaceId}:${rootAction.payload[1]}`;
    const current = tasks.get(key);
    if (current?.isRunning()) yield* cancel(current);
    let task!: Task;
    task = yield* fork(function* latestRootRead() {
      try {
        yield* loadSecondaryRootWorker(rootAction);
      } finally {
        if (tasks.get(key) === task) tasks.delete(key);
      }
    });
    tasks.set(key, task);
  }
}

function* loadGitStatusRequestWorker(action: GitStatusReadAction): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  if (action.type === workspaceUnmounted.type) return;
  yield* call(loadGitStatusWorker, workspaceId);
}

export function* gitReadSaga() {
  const watcher = yield* takeSingleFlightInContext(
    [loadGitStatus, workspaceUnmounted],
    workspaceReadContext,
    loadGitStatusRequestWorker,
  );
  yield* fork(watchSecondaryRootReads);
  yield* join(watcher);
}
