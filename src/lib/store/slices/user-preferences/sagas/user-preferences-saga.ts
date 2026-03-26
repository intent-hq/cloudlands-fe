import { call, fork } from "typed-redux-saga";
import { sidebarNavStore } from "$lib/components/layout/sidebar-nav/sidebar-nav.store.svelte";
import { takeLatestFromSelector } from "$lib/store/utils/selector-channel-effects";
import { initUserPreferencesSaga } from "./init-saga";
import { ipcZoomSaga } from "./ipc-saga";
import { persistenceUserPreferencesSaga } from "./persistence-saga";
import { resizeZoomSaga } from "./resize-saga";
import { selectShowProviderPanel } from "../user-preferences-selectors";

function syncSidebarOnboardingActive(active: boolean): void {
  sidebarNavStore.setOnboardingActive(active);
}

export function* userPreferencesSaga() {
  yield* call(initUserPreferencesSaga);
  yield* fork(persistenceUserPreferencesSaga);
  yield* takeLatestFromSelector(selectShowProviderPanel, function* ({ payload }) {
    yield* call(syncSidebarOnboardingActive, payload);
  });
  yield* fork(ipcZoomSaga);
  yield* fork(resizeZoomSaga);
}