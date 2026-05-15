import {
  call,
  put,
  takeEvery,
} from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import { USER_ACTIVITY_CHANNELS } from "$shared/ipc/channels";
import type { NoteReadRecord } from "$shared/types/user-activity.types";
import {
  markNoteRead,
  loadNoteReadStatus,
  loadNoteReadStatusSuccess,
  computeUnreadNotesSuccess,
  setLoading,
} from "../note-read-tracking-slice";
import {
  selectCurrentlyViewedNoteId,
  selectReadRecords,
} from "../note-read-tracking-selectors";

/**
 * Handle markNoteRead IPC call (fire-and-forget after optimistic update in reducer)
 */
function* handleMarkNoteRead(action: ReturnType<typeof markNoteRead>) {
  const { workspaceId, noteId } = action.payload;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const result: { success: boolean; error?: string } = yield* call(
      invoke<{ success: boolean; error?: string }>,
      USER_ACTIVITY_CHANNELS.MARK_NOTE_READ,
      { workspaceId, noteId }
    );
  } catch {
  }
}

/**
 * Handle loadNoteReadStatus IPC call
 */
function* handleLoadNoteReadStatus(action: ReturnType<typeof loadNoteReadStatus>) {
  const [workspaceId, noteId] = action.payload;
  try {
    const result: { success: boolean; data?: NoteReadRecord | null; error?: string } = yield* call(
      invoke<{ success: boolean; data?: NoteReadRecord | null; error?: string }>,
      USER_ACTIVITY_CHANNELS.GET_NOTE_READ_STATUS,
      { workspaceId, noteId }
    );
    if (!result.success) {
      return;
    }
    if (result.data) {
      yield* put(loadNoteReadStatusSuccess(noteId, result.data));
    }
  } catch {
  }
}

/**
 * Compute unread notes via IPC.
 * Uses takeLatest for auto-cancellation of stale requests.
 */
export function* handleComputeUnreadNotes(action: {
  payload: [
    workspaceId: string,
    notes: Array<{ id: string; updatedAt: string; createdAt?: string }>,
  ];
}) {
  const [workspaceId, notes] = action.payload;

  yield* put(setLoading(true));

  try {
    const result: { success: boolean; data?: string[]; error?: string } = yield* call(
      invoke<{ success: boolean; data?: string[]; error?: string }>,
      USER_ACTIVITY_CHANNELS.GET_UNREAD_NOTE_IDS,
      { workspaceId, notes }
    );

    if (!result.success) {
      yield* put(setLoading(false));
      return;
    }

    const unreadIdsFromBackend = result.data ?? [];
    const currentlyViewedId: string | null = yield* selectCurrentlyViewedNoteId.effect();

    // Build a map of note update times for local filtering
    const notesMap = new Map(notes.map((n) => [n.id, n.updatedAt]));

    // Get current read records from state for local filtering
    const readRecords: Record<string, NoteReadRecord> = yield* selectReadRecords.effect();

    const filteredUnreadIds = unreadIdsFromBackend.filter((noteId) => {
      // Never mark the currently viewed note as unread
      if (currentlyViewedId && noteId === currentlyViewedId) return false;

      const localReadRecord = readRecords[noteId];
      if (!localReadRecord) return true;

      const noteUpdatedAt = notesMap.get(noteId);
      if (!noteUpdatedAt) return true;

      const localReadTime = new Date(localReadRecord.lastReadAt).getTime();
      const noteUpdateTime = new Date(noteUpdatedAt).getTime();
      return noteUpdateTime > localReadTime;
    });

    yield* put(computeUnreadNotesSuccess(filteredUnreadIds));
  } catch {
    yield* put(setLoading(false));
  }
}

/**
 * Root watcher for IPC sagas
 */
export function* ipcSaga() {
  yield* takeEvery(markNoteRead, handleMarkNoteRead);
  yield* takeEvery(loadNoteReadStatus, handleLoadNoteReadStatus);
}

