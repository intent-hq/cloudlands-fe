import { createBackendGitCommitReader } from '$lib/client/live/backend-git-commit-reader';
import { createGitConsumerReadSaga } from '../../../../../../src/store/renderer/slices/git/sagas/git-consumer-read-saga-factory';
import { createBackendGitDiffReader } from '$lib/client/live/backend-git-diff-reader';
import { backendRequest } from '@/features/backend/backend-transport';
import { store } from '../../index';

import {
  getGitMutationVersion,
  isGitMutationPending,
  waitForGitMutations,
} from '../../../../../../src/store/renderer/utils/worktree-mutation-queue';
export const gitConsumerReadSaga = createGitConsumerReadSaga({
  dispatch: (action) => store.dispatch(action),
  getMutationVersion: getGitMutationVersion,
  isMutationPending: isGitMutationPending,
  waitForMutations: waitForGitMutations,
  read: async (workspaceId, request, signal, canRead) => {
    const current = () => !signal.aborted && canRead();
    const requestCurrent = async <T>(method: string, params: Record<string, unknown>) => {
      if (!current()) throw new Error('Git read retired');
      return backendRequest<T>(method, params, {
        onDispatch: () => {
          if (!current()) throw new Error('Git read retired');
        },
      });
    };
    if (request.kind === 'commitDetails') {
      const read = createBackendGitCommitReader(requestCurrent);
      const details = await read(workspaceId, request.commitHash, { gitRootId: request.gitRootId });
      if (!current()) throw new Error('Git read retired');
      return { kind: 'commitDetails', details };
    }
    if (request.kind !== 'diffs') throw new Error('Unsupported Git review request');
    const diffs = createBackendGitDiffReader(requestCurrent);
    const chunks = await diffs(workspaceId, request);
    if (!current()) throw new Error('Git read retired');
    return { kind: 'diffs', chunks };
  },
});
