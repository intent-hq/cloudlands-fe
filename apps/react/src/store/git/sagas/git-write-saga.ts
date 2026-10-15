import { call, put, type SagaGenerator } from 'typed-redux-saga';
import { createGitWriteSaga } from '../../../../../../src/store/renderer/slices/git/sagas/git-write-saga-factory';
import { selectGitWriteOperation } from '../git-write-selectors';
import { selectGitWorkspaceState } from '../git-selectors';
import {
  captureGitWriteAuthority,
  prepareGitFileWrite,
} from '@/features/workspace/git-write-runtime';
import { createBackendGitReadRuntime } from '$lib/client/live/backend-git-read-runtime';
import { backendRequest } from '@/features/backend/backend-transport';
import {
  gitReadsInvalidated,
  loadGitStatus,
  setGitStatus,
} from '../../../../../../src/store/renderer/slices/git/git-slice';
import { m } from '$shared/paraglide/messages.js';

export const gitWriteSaga = createGitWriteSaga({
  captureAuthority: captureGitWriteAuthority,
  selectOperation: selectGitWriteOperation.effect,
  selectStatus: function* (workspaceId) {
    return (yield* selectGitWorkspaceState.effect(workspaceId)).status;
  },
  prepare: function* (workspaceId, operation) {
    return yield* call(prepareGitFileWrite, workspaceId, operation);
  },
  optimisticStatus: false,
  reconcile: function* (workspaceId, requestId, lease, canPublish): SagaGenerator<void> {
    const reads = createBackendGitReadRuntime({
      request: async <T>(method: string, params: Record<string, unknown>) => {
        if (!canPublish()) throw new Error(m.workspace_client_accessChanged_error());
        return backendRequest<T>(method, params, {
          onDispatch: () => {
            if (!canPublish()) throw new Error(m.workspace_client_accessChanged_error());
          },
        });
      },
    });
    const status = yield* call(() =>
      lease.run(() => reads.status(workspaceId, { forceRefresh: true })),
    );
    const current = yield* selectGitWriteOperation.effect(workspaceId, requestId);
    if (status && current && !current.consumerReleased && canPublish())
      yield* put(setGitStatus(workspaceId, status));
  },
  invalidate: () => {}, // Reads use the shared mutation version and canonical Redux invalidation below.
  publish: function* (workspaceId, _operation, _result, canPublish) {
    if (canPublish()) yield* put(gitReadsInvalidated(workspaceId));
    if (canPublish()) yield* put(loadGitStatus(workspaceId, true));
  },
  unknownError: () => m.workspace_prSection_unknownError_label(),
  logError: (message, error) => console.error(message, error),
});
