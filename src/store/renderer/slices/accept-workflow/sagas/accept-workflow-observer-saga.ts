import { takeEveryFromSelector } from '@themislib/themis/saga';
import { channel, buffers } from 'redux-saga';
import { call, fork, join, put, type SagaGenerator } from 'typed-redux-saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import { toLockRecord } from '$features/file-tracking/file-tracking.client';
import { selectLockedAgentIds, selectLockedFilePaths } from '../../agent-lock/agent-lock-selectors';
import { setAgentLockState } from '../../agent-lock/agent-lock-slice';
import { selectPostMergeState } from '../../git/git-selectors';
import { setPostMergeState } from '../../git/git-slice';
import { initializeGitHubAuth } from '../../github-auth/github-auth-slice';
import { refreshPRStatusRequested } from '../../pr-status/pr-status-slice';
import { syncWorkspaceSettings } from '../../workspace-settings/workspace-settings-slice';
import {
  selectAcceptObservation,
  selectAcceptObserverWorkspaceIds,
} from '../accept-workflow-selectors';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';

function* hydrate(workspaceId: string): SagaGenerator<void> {
  yield* put(syncWorkspaceSettings(workspaceId));
  const agents = yield* selectLockedAgentIds.effect(workspaceId);
  const files = yield* selectLockedFilePaths.effect(workspaceId);
  let result = { lockedAgentIds: [] as string[], lockedFilePaths: [] as string[] };
  try {
    result = yield* call(backendRequest<typeof result>, 'file-tracking.getAgentLocks', {
      workspaceId,
    });
  } catch {
    // Preserve the existing unlocked fallback; a live event always wins over this read.
  }
  if (
    agents === (yield* selectLockedAgentIds.effect(workspaceId)) &&
    files === (yield* selectLockedFilePaths.effect(workspaceId))
  ) {
    yield* put(
      setAgentLockState(
        workspaceId,
        toLockRecord(result.lockedAgentIds),
        toLockRecord(result.lockedFilePaths),
      ),
    );
  }
}

type ObservationLifecycle = { workspaceId: string; closed: boolean };

function* observe({ workspaceId }: ObservationLifecycle): SagaGenerator<void> {
  let lastPushedCount = 0;
  let initialDiscovery = false;
  yield* fork(hydrate, workspaceId);
  const watcher = yield* takeEveryFromSelector(
    selectAcceptObservation,
    [workspaceId],
    function* ({ payload }) {
      if (!payload.visible) return;
      if (payload.clearReset || payload.clearMerge) {
        const current = yield* selectPostMergeState.effect(workspaceId);
        yield* put(
          setPostMergeState(workspaceId, {
            ...current,
            ...(payload.clearReset ? { hasResetToTrunk: false } : {}),
            ...(payload.clearMerge
              ? { isMergedToTrunk: false, mergeHeadSha: null, isContentMergedToTrunk: false }
              : {}),
          }),
        );
      }
      if (!payload.ready || !payload.owner || !payload.authenticated) return;
      if (payload.pushedCount > 0) {
        if (payload.pushedCount === lastPushedCount) return;
        lastPushedCount = payload.pushedCount;
      } else {
        if (initialDiscovery || !payload.hasRemote) return;
        initialDiscovery = true;
      }
      yield* put(refreshPRStatusRequested(workspaceId, false, false));
    },
  );
  yield* join(watcher);
}

/** One context lifetime per workspace; visibility never restarts accepted work. */
export function* acceptWorkflowObserverSaga(): SagaGenerator<void> {
  const lifecycle = channel<ObservationLifecycle>(buffers.expanding());
  let authInitialized = false;
  try {
    const owner = yield* takeSingleFlightInContext(
      lifecycle,
      (message) =>
        message.closed
          ? { context: message.workspaceId, cancel: true as const }
          : message.workspaceId,
      observe,
    );
    yield* takeEveryFromSelector(
      selectAcceptObserverWorkspaceIds,
      function* ({ payload, prevPayload }) {
        if (payload.length > 0 && !authInitialized) {
          authInitialized = true;
          yield* put(initializeGitHubAuth());
        }
        for (const workspaceId of prevPayload ?? []) {
          if (!payload.includes(workspaceId)) yield* put(lifecycle, { workspaceId, closed: true });
        }
        for (const workspaceId of payload) {
          if (!prevPayload?.includes(workspaceId))
            yield* put(lifecycle, { workspaceId, closed: false });
        }
      },
    );
    yield* join(owner);
  } finally {
    lifecycle.close();
  }
}
