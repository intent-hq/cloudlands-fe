import { notePagesSaga } from '../../note-pages/sagas/note-pages-saga';
import { all, call } from 'typed-redux-saga';

import { noteVersionsSaga } from './note-versions-saga';
import { notesReadSaga } from './notes-read-saga';
import { notesWriteSaga } from './notes-write-saga';

export function* workspaceNotesSaga() {
  yield* all([
    call(notePagesSaga),
    call(notesReadSaga),
    call(notesWriteSaga),
    call(noteVersionsSaga),
  ]);
}
