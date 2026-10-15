import { takeLatest } from 'typed-redux-saga';
import type { SagaGenerator } from 'typed-redux-saga';
import { createBackendCommitHistoryReader } from '$lib/client/live/backend-commit-history-reader';
import { backendRequest } from '@/features/backend/backend-transport';
import { createCommitHistoryWorkers } from '../../../../../../src/store/renderer/slices/changes/sagas/commit-history-workers';
import {
  refreshRequested,
  loadMoreCommitsRequested,
  loadOlderCommitsRequested,
} from '../../../../../../src/store/renderer/slices/changes/changes-slice';
import { workspaceUnmounted } from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { selectAdmittedWorkspaceReadContext } from '../../workspace-lifecycle/workspace-lifecycle-selectors';
import { store } from '../../index';

const workers = createCommitHistoryWorkers({
  admittedContext: function* (workspaceId) {
    return yield* selectAdmittedWorkspaceReadContext.effect(workspaceId);
  },
  readCurrentContext: (workspaceId) =>
    selectAdmittedWorkspaceReadContext.select(store.state, workspaceId),
  readPage: async (workspaceId, options, current) => {
    const reader = createBackendCommitHistoryReader({
      isCurrent: current,
      request: (method, params) =>
        backendRequest(method, params, {
          onDispatch: () => {
            if (!current()) throw new Error('Commit history read retired');
          },
        }),
    });
    return reader(workspaceId, options);
  },
});

/** The connected host has one visible workspace. Source uses its existing scoped scheduler. */
export function* commitHistorySaga(): SagaGenerator<void> {
  yield* takeLatest(
    [refreshRequested, loadMoreCommitsRequested, loadOlderCommitsRequested, workspaceUnmounted],
    function* (action): SagaGenerator<void> {
      if (action.type === workspaceUnmounted.type) return;
      if (action.type === loadOlderCommitsRequested.type) {
        const request = action as ReturnType<typeof loadOlderCommitsRequested>;
        yield* workers.loadMore(request.payload.wsId, true);
      } else if (action.type === loadMoreCommitsRequested.type) {
        yield* workers.loadMore((action as ReturnType<typeof loadMoreCommitsRequested>).payload[0]);
      } else {
        yield* workers.refresh((action as ReturnType<typeof refreshRequested>).payload[0]);
      }
    },
  );
}
