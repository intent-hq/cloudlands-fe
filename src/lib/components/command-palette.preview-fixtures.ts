import { store as appStore } from '$store/renderer/store';
import { notesReadSaga } from '$store/renderer/slices/workspace-notes/sagas/notes-read-saga';
import { installMockElectronBridge } from '../../test/ct-mock-electron-bridge';

export function setupPaletteSearchPreview() {
  const previousBridge = window.electronAPI;
  installMockElectronBridge({
    'search.notes': () => ({ requestId: 'preview-note-search', indexed: true, matches: [] }),
    'search.messages': () => ({ matches: [] }),
    'search.fileNames': () => ({ files: [] }),
  });
  const fixtureBridge = window.electronAPI;
  // CT does not start application sagas; indexed queries still need their real worker.
  const stop = appStore.runSaga(notesReadSaga);
  return () => {
    stop();
    if (window.electronAPI === fixtureBridge) window.electronAPI = previousBridge;
  };
}
