/**
 * Workspace Notes Selectors
 *
 * Selectors for note state accessed by workspace ID.
 */

import { store } from "../../store";
import { SPEC_NOTE_ID } from "$shared/constants/notes";
import type { Note } from "$shared/types";
import {
  getItem,
  getItems,
} from "ag-redux-toolkit/utils/collections/collection-utils";
import { emptyWorkspaceNotesState } from "./workspace-notes-slice";
import type { NoteVersionsState, ReadyTasksState, WorkspaceNotesWorkspaceState } from "./workspace-notes-types";

// ============================================================================
// Per-workspace base selector
// ============================================================================

export const selectWorkspaceNotesState = store.createSelector(
  (state, workspaceId: string): WorkspaceNotesWorkspaceState =>
    state.workspaceNotes.byWorkspaceId[workspaceId] ?? emptyWorkspaceNotesState,
);

// ============================================================================
// Scalar selectors
// ============================================================================

export const selectNotesLoading = store.createSelector(
  (state, workspaceId: string): boolean =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.loading ?? false,
);

export const selectNotesError = store.createSelector(
  (state, workspaceId: string): string | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.error ?? null,
);

export const selectNotesInitialized = store.createSelector(
  (state, workspaceId: string): boolean =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.initialized ?? false,
);

export const selectSelectedNoteId = store.createSelector(
  (state, workspaceId: string): string | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.selectedNoteId ?? null,
);

export const selectIsUserTyping = store.createSelector(
  (state, workspaceId: string): boolean =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.isUserTyping ?? false,
);

export const selectEditorHasFocus = store.createSelector(
  (state, workspaceId: string): boolean =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.editorHasFocus ?? false,
);

export const selectNewlyCreatedNoteId = store.createSelector(
  (state, workspaceId: string): string | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.newlyCreatedNoteId ?? null,
);

export const selectNotesVersion = store.createSelector(
  (state, workspaceId: string): number =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.notesVersion ?? 0,
);

export const selectLastUserInputTime = store.createSelector(
  (state, workspaceId: string): number =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.lastUserInputTime ?? 0,
);

// ============================================================================
// Note item selectors
// ============================================================================

export const selectNoteById = store.createSelector(
  (state, workspaceId: string | null | undefined, noteId: string | null | undefined): Note | undefined => {
    if (!workspaceId || !noteId) return undefined;
    const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
    if (!ws) return undefined;
    return getItem(ws.notes, noteId as Note["id"]);
  },
);

export const selectSpec = store.createSelector(
  (state, workspaceId: string): Note | undefined => {
    const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
    if (!ws) return undefined;
    return getItem(ws.notes, SPEC_NOTE_ID as Note["id"]);
  },
);

export const selectSelectedNote = store.createSelector(
  (state, workspaceId: string): Note | null => {
    const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
    if (!ws?.selectedNoteId) return null;
    return getItem(ws.notes, ws.selectedNoteId as Note["id"]) ?? null;
  },
);

export const selectAllNotes = store.createSelector(
  (state, workspaceId?: string): Note[] => {
    if (!workspaceId) return [];
    const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
    if (!ws) return [];
    return getItems(ws.notes);
  },
);

/** All notes sorted by updatedAt desc */
export const selectSortedNotes = store.createSelector(
  (state, workspaceId: string): Note[] => {
    const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
    if (!ws) return [];
    return getItems(ws.notes).sort(
      (a, b) => (b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0),
    );
  },
);

/** Notes that are not archived */
export const selectActiveNotes = store.createSelector(
  (state, workspaceId: string): Note[] => {
    const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
    if (!ws) return [];
    return getItems(ws.notes).filter((note) => !note.isArchived);
  },
);

/** Notes that are archived */
export const selectArchivedNotes = store.createSelector(
  (state, workspaceId: string): Note[] => {
    const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
    if (!ws) return [];
    return getItems(ws.notes).filter((note) => note.isArchived);
  },
);

/** Notes that are pinned */
export const selectPinnedNotes = store.createSelector(
  (state, workspaceId: string): Note[] => {
    const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
    if (!ws) return [];
    return getItems(ws.notes).filter((note) => note.isPinned);
  },
);

export const selectNotesCount = store.createSelector(
  (state, workspaceId: string): number => {
    const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
    if (!ws) return 0;
    return ws.notes.ids.length;
  },
);


export const selectNoteVersions = store.createSelector(
  (state, workspaceId: string): NoteVersionsState | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.noteVersions ?? null,
);


export const selectReadyTasks = store.createSelector(
  (state, workspaceId: string): ReadyTasksState | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.readyTasks ?? null,
);
