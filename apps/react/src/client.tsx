import { agentRenameSaga } from './store/agent-session/sagas/agent-rename-saga';
import { workspaceTitleSaga } from './store/workspace/sagas/workspace-title-saga';
import { terminalInteractionSaga } from './store/terminals/sagas/terminal-interaction-saga';
import { fileExplorerSaga } from './store/file-explorer/sagas/file-explorer-saga';
import { commitHistorySaga } from './store/changes/sagas/commit-history-saga';
import { gitWriteSaga } from './store/git/sagas/git-write-saga';
import { gitConsumerReadSaga } from './store/git/sagas/git-consumer-read-saga';
import { workspaceInitializerSaga } from './store/workspace-initializer/sagas/workspace-initializer-saga';
import { agentCreationSaga } from './store/workspace-agents/sagas/agent-creation-saga';
import { chatCommandsSaga } from './store/chat-state/sagas/chat-commands-saga';
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
import { notesWriteSaga } from './store/workspace-notes/sagas/notes-write-saga';
import { gitStatusReadSaga } from './store/git/sagas/git-status-read-saga';
import { readOnlyChatSaga } from './store/chat-state/sagas/read-only-chat-saga';
import { filesSaveSaga } from './store/files/sagas/files-save-saga';
import { filesReadSaga } from './store/files/sagas/files-read-saga';
import { initAutoUpdate } from '../../../src/store/renderer/slices/auto-update/auto-update-slice';
// This entry runs only in the browser, before Start loads selector consumers.
const disposeStore = store.init();
const cancelCatalogSaga = store.runSaga(catalogSaga);
const cancelSidebarPreferencesSaga = store.runSaga(sidebarPreferencesSaga);
const cancelAutoUpdateSaga = store.runSaga(autoUpdateSaga);
const cancelUiLayoutPersistenceSaga = store.runSaga(uiLayoutPersistenceSaga);
const cancelBackendConnectionSaga = store.runSaga(backendConnectionSaga);
const disposeProviderRuntime = startProviderRuntime();
const cancelWorkspaceInitializerSaga = store.runSaga(workspaceInitializerSaga);
const cancelAgentRenameSaga = store.runSaga(agentRenameSaga);
const cancelAgentCreationSaga = store.runSaga(agentCreationSaga);
const cancelAgentMetadataSaga = store.runSaga(agentMetadataSaga);
const cancelAgentModelSaga = store.runSaga(agentModelSaga);
const cancelDirectoryPickerSaga = store.runSaga(directoryPickerSaga);
const cancelLinkTooltipSaga = store.runSaga(linkTooltipSaga);
const cancelAgentMemorySaga = store.runSaga(agentMemorySaga);
const cancelNotesContentReadSaga = store.runSaga(notesContentReadSaga);
const cancelNotesWriteSaga = store.runSaga(notesWriteSaga);
const cancelCommitHistorySaga = store.runSaga(commitHistorySaga);
const cancelGitConsumerReadSaga = store.runSaga(gitConsumerReadSaga);
const cancelGitWriteSaga = store.runSaga(gitWriteSaga);
const cancelGitStatusReadSaga = store.runSaga(gitStatusReadSaga);
const cancelFilesSaveSaga = store.runSaga(filesSaveSaga);
const cancelFilesReadSaga = store.runSaga(filesReadSaga);
const cancelTerminalInteractionSaga = store.runSaga(terminalInteractionSaga);
const cancelWorkspaceTitleSaga = store.runSaga(workspaceTitleSaga);
const cancelFileExplorerSaga = store.runSaga(fileExplorerSaga);
const cancelChatCommandsSaga = store.runSaga(chatCommandsSaga);
const cancelReadOnlyChatSaga = store.runSaga(readOnlyChatSaga);
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
  cancelAgentCreationSaga();
  cancelAgentRenameSaga();
  cancelNotesContentReadSaga();
  cancelNotesWriteSaga();
  cancelGitWriteSaga();
  cancelGitStatusReadSaga();
  cancelGitConsumerReadSaga();
  cancelCommitHistorySaga();
  cancelFilesSaveSaga();
  cancelFilesReadSaga();
  cancelFileExplorerSaga();
  cancelTerminalInteractionSaga();
  cancelWorkspaceTitleSaga();
  cancelChatCommandsSaga();
  cancelReadOnlyChatSaga();
  cancelWorkspaceInitializerSaga();
  disposeProviderRuntime();
  cancelBackendConnectionSaga();
  disposeStore();
}

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
