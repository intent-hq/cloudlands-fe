import type {
  NoteCreatedPayload,
  NoteDeletedPayload,
  NoteUpdatedPayload,
  TaskStatusChangedPayload,
} from "$features/events/types";
import { notesIpc } from "./notes-ipc";
import { NOTES_CHANNELS } from "$shared/ipc/channels";
import { takeEveryFromListenSync } from "$lib/store/utils/ipc-channel";
import type { Note, WorkspaceId } from "$shared/types";
import { fork, put, takeEvery, call } from "typed-redux-saga";
import { notesCrudSaga } from "./notes-crud-saga";
import { selectNoteById } from "../workspace-notes-selectors";
import {
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  applyTaskStatusChanged,
  clearWorkspaceNotesForWorkspaces,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesRequested,
  loadWorkspaceNotesSucceeded,
  refreshWorkspaceNotesRequested,
  setWorkspaceNotesLoading,
} from "../workspace-notes-slice";
import { dispatchContentUpdateEvent } from "./dispatch-content-update-event";
import {
  asString,
  isFullNote,
  isRecord,
  isTaskStatus,
  normalizeNoteEventContent,
  normalizeNoteUpdateSource,
} from "../workspace-notes-normalization";

type TaskStatusChangedEventPayload = TaskStatusChangedPayload & {
  data?: { noteId?: string; newStatus?: string };
};
type NoteDeletedEventPayload = NoteDeletedPayload & { data?: { noteId?: string } };
type NoteCreatedEventPayload = NoteCreatedPayload & { note?: Note };
type NoteUpdatedEventPayload = NoteUpdatedPayload & {
  note?: Note;
  data?: { noteId?: string };
  // source is already on NoteUpdatedPayload; redeclared here for clarity
};

function normalizeWorkspaceIds(workspaceIds: string[]): string[] {
  return [...new Set(workspaceIds.filter(Boolean))];
}

function toWorkspaceNotesRecord(
  workspaceIds: string[],
  notesByWorkspace: unknown
): Record<string, Note[]> {
  const notesRecord = isRecord(notesByWorkspace) ? notesByWorkspace : {};
  return workspaceIds.reduce<Record<string, Note[]>>((acc, workspaceId) => {
    const notes = notesRecord[workspaceId];
    acc[workspaceId] = Array.isArray(notes)
      ? notes.filter((note): note is Note => isFullNote(note) && note.workspaceId === workspaceId)
      : [];
    return acc;
  }, {});
}

export function* handleLoadWorkspaceNotesRequested(
  action: ReturnType<typeof loadWorkspaceNotesRequested>
) {
  const [workspaceIds] = action.payload;
  const normalizedWorkspaceIds = normalizeWorkspaceIds(workspaceIds);
  if (normalizedWorkspaceIds.length === 0) return;

  yield* put(setWorkspaceNotesLoading(normalizedWorkspaceIds, true));

  try {
    const result = yield* call(
      notesIpc<Record<string, Note[]>>,
      NOTES_CHANNELS.BATCH_LIST,
      { workspaceIds: normalizedWorkspaceIds as WorkspaceId[] }
    );

    if (result.ok) {
      yield* put(
        loadWorkspaceNotesSucceeded(
          normalizedWorkspaceIds,
          toWorkspaceNotesRecord(normalizedWorkspaceIds, result.data)
        )
      );
      return;
    }

    yield* put(loadWorkspaceNotesFailed(normalizedWorkspaceIds, result.error));
  } catch (error) {
    yield* put(
      loadWorkspaceNotesFailed(
        normalizedWorkspaceIds,
        error instanceof Error ? error.message : "Unknown error"
      )
    );
  }
}

export function* handleRefreshWorkspaceNotesRequested(
  action: ReturnType<typeof refreshWorkspaceNotesRequested>
) {
  const [workspaceIds] = action.payload;
  const normalizedWorkspaceIds = normalizeWorkspaceIds(workspaceIds);
  if (normalizedWorkspaceIds.length === 0) return;

  yield* put(clearWorkspaceNotesForWorkspaces(normalizedWorkspaceIds));
  yield* call(handleLoadWorkspaceNotesRequested, loadWorkspaceNotesRequested(normalizedWorkspaceIds));
}

export function* watchLoadWorkspaceNotesRequestedSaga() {
  yield* takeEvery(loadWorkspaceNotesRequested, handleLoadWorkspaceNotesRequested);
}

export function* watchRefreshWorkspaceNotesRequestedSaga() {
  yield* takeEvery(refreshWorkspaceNotesRequested, handleRefreshWorkspaceNotesRequested);
}

export function* watchTaskStatusChangedSaga() {
  yield* takeEveryFromListenSync<TaskStatusChangedEventPayload>("task:status-changed", function* (data) {
    if (!isRecord(data)) return;
    const nestedData = isRecord(data.data) ? data.data : undefined;
    const workspaceId = asString(data.workspaceId);
    const noteId = asString(data.noteId) || asString(nestedData?.noteId);
    const newStatus = asString(data.newStatus) || asString(nestedData?.newStatus);

    if (!workspaceId || !noteId || !newStatus || !isTaskStatus(newStatus)) return;
    yield* put(applyTaskStatusChanged(workspaceId, noteId, newStatus));
  });
}

export function* watchNoteCreatedSaga() {
  yield* takeEveryFromListenSync<NoteCreatedEventPayload>("note:created", function* (data) {
    if (!isRecord(data)) return;
    const workspaceId = asString(data.workspaceId);
    if (!workspaceId || !isFullNote(data.note) || data.note.workspaceId !== workspaceId) return;
    yield* put(applyNoteCreated(workspaceId, data.note));
  });
}

export function* watchNoteDeletedSaga() {
  yield* takeEveryFromListenSync<NoteDeletedEventPayload>("note:deleted", function* (data) {
    if (!isRecord(data)) return;
    const nestedData = isRecord(data.data) ? data.data : undefined;
    const workspaceId = asString(data.workspaceId);
    const noteId = asString(data.noteId) || asString(nestedData?.noteId);
    if (!workspaceId || !noteId) return;
    yield* put(applyNoteDeleted(workspaceId, noteId));
  });
}

// Per-note sequence counter to prevent out-of-order updates from overwriting newer content.
// Key: `${workspaceId}:${noteId}`, Value: monotonic counter (Date.now())
const noteUpdateSequence = new Map<string, number>();

/** @internal Exported only for tests — clears the per-note sequence counter. */
export function _resetNoteUpdateSequence(): void {
  noteUpdateSequence.clear();
}

function makeNoteKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}:${noteId}`;
}

function isNewerUpdate(key: string, timestamp: number): boolean {
  const last = noteUpdateSequence.get(key) ?? 0;
  if (timestamp < last) return false;
  noteUpdateSequence.set(key, timestamp);
  return true;
}

export function* watchNoteUpdatedSaga() {
  yield* takeEveryFromListenSync<NoteUpdatedEventPayload>("note:updated", function* (data) {
    if (!isRecord(data)) return;
    const nestedData = isRecord(data.data) ? data.data : undefined;
    const eventNote = isRecord(data.note) ? data.note : undefined;
    const workspaceId = asString(data.workspaceId);
    const noteId = asString(data.noteId) || asString(nestedData?.noteId) || asString(eventNote?.id);
    if (!workspaceId || !noteId) return;

    const key = makeNoteKey(workspaceId, noteId);
    const timestamp = Date.now();
    const source = normalizeNoteUpdateSource(data.source);

    const hasTaskBlock = (c: string) => c.includes("@@@task") || c.includes("```task");

    // Fast path: use the full note from the event payload if available.
    // Skip if the content still has unconverted task blocks — a follow-up
    // event with converted content will arrive shortly and we don't want
    // to overwrite already-converted content with raw @@@task blocks.
    if (isFullNote(data.note)) {
      if (data.note.workspaceId !== workspaceId || hasTaskBlock(data.note.content)) return;
      if (isNewerUpdate(key, timestamp)) {
        yield* put(applyNoteUpdated(workspaceId, noteId, data.note));
        dispatchContentUpdateEvent(noteId, data.note.content, source, workspaceId);
      }
      return;
    }

    // Content-merge fast path: if the event has content and the note already
    // exists in the store, merge the content without an IPC roundtrip.
    // This prevents the race where two rapid note:updated events (pre-conversion
    // and post-conversion) both trigger IPC fetches that resolve out of order.
    const eventContent = normalizeNoteEventContent(data);
    if (eventContent !== undefined) {
      // Skip raw content that still has unconverted task blocks —
      // the conversion will emit a clean version shortly.
      if (hasTaskBlock(eventContent)) return;
      const existingNote: Note | undefined = yield* selectNoteById.effect(workspaceId, noteId);
      if (existingNote) {
        if (isNewerUpdate(key, timestamp)) {
          const mergedNote: Note = { ...existingNote, content: eventContent, updatedAt: new Date().toISOString() };
          yield* put(applyNoteUpdated(workspaceId, noteId, mergedNote));
          dispatchContentUpdateEvent(noteId, eventContent, source, workspaceId);
        }
        return;
      }
    }

    // Fallback: fetch the full note via IPC when payload doesn't include it
    const result = yield* call(notesIpc<Note>, NOTES_CHANNELS.GET, {
      workspaceId,
      noteId,
    });
    if (result.ok && result.data && isFullNote(result.data) && result.data.workspaceId === workspaceId) {
      if (isNewerUpdate(key, timestamp)) {
        yield* put(applyNoteUpdated(workspaceId, noteId, result.data));
        dispatchContentUpdateEvent(noteId, result.data.content, source, workspaceId);
      }
    }
  });
}

/** Clean up noteUpdateSequence entries for an unmounted workspace. */
export function* handleNoteSequenceCleanup(action: ReturnType<typeof workspaceUnmounted>) {
  const [wsId] = action.payload;
  const prefix = `${wsId}:`;
  for (const key of noteUpdateSequence.keys()) {
    if (key.startsWith(prefix)) {
      noteUpdateSequence.delete(key);
    }
  }
}

export function* workspaceNotesSaga() {
  yield* fork(watchLoadWorkspaceNotesRequestedSaga);
  yield* fork(watchRefreshWorkspaceNotesRequestedSaga);
  yield* fork(watchTaskStatusChangedSaga);
  yield* fork(watchNoteCreatedSaga);
  yield* fork(watchNoteDeletedSaga);
  yield* fork(watchNoteUpdatedSaga);
  yield* fork(notesCrudSaga);
  yield* takeEvery(workspaceUnmounted, handleNoteSequenceCleanup);
}