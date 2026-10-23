import { takeEvery } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import { sidebarSectionNavigationSaga } from '$store/renderer/slices/sidebar-nav/sagas/sidebar-section-navigation-saga';
import { appLayoutNavigationSaga } from '$store/renderer/slices/app-layout/sagas/app-layout-navigation-saga';
import { activateSidebarSectionRequested } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';

/** Run only local navigation owners in the isolated browser fixture. */
export function startSidebarNavigationPreview(onActivate: () => void) {
  return [
    store.runSaga(sidebarSectionNavigationSaga),
    store.runSaga(appLayoutNavigationSaga),
    store.runSaga(function* () {
      yield* takeEvery(activateSidebarSectionRequested, function* () {
        onActivate();
      });
    }),
  ];
}
