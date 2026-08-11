import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { all, call, fork, put, race, take, takeLatest } from 'typed-redux-saga';

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
      // Gitlink (submodule) marking — present only on 160000 entries (#1739).
      ...(file.mode !== undefined ? { mode: file.mode } : {}),
      ...(file.oldSha !== undefined ? { oldSha: file.oldSha } : {}),
      ...(file.newSha !== undefined ? { newSha: file.newSha } : {}),
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

function matchesWorkspaceCleanup(workspaceId: string) {
  return (action: { type: string; payload?: unknown }) =>
    (action.type === workspaceDeleted.type || action.type === workspaceUnmounted.type) &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId;
}

function* loadGitStatusRequestWorker(action: ReturnType<typeof loadGitStatus>) {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* race({
    read: call(loadGitStatusWorker, workspaceId),
    cleanup: take(matchesWorkspaceCleanup(workspaceId)),
  });
}

export function* gitReadSaga() {
  yield* all([
    fork(watchGitStatusSubscription),
    takeLatest(loadGitStatus, loadGitStatusRequestWorker),
  ]);
}
