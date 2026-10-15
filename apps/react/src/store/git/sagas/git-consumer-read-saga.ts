import { createGitConsumerReadSaga } from '../../../../../../src/store/renderer/slices/git/sagas/git-consumer-read-saga-factory';
import { createBackendGitDiffReader } from '$lib/client/live/backend-git-diff-reader';
import { backendRequest } from '@/features/backend/backend-transport';
import { store } from '../../index';

// This host exposes no Git mutations. The canonical source host retains its queue/version ports.
export const gitConsumerReadSaga = createGitConsumerReadSaga({
  dispatch: (action) => store.dispatch(action),
  getMutationVersion: () => 0,
  isMutationPending: () => false,
  waitForMutations: async () => {},
  read: async (workspaceId, request, signal, canRead) => {
    if (request.kind !== 'diffs') throw new Error('Unsupported Git review request');
    const current = () => !signal.aborted && canRead();
    const diffs = createBackendGitDiffReader(
      async <T>(method: string, params: Record<string, unknown>) => {
        if (!current()) throw new Error('Git read retired');
        return backendRequest<T>(method, params, {
          onDispatch: () => {
            if (!current()) throw new Error('Git read retired');
          },
        });
      },
    );
    const chunks = await diffs(workspaceId, request);
    if (!current()) throw new Error('Git read retired');
    return { kind: 'diffs', chunks };
  },
});
