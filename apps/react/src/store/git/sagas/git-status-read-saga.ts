import { readGitLocks } from '@/features/workspace/git-lock-runtime';
import { createGitStatusReadSaga } from '../../../../../../src/store/renderer/slices/git/sagas/git-status-read-saga-factory';
import { createBackendGitReadRuntime } from '$lib/client/live/backend-git-read-runtime';
import { backendRequest } from '@/features/backend/backend-transport';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { store } from '../../index';
import { selectAdmittedWorkspaceReadContext } from '../../workspace-lifecycle/workspace-lifecycle-selectors';

const selectStatusContext = store.createSelector((state, workspaceId: string) => {
  const context = selectAdmittedWorkspaceReadContext.select(state, workspaceId);
  const workspace = selectWorkspaceById.select(state, workspaceId);
  const root = workspace?.worktreePath || workspace?.repositoryPath;
  return context && root ? JSON.stringify([context, root]) : null;
});

const reads = createBackendGitReadRuntime({ request: backendRequest });

export const gitStatusReadSaga = createGitStatusReadSaga({
  readStatus: reads.status,
  beforeRead: async (workspaceId, current) => {
    // A failed write-lock read does not hide independently admitted Git status.
    await readGitLocks(workspaceId, current).catch(() => undefined);
  },
  admission: {
    readCurrentContext: (workspaceId) => selectStatusContext.select(store.state, workspaceId),
    dispatch: (action) => store.dispatch(action),
  },
  reportReadState: true,
});
