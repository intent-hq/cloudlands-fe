import { StartClient } from '@tanstack/react-start/client';
import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { store } from './store';
// eslint-disable-next-line themis/react-forbidden-component-import -- Browser bootstrap is the explicit saga startup and teardown owner.
import { catalogSaga } from './store/catalog/sagas/catalog-saga';
import { sidebarPreferencesSaga } from './store/sidebar-preferences/sagas/sidebar-preferences-saga';
// This entry runs only in the browser, before Start loads selector consumers.
const disposeStore = store.init();
const cancelCatalogSaga = store.runSaga(catalogSaga);
const cancelSidebarPreferencesSaga = store.runSaga(sidebarPreferencesSaga);
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
  disposeStore();
}

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
