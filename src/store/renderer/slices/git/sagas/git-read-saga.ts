import { END, buffers, eventChannel, type EventChannel, type Task } from 'redux-saga';
import { call, cancel, fork, put, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { GitStatus } from '$shared/types';
import { selectActiveWorkspaceId } from '../../workspace/workspace-selectors';
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

type RunningRead = { task?: Task; token: symbol; pending?: boolean };

/**
 * Bridges daemon-pushed git-change notifications (`appClient.git.subscribe`)
 * into the saga world. In live mode `LiveGitClient.subscribe` is the only
 * client wired to real daemon `git:*` / `changes:git-status` events, so it
 * doubles as the "git changed externally" signal here — we discard its
 * carried status because the live client's snapshot is not workspace-scoped
 * (see `watchGitStatusSubscription`).
 */
export function createGitStatusChangeChannel(): EventChannel<true> {
  return eventChannel<true>(
    (emit) => appClient.git.subscribe(() => emit(true)),
    buffers.sliding<true>(1),
  );
}

/**
 * Restores the external git-change auto-refresh dropped by #584
 * (`src/features/git/git-status-subscription.ts`). Each daemon git-change
 * signal re-dispatches `loadGitStatus` for the active workspace so
 * out-of-app changes (agent commits, other tools) refresh the Changes
 * display. No refresh loop: `git.status` is a read and never re-emits a
 * `git:*` change event, so this cannot re-trigger itself.
 */
function* watchGitStatusSubscription() {
  const channel = createGitStatusChangeChannel();
  try {
    while (true) {
      const signal: true = yield* take(channel);
      if (signal === (END as unknown as true)) break;
      const workspaceId: string | null = yield* selectActiveWorkspaceId.effect();
      if (workspaceId) yield* put(loadGitStatus(workspaceId, true));
    }
  } finally {
    channel.close();
  }
}

/**
 * Single-flight git-status read with trailing coalesce: a `loadGitStatus`
 * that arrives while `workspaceId`'s read is already in flight is never
 * dropped — it flips `entry.pending`, and once the in-flight read settles
 * the loop below re-reads once more (clearing `pending` first) before
 * releasing the single-flight slot, so at most one trailing read follows
 * any burst of triggers.
 */
function* runRead(running: Map<string, RunningRead>, workspaceId: string, entry: RunningRead) {
  try {
    while (running.get(workspaceId) === entry) {
      entry.pending = false;
      yield* call(loadGitStatusWorker, workspaceId);
      if (!entry.pending) break;
    }
  } finally {
    if (running.get(workspaceId) === entry) running.delete(workspaceId);
  }
}

export function* gitReadSaga() {
  const running = new Map<string, RunningRead>();
  yield* fork(watchGitStatusSubscription);
  try {
    while (true) {
      const action: ReturnType<
        typeof loadGitStatus | typeof workspaceDeleted | typeof workspaceUnmounted
      > = yield* take([loadGitStatus, workspaceDeleted, workspaceUnmounted]);

      if (action.type === loadGitStatus.type) {
        const [workspaceId] = action.payload as [string];
        if (!workspaceId) continue;
        const existing = running.get(workspaceId);
        if (existing) {
          existing.pending = true;
          continue;
        }
        const entry: RunningRead = { token: Symbol(workspaceId) };
        running.set(workspaceId, entry);
        entry.task = yield* fork(runRead, running, workspaceId, entry);
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
