import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import type { Task } from 'redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { call, cancel, delay, fork, put, spawn, take, type SagaGenerator } from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
import { gitRootsUpdated } from '../git-roots-slice';
import { selectActiveWorkspaceId } from '../../workspace/workspace-selectors';
import { subscribeGitRoots, type GitRootRow } from '$features/git-roots/git-roots-service';

const logger = createLogger('GitRootsSaga');

type SubscriptionEntry = {
  channel: EventChannel<GitRootRow[]>;
  task: Task;
};

const SUBSCRIPTION_RECONCILIATION_DELAY_MS = 100;

function createGitRootsChannel(workspaceId: string): EventChannel<GitRootRow[]> {
  return eventChannel<GitRootRow[]>((emit) => {
    const subscription = subscribeGitRoots(workspaceId, emit);
    return () => subscription.dispose();
  }, buffers.expanding<GitRootRow[]>());
}

function* forwardGitRootUpdates(
  workspaceId: string,
  channel: EventChannel<GitRootRow[]>,
): SagaGenerator<void> {
  try {
    while (true) {
      const gitRoots: GitRootRow[] = yield* take(channel);
      if (gitRoots === (END as unknown as GitRootRow[])) return;
      yield* put(gitRootsUpdated(workspaceId, gitRoots));
    }
  } finally {
    channel.close();
  }
}

function* reconcileGitRootsSubscriptions(
  active: Map<string, SubscriptionEntry>,
  activeWorkspaceId: string | null,
): SagaGenerator<void> {
  for (const [workspaceId, entry] of active) {
    if (workspaceId === activeWorkspaceId) continue;
    active.delete(workspaceId);
    yield* cancel(entry.task);
  }

  if (!activeWorkspaceId || active.has(activeWorkspaceId)) return;
  try {
    const channel = createGitRootsChannel(activeWorkspaceId);
    const task = yield* spawn(forwardGitRootUpdates, activeWorkspaceId, channel);
    active.set(activeWorkspaceId, { channel, task });
  } catch (error) {
    logger.error('Failed to subscribe to gitRoot events', {
      workspaceId: activeWorkspaceId,
      error,
    });
  }
}

function* watchActiveWorkspace(active: Map<string, SubscriptionEntry>): SagaGenerator<void> {
  const initialWorkspaceId = yield* selectActiveWorkspaceId.effect();
  let initialReconciliation: Task | null = null;
  initialReconciliation = yield* fork(function* () {
    try {
      yield* delay(SUBSCRIPTION_RECONCILIATION_DELAY_MS);
      yield* reconcileGitRootsSubscriptions(active, initialWorkspaceId);
    } finally {
      initialReconciliation = null;
    }
  });

  yield* takeLatestFromSelector(
    selectActiveWorkspaceId,
    function* ({ payload }: SelectorChannelPayload<string | null>) {
      if (initialReconciliation) {
        yield* cancel(initialReconciliation);
        initialReconciliation = null;
      }
      yield* delay(SUBSCRIPTION_RECONCILIATION_DELAY_MS);
      yield* reconcileGitRootsSubscriptions(active, payload);
    },
  );
}

export function* gitRootsSaga(): SagaGenerator<void> {
  const active = new Map<string, SubscriptionEntry>();
  try {
    // The call boundary keeps the try pending until root cancellation (the
    // watcher's internal fork never ends), so the finally sees a populated
    // `active` map.
    yield* call(watchActiveWorkspace, active);
  } finally {
    for (const entry of active.values()) yield* cancel(entry.task);
    active.clear();
  }
}
