/**
 * Notes CRUD Saga
 *
 * Handles note create/update/delete, debounced saves, note selection,
 * content updates, and external update handling.
 * Replaces the async methods from the old notes.store.svelte.ts.
 */
import { notesIpc } from "./notes-ipc";
import { NOTES_CHANNELS } from "$shared/ipc/channels";
import type { Note, UpdateNoteRequest, CreateNoteRequest } from "$shared/types";
import {
  AuthorType,
  ContentType,
  NoteVisibility,
} from "$shared/types";
import {
  NoteId,
  WorkspaceId,
} from "$shared/types/branded-ids";
import { SPEC_NOTE_ID } from "$shared/constants/notes";
import {
  call,
  delay,
  fork,
  put,
  takeEvery,
  takeLatest,
} from "typed-redux-saga";
import {
  selectNote,
  updateNoteContent,
  updateNoteTitle,
  createNote,
  deleteNote,
  updateNote,
  flushPendingSaves,
  handleExternalNoteUpdate,
  initializeNotes,
  reloadNotes,
  cleanupWorkspaceNotes,
  assignAgentToTask,
  updateTaskStatus,
  restoreNoteVersion,
  fetchReadyTasks,
  applyReadyTasks,
  applyReadyTasksError,
  fetchNoteVersions,
  applyNoteVersions,
  applyNoteVersionsError,
  applyLocalNoteUpdate,
  addOptimisticNote,
  setIsUserTyping,
  setLastUserInputTime,
  loadWorkspaceNotesSucceeded,
  loadWorkspaceNotesFailed,
  setWorkspaceNotesLoading,
  applyNoteDeleted,
} from "../workspace-notes-slice";
import { markNoteRead } from "../../note-read-tracking/note-read-tracking-slice";
import { Logger } from "$shared/logger";
import { getItem } from "$lib/store/utils/collection-utils";
import { selectWorkspaceNotesState } from "../workspace-notes-selectors";
import {
  isFullNote,
  normalizeNoteUpdatePatch,
  normalizeNoteUpdateSource,
} from "../workspace-notes-normalization";

const logger = new Logger("NotesCrudSaga");

const SAVE_DEBOUNCE_MS = 2000;

// ============================================================================
// Internal state for debounced saves (saga-scoped, not in Redux)
// ============================================================================
const pendingSaves = new Map<string, { noteId: string; updates: Partial<Note>; workspaceId: string }>();

// ============================================================================
// Initialize notes for a workspace
// ============================================================================
export function* handleInitializeNotes(action: ReturnType<typeof initializeNotes>) {
  const [workspaceId, initialSelectedNoteId] = action.payload;
  if (!workspaceId) return;

  // Set loading
  yield* put(setWorkspaceNotesLoading([workspaceId], true));

  // Set initial selected note if provided
  if (initialSelectedNoteId) {
    yield* put(selectNote(workspaceId, initialSelectedNoteId));
  }

  const isOptimisticWorkspace = workspaceId.startsWith("optimistic-");

  try {
    const result = yield* call(notesIpc<Note[]>, NOTES_CHANNELS.LIST, { workspaceId });

    if (result.ok) {
      // Filter notes that belong to this workspace
      const validNotes = normalizeIpcNotes(result.data, workspaceId);

      // For optimistic workspaces, ensure spec note exists
      let notes = validNotes;
      if (isOptimisticWorkspace && !notes.some((n) => n.id === SPEC_NOTE_ID)) {
        notes = [...notes, createPlaceholderSpec(workspaceId)];
      }

      // Log spec content for debugging first-load race condition
      const specNote = notes.find((n) => n.id === SPEC_NOTE_ID);
      logger.info("handleInitializeNotes: dispatching loadWorkspaceNotesSucceeded", {
        workspaceId,
        noteCount: notes.length,
        specFound: !!specNote,
        specContentLength: specNote?.content?.length ?? 0,
      });

      yield* put(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));

      // Auto-select spec if no selection
      const ws = yield* selectWorkspaceNotesState.effect(workspaceId);
      if (ws && !ws.selectedNoteId && getItem(ws.notes, SPEC_NOTE_ID as Note["id"])) {
        yield* put(selectNote(workspaceId, SPEC_NOTE_ID));
      }
    } else if (isOptimisticWorkspace) {
      // Create placeholder spec even on failure for optimistic workspaces
      const placeholderSpec = createPlaceholderSpec(workspaceId);
      yield* put(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: [placeholderSpec] }));
      yield* put(selectNote(workspaceId, SPEC_NOTE_ID));
    } else {
      yield* put(loadWorkspaceNotesFailed([workspaceId], result.error));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load notes";
    yield* put(loadWorkspaceNotesFailed([workspaceId], msg));
  }
}

function createPlaceholderSpec(workspaceId: string): Note {
  const now = new Date().toISOString();
  return {
    id: NoteId(SPEC_NOTE_ID),
    workspaceId: WorkspaceId(workspaceId),
    title: "Spec",
    content: "",
    contentType: ContentType.Markdown,
    tags: ["spec"],
    isPinned: true,
    isArchived: false,
    isDefault: true,
    visibility: NoteVisibility.Workspace,
    metadata: {
      author: { id: "system", name: "System", type: AuthorType.System },
      wordCount: 0,
      characterCount: 0,
    },
    references: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
    created_at: now,
    updated_at: now,
    is_pinned: true,
    is_archived: false,
  } as unknown as Note;
}

function normalizeIpcNotes(value: unknown, workspaceId: string): Note[] {
  return Array.isArray(value)
    ? value.filter((note): note is Note => isFullNote(note) && note.workspaceId === workspaceId)
    : [];
}

// ============================================================================
// Reload notes for a workspace
// ============================================================================
export function* handleReloadNotes(action: ReturnType<typeof reloadNotes>) {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;

  try {
    const result = yield* call(notesIpc<Note[]>, NOTES_CHANNELS.LIST, { workspaceId });

    if (result.ok) {
      const validNotes = normalizeIpcNotes(result.data, workspaceId);
      yield* put(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: validNotes }));

      // Preserve selection: if selected note no longer exists, clear selection
      const ws = yield* selectWorkspaceNotesState.effect(workspaceId);
      if (ws?.selectedNoteId && !getItem(ws.notes, ws.selectedNoteId as Note["id"])) {
        yield* put(selectNote(workspaceId, null));
      }
    }
  } catch (err) {
    logger.error("Failed to reload notes", err as Error);
  }
}

// ============================================================================
// Select note (with server fetch to refresh content)
// ============================================================================
export function* handleSelectNote(action: ReturnType<typeof selectNote>) {
  const [workspaceId, noteId] = action.payload;
  if (!workspaceId) return;

  // The reducer already updated selectedNoteId. Now, if selecting a note, fetch fresh content.
  if (!noteId) return;

  // Flush any pending saves for the previously selected note
  // Note: pending saves are now handled differently, see flushPendingSaves

  try {
    const result = yield* call(notesIpc<Note>, NOTES_CHANNELS.GET, { workspaceId, noteId });

    if (result.ok && isFullNote(result.data) && result.data.workspaceId === workspaceId) {
      yield* put(applyLocalNoteUpdate(workspaceId, noteId, result.data));
    }
  } catch (error) {
    logger.error("Error fetching note on select", error as Error);
  }
}

// ============================================================================
// Update note content (debounced save to server)
// ============================================================================
export function* handleUpdateNoteContent(action: ReturnType<typeof updateNoteContent>) {
  const [workspaceId, noteId, content, immediate] = action.payload;
  if (!workspaceId || !noteId || typeof content !== "string") return;

  // Mark as user typing
  yield* put(setIsUserTyping(workspaceId, true));
  yield* put(setLastUserInputTime(workspaceId, Date.now()));

  // Apply local update immediately for responsiveness
  yield* put(applyLocalNoteUpdate(workspaceId, noteId, { content }));

  // Track pending save
  const saveKey = `${workspaceId}:${noteId}`;
  pendingSaves.set(saveKey, { noteId, updates: { ...(pendingSaves.get(saveKey)?.updates || {}), content }, workspaceId });

  if (immediate) {
    yield* call(saveNoteToServer, workspaceId, noteId);
  }
  // Otherwise, the debounced watcher will pick it up
}

// ============================================================================
// Debounced save watcher — uses takeLatest to debounce
// ============================================================================
export function* debouncedSaveWatcher() {
  yield* takeLatest(updateNoteContent, function* (action) {
    const [workspaceId, noteId, , immediate] = action.payload;
    if (immediate) return; // Already saved immediately

    yield* delay(SAVE_DEBOUNCE_MS);

    // Clear typing flag
    yield* put(setIsUserTyping(workspaceId, false));

    // Save
    yield* call(saveNoteToServer, workspaceId, noteId);
  });
}

function* saveNoteToServer(workspaceId: string, noteId: string) {
  const saveKey = `${workspaceId}:${noteId}`;
  const pending = pendingSaves.get(saveKey);
  if (!pending) return;

  pendingSaves.delete(saveKey);

  const ws = yield* selectWorkspaceNotesState.effect(workspaceId);
  if (!ws) return;

  const currentNote = getItem(ws.notes, noteId as Note["id"]);
  if (!currentNote) return;

  // Validate workspace
  if (currentNote.workspaceId !== workspaceId) return;

  const completeUpdate = {
    id: NoteId(noteId),
    workspaceId: WorkspaceId(workspaceId),
    title: pending.updates.title ?? currentNote.title,
    content: pending.updates.content ?? currentNote.content,
    tags: pending.updates.tags ?? currentNote.tags,
    contentType: pending.updates.contentType ?? currentNote.contentType,
    isPinned: pending.updates.isPinned ?? currentNote.isPinned,
    isArchived: pending.updates.isArchived ?? currentNote.isArchived,
    visibility: pending.updates.visibility ?? currentNote.visibility,
    isUserAction: true,
  } satisfies UpdateNoteRequest;

  try {
    const result = yield* call(notesIpc<Note>, NOTES_CHANNELS.UPDATE, completeUpdate);

    if (result.ok && isFullNote(result.data) && result.data.workspaceId === workspaceId) {
      yield* put(applyLocalNoteUpdate(workspaceId, noteId, result.data));
      yield* put(markNoteRead(workspaceId, noteId));
    } else {
      // Reload on failure
      yield* call(handleReloadNotes, reloadNotes(workspaceId));
    }
  } catch (err) {
    logger.error("Error saving note", err as Error);
  }
}

// ============================================================================
// Update note title
// ============================================================================
export function* handleUpdateNoteTitle(action: ReturnType<typeof updateNoteTitle>) {
  const [workspaceId, noteId, title] = action.payload;
  if (!workspaceId || !noteId || typeof title !== "string") return;

  yield* put(applyLocalNoteUpdate(workspaceId, noteId, { title }));

  // Debounced save (reuse the pending saves mechanism)
  const saveKey = `${workspaceId}:${noteId}`;
  const existing = pendingSaves.get(saveKey);
  pendingSaves.set(saveKey, { noteId, updates: { ...(existing?.updates || {}), title }, workspaceId });

  yield* delay(SAVE_DEBOUNCE_MS);
  yield* call(saveNoteToServer, workspaceId, noteId);
}

// ============================================================================
// Create note
// ============================================================================
export function* handleCreateNote(action: ReturnType<typeof createNote>) {
  const [workspaceId, data] = action.payload;
  if (!workspaceId) return;

  // Flush pending saves before creating
  yield* call(handleFlushPendingSaves, flushPendingSaves(workspaceId));

  try {
    const cleanData: CreateNoteRequest = {
      title: typeof data.title === "string" && data.title ? data.title : "New Note",
      content: typeof data.content === "string" ? data.content : "",
      tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === "string") : [],
      contentType: data.contentType,
      visibility: data.visibility,
      parentId: data.parentId,
      workspaceId: WorkspaceId(workspaceId),
    };

    const result = yield* call(notesIpc<Note>, NOTES_CHANNELS.CREATE, cleanData);

    if (result.ok && isFullNote(result.data) && result.data.workspaceId === workspaceId) {
      yield* put(addOptimisticNote(workspaceId, result.data));
      yield* put(markNoteRead(workspaceId, result.data.id));
      yield* put(selectNote(workspaceId, result.data.id));
    }
  } catch (err) {
    logger.error("Error creating note", err as Error);
  }
}

// ============================================================================
// Delete note
// ============================================================================
export function* handleDeleteNote(action: ReturnType<typeof deleteNote>) {
  const [workspaceId, noteId] = action.payload;
  if (!workspaceId || !noteId) return;

  try {
    const result = yield* call(notesIpc<void>, NOTES_CHANNELS.DELETE, { id: noteId, workspaceId });

    if (result.ok) {
      yield* put(applyNoteDeleted(workspaceId, noteId));

      // Clear selection if deleted note was selected
      const ws = yield* selectWorkspaceNotesState.effect(workspaceId);
      if (ws?.selectedNoteId === noteId) {
        yield* put(selectNote(workspaceId, null));
      }
    }
  } catch (err) {
    logger.error("Error deleting note", err as Error);
  }
}

// ============================================================================
// Update note (metadata: pin, archive, etc.)
// ============================================================================
export function* handleUpdateNote(action: ReturnType<typeof updateNote>) {
  const [workspaceId, noteId, updates] = action.payload;
  if (!workspaceId || !noteId) return;
  const normalizedUpdates = normalizeNoteUpdatePatch(updates);
  if (Object.keys(normalizedUpdates).length === 0) return;

  try {
    const updateRequest = { id: NoteId(noteId), workspaceId: WorkspaceId(workspaceId), ...normalizedUpdates } as UpdateNoteRequest;
    const result = yield* call(notesIpc<Note>, NOTES_CHANNELS.UPDATE, updateRequest);

    if (result.ok && isFullNote(result.data) && result.data.workspaceId === workspaceId) {
      yield* put(applyLocalNoteUpdate(workspaceId, noteId, result.data));
    }
  } catch (err) {
    logger.error("Error updating note", err as Error);
  }
}

// ============================================================================
// Flush pending saves
// ============================================================================
export function* handleFlushPendingSaves(action: ReturnType<typeof flushPendingSaves>) {
  const [workspaceId] = action.payload;

  const keysToFlush = [...pendingSaves.entries()]
    .filter(([, v]) => v.workspaceId === workspaceId);

  for (const [, save] of keysToFlush) {
    yield* call(saveNoteToServer, save.workspaceId, save.noteId);
  }
}

// ============================================================================
// Handle external note update
// ============================================================================
export function* handleExternalNoteUpdateSaga(action: ReturnType<typeof handleExternalNoteUpdate>) {
  const [workspaceId, noteId, updates, origin] = action.payload;
  if (!workspaceId || !noteId) return;
  const normalizedUpdates = normalizeNoteUpdatePatch(updates);
  if (Object.keys(normalizedUpdates).length === 0) return;

  const ws = yield* selectWorkspaceNotesState.effect(workspaceId);
  if (!ws) return;

  const note = getItem(ws.notes, noteId as Note["id"]);
  if (!note) {
    yield* call(handleReloadNotes, reloadNotes(workspaceId));
    return;
  }

  if (note.workspaceId !== workspaceId) return;

  const normalizedOrigin = typeof origin === "string" ? origin : "external";
  const content = normalizedUpdates.content;

  // Safety: prevent untrusted source from populating empty spec
  if (
    noteId === "spec" &&
    note.content === "" &&
    content !== undefined &&
    content.trim() !== "" &&
    normalizedOrigin !== "file-system" &&
    normalizedOrigin !== "agent" &&
    normalizedOrigin !== "restore"
  ) {
    return;
  }

  // Safety: prevent clearing spec content from external sources
  if (noteId === "spec" && content !== undefined && !(normalizedUpdates as any).isUserAction) {
    if (content.trim().length === 0) return;
  }

  // Check if user is currently editing this note
  if (ws.selectedNoteId === noteId && ws.isUserTyping) {
    yield* delay(3000);
    const currentWs = yield* selectWorkspaceNotesState.effect(workspaceId);
    if (currentWs?.isUserTyping && currentWs?.selectedNoteId === noteId) {
      yield* delay(1000);
    }
  }

  // Apply the update
  yield* put(applyLocalNoteUpdate(workspaceId, noteId, normalizedUpdates));

  // Dispatch content update event for editor synchronization
  if (content !== undefined) {
    const source = normalizeNoteUpdateSource(normalizedOrigin);
    dispatchContentUpdateEvent(noteId, content, source, workspaceId);
  }
}

// Re-export for backward compatibility; the canonical definition lives in
// dispatch-content-update-event.ts so both this saga and workspace-notes-saga
// can share it without circular imports.
import { dispatchContentUpdateEvent } from "./dispatch-content-update-event";

// ============================================================================
// Restore note version
// ============================================================================
export function* handleRestoreNoteVersion(action: ReturnType<typeof restoreNoteVersion>) {
  const [workspaceId, noteId, versionId] = action.payload;
  if (!workspaceId || !noteId || !versionId) return;

  try {
    const result = yield* call(notesIpc<Note>, NOTES_CHANNELS.RESTORE_VERSION, { workspaceId, noteId, versionId });

    if (result.ok && isFullNote(result.data) && result.data.workspaceId === workspaceId) {
      yield* put(handleExternalNoteUpdate(workspaceId, noteId, result.data, "restore"));
    } else {
      logger.error("Failed to restore note version", { error: result.ok ? undefined : result.error, workspaceId, noteId, versionId });
    }
  } catch (err) {
    logger.error("Error restoring note version", err as Error);
  }
}

// ============================================================================
// Update task status
// ============================================================================
export function* handleUpdateTaskStatus(action: ReturnType<typeof updateTaskStatus>) {
  const [workspaceId, noteId, status] = action.payload;
  try {
    const result = yield* call(notesIpc<Note>, NOTES_CHANNELS.UPDATE_TASK_STATUS, { workspaceId, noteId, status });
    if (result.ok && isFullNote(result.data) && result.data.workspaceId === workspaceId) {
      yield* put(applyLocalNoteUpdate(workspaceId, noteId, result.data));
    } else {
      logger.error("Failed to update task status", { error: result.ok ? undefined : result.error, workspaceId, noteId });
    }
  } catch (err) {
    logger.error("Error updating task status", err as Error);
  }
}

// ============================================================================
// Cleanup workspace notes
// ============================================================================
export function* handleCleanupWorkspaceNotes(action: ReturnType<typeof cleanupWorkspaceNotes>) {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;

  yield* call(handleFlushPendingSaves, flushPendingSaves(workspaceId));

  for (const [key] of pendingSaves) {
    if (key.startsWith(`${workspaceId}:`)) {
      pendingSaves.delete(key);
    }
  }
}

// ============================================================================
// Fetch note version history
// ============================================================================
export function* handleFetchNoteVersions(action: ReturnType<typeof fetchNoteVersions>) {
  const [workspaceId, noteId] = action.payload;
  if (!workspaceId || !noteId) return;

  try {
    const result = yield* call(notesIpc<Note>, NOTES_CHANNELS.GET, { workspaceId, noteId });
    if (result.ok && result.data?.versions) {
      yield* put(applyNoteVersions(workspaceId, noteId, result.data.versions));
    } else {
      yield* put(applyNoteVersionsError(workspaceId, result.ok ? "No versions found" : (result.error || "Failed to load")));
    }
  } catch (err) {
    yield* put(applyNoteVersionsError(workspaceId, err instanceof Error ? err.message : "Unknown error"));
  }
}

// ============================================================================
// Assign agent to task
// ============================================================================
export function* handleAssignAgentToTask(action: ReturnType<typeof assignAgentToTask>) {
  const [workspaceId, noteId, agentId] = action.payload;
  try {
    const result = yield* call(notesIpc<Note>, NOTES_CHANNELS.ASSIGN_AGENT_TO_TASK, { workspaceId, noteId, agentId });
    if (result.ok) {
      yield* put(reloadNotes(workspaceId));
    } else {
      logger.error("Failed to assign agent to task", { error: result.error, workspaceId, noteId, agentId });
    }
  } catch (err) {
    logger.error("Error assigning agent to task", err as Error);
  }
}

// ============================================================================
// Fetch ready tasks
// ============================================================================
export function* handleFetchReadyTasks(action: ReturnType<typeof fetchReadyTasks>) {
  const [workspaceId] = action.payload;
  yield* delay(100);
  if (!workspaceId) return;

  try {
    const result = yield* call(notesIpc<{ flattened: Note[]; ready: Note[] }>, NOTES_CHANNELS.FIND_READY_TASKS, { workspaceId });
    if (result.ok) {
      yield* put(applyReadyTasks(workspaceId, normalizeIpcNotes(result.data?.ready, workspaceId)));
    } else {
      yield* put(applyReadyTasks(workspaceId, []));
    }
  } catch (err) {
    yield* put(applyReadyTasksError(workspaceId, err instanceof Error ? err.message : String(err)));
  }
}

// ============================================================================
// Root CRUD saga
// ============================================================================
export function* notesCrudSaga() {
  yield* fork(function* () { yield* takeEvery(initializeNotes, handleInitializeNotes); });
  yield* fork(function* () { yield* takeEvery(reloadNotes, handleReloadNotes); });
  yield* fork(function* () { yield* takeEvery(updateNoteContent, handleUpdateNoteContent); });
  yield* fork(debouncedSaveWatcher);
  yield* fork(function* () { yield* takeLatest(updateNoteTitle, handleUpdateNoteTitle); });
  yield* fork(function* () { yield* takeEvery(createNote, handleCreateNote); });
  yield* fork(function* () { yield* takeEvery(deleteNote, handleDeleteNote); });
  yield* fork(function* () { yield* takeEvery(updateNote, handleUpdateNote); });
  yield* fork(function* () { yield* takeEvery(flushPendingSaves, handleFlushPendingSaves); });
  yield* fork(function* () { yield* takeEvery(handleExternalNoteUpdate, handleExternalNoteUpdateSaga); });
  yield* fork(function* () { yield* takeEvery(cleanupWorkspaceNotes, handleCleanupWorkspaceNotes); });
  yield* fork(function* () { yield* takeEvery(updateTaskStatus, handleUpdateTaskStatus); });
  yield* fork(function* () { yield* takeEvery(assignAgentToTask, handleAssignAgentToTask); });
  yield* fork(function* () { yield* takeEvery(restoreNoteVersion, handleRestoreNoteVersion); });
  yield* fork(function* () { yield* takeLatest(fetchNoteVersions, handleFetchNoteVersions); });
  yield* fork(function* () { yield* takeLatest(fetchReadyTasks, handleFetchReadyTasks); });
}
