import type { Task } from 'redux-saga';
import { call, cancel, fork, put, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { GitStatus } from '$shared/types';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { loadGitStatus, setGitStatus } from '../git-slice';

const logger = createLogger('GitReadSaga');

function toGitStatus(status: GitStatus): GitStatus {
  return {
    branch: status.branch,
    ahead: status.ahead,
    behind: status.behind,
    diverged: status.diverged,
    files: status.files.map((file) => ({
      path: file.path,
      status: file.status,
      staged: file.staged,
    })),
    hasUncommittedChanges: status.hasUncommittedChanges,
    hasUntrackedFiles: status.hasUntrackedFiles,
  };
}

function* loadGitStatusWorker(workspaceId: string) {
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

type RunningRead = { task?: Task; token: symbol };

export function* gitReadSaga() {
  const running = new Map<string, RunningRead>();
  try {
    while (true) {
      const action: ReturnType<
        typeof loadGitStatus | typeof workspaceDeleted | typeof workspaceUnmounted
      > = yield* take([loadGitStatus, workspaceDeleted, workspaceUnmounted]);

      if (action.type === loadGitStatus.type) {
        const [workspaceId] = action.payload as [string];
        if (!workspaceId || running.has(workspaceId)) continue;
        const token = Symbol(workspaceId);
        running.set(workspaceId, { token });
        const task = yield* fork(function* () {
          try {
            yield* call(loadGitStatusWorker, workspaceId);
          } finally {
            if (running.get(workspaceId)?.token === token) running.delete(workspaceId);
          }
        });
        if (running.get(workspaceId)?.token === token) running.set(workspaceId, { task, token });
        continue;
      }

      const [workspaceId] = action.payload as [string];
      const read = running.get(workspaceId);
      if (!read) continue;
      running.delete(workspaceId);
      if (read.task) yield* cancel(read.task);
    }
  } finally {
    for (const read of running.values()) {
      if (read.task) yield* cancel(read.task);
    }
    running.clear();
  }
}
