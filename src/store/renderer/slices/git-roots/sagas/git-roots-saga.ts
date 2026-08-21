import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import type { Task } from 'redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { call, cancel, delay, put, spawn, take, type SagaGenerator } from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
import { gitRootsUpdated } from '../git-roots-slice';
import { selectActiveWorkspaceIds } from '../../tab-state/tab-state-selectors';
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
  activeWorkspaceIds: string[],
): SagaGenerator<void> {
  const desiredWorkspaceIds = new Set(activeWorkspaceIds);

  for (const [workspaceId, entry] of active) {
    if (desiredWorkspaceIds.has(workspaceId)) continue;
    active.delete(workspaceId);
    yield* cancel(entry.task);
  }

  for (const workspaceId of activeWorkspaceIds) {
    if (active.has(workspaceId)) continue;
    try {
      const channel = createGitRootsChannel(workspaceId);
      const task = yield* spawn(forwardGitRootUpdates, workspaceId, channel);
      active.set(workspaceId, { channel, task });
    } catch (error) {
      logger.error('Failed to subscribe to gitRoot events', {
        workspaceId,
        error,
      });
    }
  }
}

function* watchActiveWorkspaces(active: Map<string, SubscriptionEntry>): SagaGenerator<void> {
  const initialWorkspaceIds = yield* selectActiveWorkspaceIds.effect();
  let lastChangeAt = Date.now();
  yield* reconcileGitRootsSubscriptions(active, initialWorkspaceIds);

  yield* takeLatestFromSelector(
    selectActiveWorkspaceIds,
    function* ({ payload }: SelectorChannelPayload<string[]>) {
      // Leading edge is immediate: only a change arriving within the window
      // of the previous one is trailing-debounced (takeLatest cancels the
      // superseded run), so rapid tab flapping still coalesces.
      const sinceLastChange = Date.now() - lastChangeAt;
      lastChangeAt = Date.now();
      if (sinceLastChange < SUBSCRIPTION_RECONCILIATION_DELAY_MS) {
        yield* delay(SUBSCRIPTION_RECONCILIATION_DELAY_MS);
      }
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
    yield* call(watchActiveWorkspaces, active);
  } finally {
    for (const entry of active.values()) yield* cancel(entry.task);
    active.clear();
  }
}
