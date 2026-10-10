import { store as appStore } from '$store/renderer/store';
import { notesReadSaga } from '$store/renderer/slices/workspace-notes/sagas/notes-read-saga';
import { admitLegacyPrincipal } from './principal-state';

/** Starts the production read owner for the isolated attribution component fixture. */
export function startLineAttributionReadFixture(): () => void {
  admitLegacyPrincipal();
  return appStore.runSaga(notesReadSaga);
}
