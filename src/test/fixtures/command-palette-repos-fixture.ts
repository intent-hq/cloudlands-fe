import { takeEvery } from 'typed-redux-saga';
import { store as appStore } from '$store/renderer/store';
import { knownReposLoadSaga } from '$store/renderer/slices/workspace-initializer/sagas/workspace-initializer-repository-saga';
import { workspaceInitializerRecentReposRefreshRequested } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';

/**
 * Run the real palette repo-load saga and record each full load it starts.
 * Nothing answers a load; the caller finishes it by dispatching
 * `workspaceInitializerRecentReposRefreshFinished` with a recorded id.
 */
export function trackKnownRepoLoads() {
  const loads: Array<{ id: string; requestId: string }> = [];
  const stopLoads = appStore.runSaga(function* () {
    yield* takeEvery(workspaceInitializerRecentReposRefreshRequested, function* (action) {
      const [id, requestId] = action.payload;
      loads.push({ id, requestId });
    });
  });
  const stopSaga = appStore.runSaga(knownReposLoadSaga);
  return {
    loads,
    stop: () => {
      stopSaga();
      stopLoads();
    },
  };
}
