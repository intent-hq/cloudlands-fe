import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { call, delay, getContext, type SagaGenerator } from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
import { gitRootsUpdated } from '../git-roots-slice';
import { selectGitRootConsumerWorkspaceIds } from '../git-roots-selectors';
import { subscribeGitRoots } from '$features/git-roots/git-roots-service';

const logger = createLogger('GitRootsSaga');

type SubscriptionEntry = { dispose(): void };
const SUBSCRIPTION_RECONCILIATION_DELAY_MS = 100;

function* reconcileGitRootsSubscriptions(
  active: Map<string, SubscriptionEntry>,
  activeWorkspaceIds: string[],
): SagaGenerator<void> {
  const desiredWorkspaceIds = new Set(activeWorkspaceIds);

  for (const [workspaceId, entry] of active) {
    if (desiredWorkspaceIds.has(workspaceId)) continue;
    active.delete(workspaceId);
    entry.dispose();
  }

  for (const workspaceId of activeWorkspaceIds) {
    if (active.has(workspaceId)) continue;
    try {
      const reduxStore = yield* getContext<{
        dispatch(action: ReturnType<typeof gitRootsUpdated>): unknown;
      }>('reduxStore');
      const entry: SubscriptionEntry = { dispose() {} };
      active.set(workspaceId, entry);
      const subscription = subscribeGitRoots(workspaceId, (rows) => {
        if (active.get(workspaceId) === entry)
          reduxStore.dispatch(gitRootsUpdated(workspaceId, rows));
      });
      entry.dispose = subscription.dispose;
    } catch (error) {
      logger.error('Failed to subscribe to gitRoot events', {
        workspaceId,
        error,
      });
    }
  }
}

function* watchActiveWorkspaces(active: Map<string, SubscriptionEntry>): SagaGenerator<void> {
  const initialWorkspaceIds = yield* selectGitRootConsumerWorkspaceIds.effect();
  // Init to now (not 0, unlike the pr-monitor/background-hooks watchers):
  // the inline reconcile below already covers the leading edge, so a change
  // arriving within the window of saga start is trailing-debounced.
  let lastChangeAt = Date.now();
  yield* reconcileGitRootsSubscriptions(active, initialWorkspaceIds);

  yield* takeLatestFromSelector(
    selectGitRootConsumerWorkspaceIds,
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
    for (const entry of active.values()) entry.dispose();
    active.clear();
  }
}
