import { call, delay, put, takeEvery, takeLatest } from 'typed-redux-saga';

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { USER_ACTIVITY_CHANNELS } from '$shared/ipc/channels';
import { selectReadRecords } from '../note-read-tracking-selectors';
import {
  computeUnreadNotesSuccess,
  markNoteRead,
  refreshUnreadNotes,
  setLoading,
} from '../note-read-tracking-slice';

const logger = createLogger('NoteReadTrackingSaga');

/** Coalesce rapid refresh dispatches (note updates arrive in bursts). */
export const COMPUTE_DEBOUNCE_MS = 100;

type IpcResult<T> = { success: boolean; data?: T; error?: string };

/** Persist the optimistic read record (the reducer already updated state). */
function* persistMarkNoteRead(action: ReturnType<typeof markNoteRead>) {
  const { workspaceId, noteId } = action.payload;
  try {
    const result = yield* call(invoke<IpcResult<never>>, USER_ACTIVITY_CHANNELS.MARK_NOTE_READ, {
      workspaceId,
      noteId,
    });
    // The handler try/catches internally and returns the failure envelope
    // rather than throwing — surface it so persistence failures aren't silent.
    if (!result?.success) {
      logger.warn('Failed to persist note read state', { noteId, error: result?.error });
    }
  } catch (error) {
    logger.warn('Failed to persist note read state', { noteId, error });
  }
}

/** Compute unread note IDs via the main-process user-activity service. */
function* computeUnreadNotes(action: ReturnType<typeof refreshUnreadNotes>) {
  const [workspaceId, notes] = action.payload;
  yield* put(setLoading(true));
  try {
    const result = yield* call(
      invoke<IpcResult<string[]>>,
      USER_ACTIVITY_CHANNELS.GET_UNREAD_NOTE_IDS,
      { workspaceId, notes },
    );
    if (!result?.success) {
      yield* put(setLoading(false));
      return;
    }

    // Drop notes whose optimistic local read record is at least as fresh as
    // the note's last update — main-process persistence may lag behind.
    const readRecords = yield* selectReadRecords.effect();
    const updatedAtById = new Map(notes.map((note) => [note.id, note.updatedAt]));
    const unreadIds = (result.data ?? []).filter((noteId) => {
      const record = readRecords[noteId];
      if (!record) return true;
      const updatedAt = updatedAtById.get(noteId);
      if (!updatedAt) return true;
      return new Date(updatedAt).getTime() > new Date(record.lastReadAt).getTime();
    });

    yield* put(computeUnreadNotesSuccess(unreadIds));
  } catch (error) {
    logger.warn('Failed to compute unread notes', { workspaceId, error });
    yield* put(setLoading(false));
  }
}

/** Debounce, then compute. Run under takeLatest (not `debounce`) so a newer
 * refresh cancels an in-flight compute — including its IPC await — and a
 * stale response can never overwrite a fresher computeUnreadNotesSuccess. */
function* debouncedComputeUnreadNotes(action: ReturnType<typeof refreshUnreadNotes>) {
  yield* delay(COMPUTE_DEBOUNCE_MS);
  yield* call(computeUnreadNotes, action);
}

/** Root saga: persists read marks and recomputes unread notes (debounced). */
export function* noteReadTrackingSaga() {
  yield* takeEvery(markNoteRead, persistMarkNoteRead);
  yield* takeLatest(refreshUnreadNotes, debouncedComputeUnreadNotes);
}
