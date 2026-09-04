import { all, call } from 'typed-redux-saga';

import { noteVersionsSaga } from './note-versions-saga';
import { notesReadSaga } from './notes-read-saga';
import { notesWriteSaga } from './notes-write-saga';

export function* workspaceNotesSaga() {
  yield* all([call(notesReadSaga), call(notesWriteSaga), call(noteVersionsSaga)]);
}
