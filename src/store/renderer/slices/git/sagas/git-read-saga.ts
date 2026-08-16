import type { SagaGenerator } from 'typed-redux-saga';
import { call, join, put } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { GitStatus } from '$shared/types';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { loadGitStatus, setGitStatus } from '../git-slice';
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
  yield* join(watcher);
}
