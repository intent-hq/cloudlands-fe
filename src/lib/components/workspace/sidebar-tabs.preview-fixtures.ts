import { delay, put, takeEvery } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import { sidebarSectionNavigationSaga } from '$store/renderer/slices/sidebar-nav/sagas/sidebar-section-navigation-saga';
import { appLayoutNavigationSaga } from '$store/renderer/slices/app-layout/sagas/app-layout-navigation-saga';
import { activateSidebarSectionRequested } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  addExpandedPath,
  expandToPathRequested,
  incrementTreeVersion,
} from '$store/renderer/slices/file-explorer/file-explorer-slice';

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

/** Expand a revealed file's loaded ancestors after a deliberately slow, daemon-like delay. */
export function startFileRevealPreview(root: string, delayMs: number) {
  return store.runSaga(function* () {
    yield* takeEvery(expandToPathRequested, function* (action) {
      const [wsId, target] = action.payload;
      yield* delay(delayMs);
      const parts = target.slice(root.length).split('/').filter(Boolean).slice(0, -1);
      let current = root;
      for (const part of parts) {
        current = `${current}/${part}`;
        yield* put(addExpandedPath(wsId, current));
      }
      yield* put(incrementTreeVersion(wsId));
    });
  });
}
