import type { Note, NoteVersion, TaskStatus } from "$shared/types";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import {
  addItem,
  createCollection,
  getItem,
  removeItem,
  updateItem,
  upsertItem,
} from "@augmentcode/themis/utils/collections/collection-utils";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type { WorkspaceNotesWorkspaceState, WorkspaceNotesState } from "./workspace-notes-types";
import { normalizeNoteUpdatePatch } from "./workspace-notes-normalization";

export type { WorkspaceNotesWorkspaceState, WorkspaceNotesState };

export type NoteEventType = 'note:created' | 'note:updated' | 'note:deleted';

export const emptyWorkspaceNotesState: WorkspaceNotesWorkspaceState = {
  notes: createCollection<Note, "id">("id"),
  loading: false,
  error: null,
  initialized: false,
  selectedNoteId: null,
  isUserTyping: false,
  lastUserInputTime: 0,
  editorHasFocus: false,
  newlyCreatedNoteId: null,
  notesVersion: 0,
  noteVersions: null,
  readyTasks: null,
};

export const initialState: WorkspaceNotesState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceNotesState);
export const loadWorkspaceNotesSucceeded = createAction<
  [workspaceIds: string[], notesByWorkspace: Record<string, Note[]>]
>("workspaceNotes/loadWorkspaceNotesSucceeded");
export const loadWorkspaceNotesFailed = createAction<[workspaceIds: string[], error: string]>(
  "workspaceNotes/loadWorkspaceNotesFailed"
);
export const applyTaskStatusChanged = createAction<
  [workspaceId: string, noteId: string, newStatus: TaskStatus]
>("workspaceNotes/applyTaskStatusChanged");
export const applyNoteCreated = createAction<[workspaceId: string, note: Note]>(
  "workspaceNotes/applyNoteCreated"
);
export const applyNoteDeleted = createAction<[workspaceId: string, noteId: string]>(
  "workspaceNotes/applyNoteDeleted"
);
export const applyNoteUpdated = createAction<[workspaceId: string, noteId: string, note: Note]>(
  "workspaceNotes/applyNoteUpdated"
);

// ---- New actions from notes.store.svelte.ts migration ----

/** Select a note in a workspace */
export const selectNote = createAction<[workspaceId: string, noteId: string | null]>(
  "workspaceNotes/selectNote"
);

/** Clear the newly created note ID (called after focusing) */
export const clearNewlyCreatedNoteId = createAction<[workspaceId: string]>(
  "workspaceNotes/clearNewlyCreatedNoteId"
);

/** Apply a local note content/title update (optimistic, user-driven) */
export const applyLocalNoteUpdate = createAction(
  "workspaceNotes/applyLocalNoteUpdate",
  (workspaceId: string, noteId: string, updates: Partial<Note>) => {
    const normalizedUpdates = normalizeNoteUpdatePatch(updates);
    return {
      workspaceId,
      noteId,
      updates: normalizedUpdates,
      timestamp: typeof normalizedUpdates.updatedAt === "string" ? normalizedUpdates.updatedAt : new Date().toISOString(),
    };
  },
);

/** Add an optimistic note (for immediate UI feedback before server confirms) */
export const addOptimisticNote = createAction<[workspaceId: string, note: Note]>(
  "workspaceNotes/addOptimisticNote"
);

/** Remove an optimistic note (on error/rollback) */
export const removeOptimisticNote = createAction<[workspaceId: string, noteId: string]>(
  "workspaceNotes/removeOptimisticNote"
);

/** Saga trigger: initialize notes for a workspace */
export const initializeNotes = createAction<[workspaceId: string, initialSelectedNoteId?: string | null]>(
  "workspaceNotes/initializeNotes"
);

/** Saga trigger: create a new note */
export const createNote = createAction<[workspaceId: string, data: Omit<import("$shared/types").CreateNoteRequest, "workspaceId">]>(
  "workspaceNotes/createNote"
);

/** Saga trigger: update note (metadata like pin, archive, etc.) */
export const updateNote = createAction<[workspaceId: string, noteId: string, updates: Omit<import("$shared/types").UpdateNoteRequest, "id">]>(
  "workspaceNotes/updateNote"
);

export const restoreNoteVersion = createAction<[workspaceId: string, noteId: string, versionId: string]>(
  "workspaceNotes/restoreNoteVersion"
);

/** Saga trigger: fetch note version history */
export const fetchNoteVersions = createAction<[workspaceId: string, noteId: string]>(
  "workspaceNotes/fetchNoteVersions"
);

/** Apply fetched note versions to state */
export const applyNoteVersions = createAction<[workspaceId: string, noteId: string, versions: NoteVersion[]]>(
  "workspaceNotes/applyNoteVersions"
);

/** Apply note versions fetch error to state */
export const applyNoteVersionsError = createAction<[workspaceId: string, error: string]>(
  "workspaceNotes/applyNoteVersionsError"
);

/** Saga trigger: fetch ready tasks for a workspace */
export const fetchReadyTasks = createAction<[workspaceId: string]>(
  "workspaceNotes/fetchReadyTasks"
);

/** Apply fetched ready tasks to state */
export const applyReadyTasks = createAction<[workspaceId: string, tasks: Note[]]>(
  "workspaceNotes/applyReadyTasks"
);

export const workspaceNotesReducer = createReducer<WorkspaceNotesState>(initialState);
workspaceNotesReducer.with(loadWorkspaceNotesSucceeded, (state, { payload: [workspaceIds, notesByWorkspace] }) => {
    return workspaceIds.reduce((nextState, workspaceId) => {
      const workspaceState = getWorkspaceState(nextState, workspaceId);
      return setWorkspaceState(nextState, workspaceId, {
        ...workspaceState,
        notes: createCollection<Note, "id">("id", notesByWorkspace[workspaceId] ?? []),
        loading: false,
        error: null,
        initialized: true,
        notesVersion: workspaceState.notesVersion + 1,
      });
    }, state);
  });
workspaceNotesReducer.with(loadWorkspaceNotesFailed, (state, { payload: [workspaceIds, error] }) => {
    return workspaceIds.reduce((nextState, workspaceId) => {
      const workspaceState = getWorkspaceState(nextState, workspaceId);
      return setWorkspaceState(nextState, workspaceId, {
        ...workspaceState,
        loading: false,
        error,
      });
    }, state);
  });
workspaceNotesReducer.with(applyTaskStatusChanged, (state, { payload: [workspaceId, noteId, newStatus] }) => {
    const workspaceState = state.byWorkspaceId[workspaceId];
    if (!workspaceState?.initialized) return state;

    const normalizedNoteId = noteId as Note["id"];
    const note = getItem(workspaceState.notes, normalizedNoteId);
    if (!note?.metadata?.task) return state;

    return setWorkspaceState(state, workspaceId, {
      ...workspaceState,
      notes: updateItem(workspaceState.notes, {
        id: note.id,
        metadata: {
          ...note.metadata,
          task: {
            ...note.metadata.task,
            status: newStatus,
          },
        },
      }),
      notesVersion: workspaceState.notesVersion + 1,
    });
  });
workspaceNotesReducer.with(applyNoteCreated, (state, { payload: [workspaceId, note] }) => {
    const workspaceState = state.byWorkspaceId[workspaceId];
    if (!workspaceState?.initialized) return state;

    return setWorkspaceState(state, workspaceId, {
      ...workspaceState,
      notes: addItem(workspaceState.notes, note),
      notesVersion: workspaceState.notesVersion + 1,
    });
  });
workspaceNotesReducer.with(applyNoteDeleted, (state, { payload: [workspaceId, noteId] }) => {
    const workspaceState = state.byWorkspaceId[workspaceId];
    if (!workspaceState?.initialized) return state;

    const notes = removeItem(workspaceState.notes, noteId as Note["id"]);
    if (notes === workspaceState.notes) return state;

    return setWorkspaceState(state, workspaceId, {
      ...workspaceState,
      notes,
      notesVersion: workspaceState.notesVersion + 1,
    });
  });
workspaceNotesReducer.with(applyNoteUpdated, (state, { payload: [workspaceId, noteId, note] }) => {
    if (note.workspaceId !== workspaceId) return state;

    const workspaceState = getWorkspaceState(state, workspaceId);
    const existingNote = getItem(workspaceState.notes, noteId as Note["id"]);

    // Rev gate (monorepo#533): a refetch triggered by an older `note:updated`
    // event can land after a newer state was already applied (or after
    // `advanceNoteRev` recorded a daemon ack). A strictly-lower rev is
    // definitively stale — dropping it prevents reverting newer content.
    if (
      existingNote?.rev !== undefined &&
      note.rev !== undefined &&
      note.rev < existingNote.rev
    ) {
      return state;
    }

    return setWorkspaceState(state, workspaceId, {
      ...workspaceState,
      notes: upsertItem(workspaceState.notes, {
        ...note,
        id: existingNote?.id ?? (noteId as Note["id"]),
      }),
      notesVersion: workspaceState.notesVersion + 1,
    });
  });
  // ---- New reducers from notes.store.svelte.ts migration ----
workspaceNotesReducer.with(selectNote, (state, { payload: [workspaceId, noteId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    if (ws.selectedNoteId === noteId) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      selectedNoteId: noteId,
      isUserTyping: false,
      editorHasFocus: false,
    });
  });
workspaceNotesReducer.with(clearNewlyCreatedNoteId, (state, { payload: [workspaceId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    if (ws.newlyCreatedNoteId === null) return state;
    return setWorkspaceState(state, workspaceId, { ...ws, newlyCreatedNoteId: null });
  });
workspaceNotesReducer.with(applyLocalNoteUpdate, (state, { payload }) => {
    const { workspaceId, noteId, updates, timestamp } = payload;
    const ws = getWorkspaceState(state, workspaceId);
    const existing = getItem(ws.notes, noteId as Note["id"]);
    if (!existing) return state;
    const updatedNote = { ...existing, ...updates, updatedAt: timestamp };
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      notes: updateItem(ws.notes, updatedNote),
      notesVersion: ws.notesVersion + 1,
    });
  });
workspaceNotesReducer.with(addOptimisticNote, (state, { payload: [workspaceId, note] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      notes: upsertItem(ws.notes, note),
      newlyCreatedNoteId: note.id,
      notesVersion: ws.notesVersion + 1,
    });
  });
workspaceNotesReducer.with(removeOptimisticNote, (state, { payload: [workspaceId, noteId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    const notes = removeItem(ws.notes, noteId as Note["id"]);
    if (notes === ws.notes) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      notes,
      newlyCreatedNoteId: ws.newlyCreatedNoteId === noteId ? null : ws.newlyCreatedNoteId,
      notesVersion: ws.notesVersion + 1,
    });
  });
workspaceNotesReducer.with(fetchNoteVersions, (state, { payload: [workspaceId, noteId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      noteVersions: {
        versions: ws.noteVersions?.noteId === noteId ? ws.noteVersions.versions : [],
        loading: true,
        error: null,
        noteId,
      },
    });
  });
workspaceNotesReducer.with(applyNoteVersions, (state, { payload: [workspaceId, noteId, versions] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      noteVersions: {
        versions,
        loading: false,
        error: null,
        noteId,
      },
    });
  });
workspaceNotesReducer.with(applyNoteVersionsError, (state, { payload: [workspaceId, error] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      noteVersions: {
        versions: ws.noteVersions?.versions ?? [],
        loading: false,
        error,
        noteId: ws.noteVersions?.noteId ?? null,
      },
    });
  });
workspaceNotesReducer.with(fetchReadyTasks, (state, { payload: [workspaceId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    if (ws.readyTasks?.loading) return state; // Already loading, no change
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      readyTasks: {
        tasks: ws.readyTasks?.tasks ?? [],
        loading: true,
        error: null,
        searched: ws.readyTasks?.searched ?? false,
      },
    });
  });
workspaceNotesReducer.with(applyReadyTasks, (state, { payload: [workspaceId, tasks] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      readyTasks: {
        tasks,
        loading: false,
        error: null,
        searched: true,
      },
    });
  });
workspaceNotesReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));