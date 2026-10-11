import { call, takeEvery } from 'typed-redux-saga';
import { persistSidebarOpen } from '../sidebar-preferences-slice';
import { saveSidebarOpen } from '../sidebar-preferences-storage';

function* persistOpen({ payload: [open] }: ReturnType<typeof persistSidebarOpen>) {
  yield* call(saveSidebarOpen, open);
}

export function* sidebarPreferencesSaga() {
  yield* takeEvery(persistSidebarOpen, persistOpen);
}
