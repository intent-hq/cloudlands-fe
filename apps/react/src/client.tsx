import { StartClient } from '@tanstack/react-start/client';
import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { store } from './store';
import { startProviderRuntime } from './store/provider-runtime';
// eslint-disable-next-line themis/react-forbidden-component-import -- Browser bootstrap is the explicit saga startup and teardown owner.
import { catalogSaga } from './store/catalog/sagas/catalog-saga';
import { sidebarPreferencesSaga } from './store/sidebar-preferences/sagas/sidebar-preferences-saga';
import { autoUpdateSaga } from './store/auto-update/sagas/auto-update-saga';
import { uiLayoutPersistenceSaga } from './store/ui-layout/sagas/ui-layout-persistence-saga';
import { backendConnectionSaga } from './features/backend/sagas/backend-connection-saga';
import { directoryPickerSaga } from './store/directory-picker/sagas/directory-picker-saga';
import { linkTooltipSaga } from './store/link-tooltip/sagas/link-tooltip-saga';
import { agentMemorySaga } from './store/daemon-health/sagas/agent-memory-saga';
import { agentMetadataSaga } from './store/agent-session/sagas/agent-metadata-saga';
import { agentModelSaga } from './store/agent-model/sagas/agent-model-saga';
import { hasAutoUpdatePreload } from './features/auto-update/auto-update.client';
import { notesContentReadSaga } from './store/workspace-notes/sagas/notes-content-read-saga';
import { gitStatusReadSaga } from './store/git/sagas/git-status-read-saga';
import { initAutoUpdate } from '../../../src/store/renderer/slices/auto-update/auto-update-slice';
// This entry runs only in the browser, before Start loads selector consumers.
const disposeStore = store.init();
const cancelCatalogSaga = store.runSaga(catalogSaga);
const cancelSidebarPreferencesSaga = store.runSaga(sidebarPreferencesSaga);
const cancelAutoUpdateSaga = store.runSaga(autoUpdateSaga);
const cancelUiLayoutPersistenceSaga = store.runSaga(uiLayoutPersistenceSaga);
const cancelBackendConnectionSaga = store.runSaga(backendConnectionSaga);
const disposeProviderRuntime = startProviderRuntime();
const cancelAgentMetadataSaga = store.runSaga(agentMetadataSaga);
const cancelAgentModelSaga = store.runSaga(agentModelSaga);
const cancelDirectoryPickerSaga = store.runSaga(directoryPickerSaga);
const cancelLinkTooltipSaga = store.runSaga(linkTooltipSaga);
const cancelAgentMemorySaga = store.runSaga(agentMemorySaga);
const cancelNotesContentReadSaga = store.runSaga(notesContentReadSaga);
const cancelGitStatusReadSaga = store.runSaga(gitStatusReadSaga);
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
  cancelDirectoryPickerSaga();
  cancelLinkTooltipSaga();
  cancelAgentMemorySaga();
  cancelAgentModelSaga();
  cancelAgentMetadataSaga();
  cancelNotesContentReadSaga();
  cancelGitStatusReadSaga();
  disposeProviderRuntime();
  cancelBackendConnectionSaga();
  disposeStore();
}

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
