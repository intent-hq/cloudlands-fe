import { put, takeEvery } from 'redux-saga/effects';
import { store } from '$store/renderer/store';
import { refreshScripts, setScriptListState } from '$store/renderer/slices/scripts/scripts-slice';

export function observeSidebarRefresh(workspaceId: string, onRefresh: () => void) {
  return store.runSaga(function* () {
    yield takeEvery(refreshScripts.type, function* (action: ReturnType<typeof refreshScripts>) {
      if (action.payload[0] !== workspaceId) return;
      onRefresh();
      yield put(setScriptListState(workspaceId, true));
    });
  });
}
