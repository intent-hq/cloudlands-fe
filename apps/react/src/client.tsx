import { StartClient } from '@tanstack/react-start/client';
import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { store } from './store';
// eslint-disable-next-line themis/react-forbidden-component-import -- Browser bootstrap is the explicit saga startup and teardown owner.
import { catalogSaga } from './store/catalog/sagas/catalog-saga';
import { sidebarPreferencesSaga } from './store/sidebar-preferences/sagas/sidebar-preferences-saga';
import { autoUpdateSaga } from './store/auto-update/sagas/auto-update-saga';
import { uiLayoutPersistenceSaga } from './store/ui-layout/sagas/ui-layout-persistence-saga';
import { hasAutoUpdatePreload } from './features/auto-update/auto-update.client';
import { initAutoUpdate } from '../../../src/store/renderer/slices/auto-update/auto-update-slice';
// This entry runs only in the browser, before Start loads selector consumers.
const disposeStore = store.init();
const cancelCatalogSaga = store.runSaga(catalogSaga);
const cancelSidebarPreferencesSaga = store.runSaga(sidebarPreferencesSaga);
const cancelAutoUpdateSaga = store.runSaga(autoUpdateSaga);
const cancelUiLayoutPersistenceSaga = store.runSaga(uiLayoutPersistenceSaga);
if (hasAutoUpdatePreload()) store.dispatch(initAutoUpdate());
let root: ReturnType<typeof hydrateRoot>;
startTransition(() => {
  root = hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});

function dispose() {
  root?.unmount();
  cancelCatalogSaga();
  cancelSidebarPreferencesSaga();
  cancelAutoUpdateSaga();
  cancelUiLayoutPersistenceSaga();
  disposeStore();
}

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
