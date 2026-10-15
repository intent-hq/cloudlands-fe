import { themeSaga } from '../../../../../src/store/renderer/slices/theme/sagas/theme-saga';
import { desktopFilePruneSaga } from '../files/sagas/desktop-file-prune-saga';
import { desktopFilesAutosaveSaga } from '../files/sagas/desktop-files-autosave-saga';
import { store } from '@/store';
import { desktopUnreadTrackingSaga } from '@/features/desktop/desktop-unread-runtime';
import { tabStateSaga } from '../tab-state/sagas/tab-state-saga';
import { sidebarNavSaga } from '../sidebar-nav/sagas/sidebar-nav-saga';
import { createReactPanelLayoutSagas } from '../panel-layout/sagas/panel-layout-saga';
import { lifecycleIpcReadSaga } from '../workspace-lifecycle/sagas/lifecycle-ipc-read-saga';
import { workspaceLoadCompositionSaga } from '../workspace-lifecycle/sagas/workspace-load-composition';

/** Desktop renderer root owns the lifetime, after the canonical read receivers start. */
export function startDesktopRuntime() {
  const { panelLayoutSaga } = createReactPanelLayoutSagas({
    // The React DOM host has no process-global Svelte panel adapter cache.
    clearPanelLayoutAdapter: () => {},
  });
  const disposers = [
    store.runSaga(lifecycleIpcReadSaga),
    store.runSaga(panelLayoutSaga),
    store.runSaga(sidebarNavSaga),
    store.runSaga(tabStateSaga),
    store.runSaga(workspaceLoadCompositionSaga),
    store.runSaga(desktopUnreadTrackingSaga),
    store.runSaga(desktopFilesAutosaveSaga),
    store.runSaga(desktopFilePruneSaga),
  ];
  return () => disposers.reverse().forEach((dispose) => dispose());
}

/** DOM theme ownership starts after the desktop root commits, never before HTML hydration. */
export function startDesktopTheme() {
  return store.runSaga(themeSaga);
}
