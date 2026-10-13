import { createGitStatusReadSaga } from '../../../../../../src/store/renderer/slices/git/sagas/git-status-read-saga-factory';
import { createBackendGitReadRuntime } from '$lib/client/live/backend-git-read-runtime';
import { backendRequest } from '@/features/backend/backend-transport';
import { store } from '../../index';
import { selectAdmittedWorkspaceReadContext } from '../../workspace-lifecycle/workspace-lifecycle-selectors';

const reads = createBackendGitReadRuntime({ request: backendRequest });

export const gitStatusReadSaga = createGitStatusReadSaga({
  readStatus: reads.status,
  admission: {
    readCurrentContext: (workspaceId) =>
      selectAdmittedWorkspaceReadContext.select(store.state, workspaceId),
    dispatch: (action) => store.dispatch(action),
  },
  reportReadState: true,
});
