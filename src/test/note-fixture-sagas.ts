import type { store } from '$store/renderer/store';
import { notesReadSaga } from '$store/renderer/slices/workspace-notes/sagas/notes-read-saga';

/** Standalone previews own note reads until their fixture is disposed. */
export function startNoteFixtureReads(appStore: Pick<typeof store, 'runSaga'>) {
  return appStore.runSaga(notesReadSaga);
}
