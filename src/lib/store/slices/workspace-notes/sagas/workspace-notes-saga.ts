import type {
  NoteCreatedPayload,
  NoteDeletedPayload,
  NoteUpdatedPayload,
  TaskStatusChangedPayload,
} from "$features/events/types";
import { notesIpc } from "./notes-ipc";
import { NOTES_CHANNELS } from "$shared/ipc/channels";
import { takeEveryFromListenSync } from "$lib/store/utils/ipc-channel";
import type { Note, TaskStatus, WorkspaceId } from "$shared/types";
import { fork, put, takeEvery, call, select, takeLeading } from "typed-redux-saga";
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

const TASK_STATUSES: TaskStatus[] = [
  "not_started",
  "waiting",
  "discussion_needed",
  "in_progress",
  "review_required",
  "complete",
  "cancelled",
];

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

function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

function isFullNote(note: NoteCreatedEventPayload["note"] | NoteUpdatedEventPayload["note"]): note is Note {
  return !!note &&
    typeof note.id === "string" &&
    typeof note.workspaceId === "string" &&
    typeof note.title === "string" &&
    typeof note.content === "string" &&
    typeof note.contentType === "string" &&
    Array.isArray(note.tags) &&
    typeof note.isPinned === "boolean" &&
    typeof note.isArchived === "boolean" &&
    typeof note.visibility === "string" &&
    typeof note.createdAt === "string" &&
    typeof note.updatedAt === "string";
}

function toWorkspaceNotesRecord(
  workspaceIds: string[],
  notesByWorkspace: Record<string, Note[]>
): Record<string, Note[]> {
  return workspaceIds.reduce<Record<string, Note[]>>((acc, workspaceId) => {
    acc[workspaceId] = notesByWorkspace[workspaceId] ?? [];
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
    const workspaceId = data.workspaceId;
    const noteId = data.noteId || data.data?.noteId;
    const newStatus = data.newStatus || data.data?.newStatus;

    if (!workspaceId || !noteId || !newStatus || !isTaskStatus(newStatus)) return;
    yield* put(applyTaskStatusChanged(workspaceId, noteId, newStatus));
  });
}

export function* watchNoteCreatedSaga() {
  yield* takeEveryFromListenSync<NoteCreatedEventPayload>("note:created", function* (data) {
    if (!data.workspaceId || !isFullNote(data.note)) return;
    yield* put(applyNoteCreated(data.workspaceId, data.note));
  });
}

export function* watchNoteDeletedSaga() {
  yield* takeEveryFromListenSync<NoteDeletedEventPayload>("note:deleted", function* (data) {
    const noteId = data.noteId || data.data?.noteId;
    if (!data.workspaceId || !noteId) return;
    yield* put(applyNoteDeleted(data.workspaceId, noteId));
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
    const noteId = data.noteId || data.data?.noteId || data.note?.id;
    if (!data.workspaceId || !noteId) return;

    const key = makeNoteKey(data.workspaceId, noteId);
    const timestamp = Date.now();
    const source = data.source ?? "external";

    const hasTaskBlock = (c: string) => c.includes("@@@task") || c.includes("```task");

    // Fast path: use the full note from the event payload if available.
    // Skip if the content still has unconverted task blocks — a follow-up
    // event with converted content will arrive shortly and we don't want
    // to overwrite already-converted content with raw @@@task blocks.
    if (isFullNote(data.note)) {
      if (hasTaskBlock(data.note.content ?? "")) return;
      if (isNewerUpdate(key, timestamp)) {
        yield* put(applyNoteUpdated(data.workspaceId, noteId, data.note));
        dispatchContentUpdateEvent(noteId, data.note.content, source, data.workspaceId);
      }
      return;
    }

    // Content-merge fast path: if the event has content and the note already
    // exists in the store, merge the content without an IPC roundtrip.
    // This prevents the race where two rapid note:updated events (pre-conversion
    // and post-conversion) both trigger IPC fetches that resolve out of order.
    const eventContent = data.content ?? data.changes?.content;
    if (eventContent !== undefined) {
      // Skip raw content that still has unconverted task blocks —
      // the conversion will emit a clean version shortly.
      if (hasTaskBlock(eventContent)) return;
      const existingNote: Note | undefined = yield* select(
        selectNoteById.select,
        data.workspaceId,
        noteId,
      );
      if (existingNote) {
        if (isNewerUpdate(key, timestamp)) {
          const mergedNote: Note = { ...existingNote, content: eventContent, updatedAt: new Date().toISOString() };
          yield* put(applyNoteUpdated(data.workspaceId, noteId, mergedNote));
          dispatchContentUpdateEvent(noteId, eventContent, source, data.workspaceId);
        }
        return;
      }
    }

    // Fallback: fetch the full note via IPC when payload doesn't include it
    const result = yield* call(notesIpc<Note>, NOTES_CHANNELS.GET, {
      workspaceId: data.workspaceId,
      noteId,
    });
    if (result.ok && result.data && isFullNote(result.data)) {
      if (isNewerUpdate(key, timestamp)) {
        yield* put(applyNoteUpdated(data.workspaceId, noteId, result.data));
        dispatchContentUpdateEvent(noteId, result.data.content, source, data.workspaceId);
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