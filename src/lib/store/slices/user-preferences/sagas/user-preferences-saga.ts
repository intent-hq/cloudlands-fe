import { call, fork, put } from "typed-redux-saga";
import { takeLatestFromSelector } from "$lib/store/utils/selector-channel-effects";
import { initUserPreferencesSaga } from "./init-saga";
import { ipcZoomSaga } from "./ipc-saga";
import { persistenceUserPreferencesSaga } from "./persistence-saga";
import { resizeZoomSaga } from "./resize-saga";
import { selectShowProviderPanel } from "../user-preferences-selectors";
import { setOnboardingActive } from "$lib/store/slices/sidebar-nav/sidebar-nav-slice";

export function* userPreferencesSaga() {
  yield* call(initUserPreferencesSaga);
  yield* fork(persistenceUserPreferencesSaga);
  yield* takeLatestFromSelector(selectShowProviderPanel, function* ({ payload }) {
    yield* put(setOnboardingActive(payload));
  });
  yield* fork(ipcZoomSaga);
  yield* fork(resizeZoomSaga);
}