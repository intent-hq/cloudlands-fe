import { store } from '@/store';
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
  ];
  return () => disposers.reverse().forEach((dispose) => dispose());
}
