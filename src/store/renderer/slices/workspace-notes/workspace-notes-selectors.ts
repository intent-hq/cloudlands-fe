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
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import { emptyWorkspaceNotesState } from "./workspace-notes-slice";
import type { NoteVersionsState, WorkspaceNotesWorkspaceState } from "./workspace-notes-types";

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

export const selectSelectedNoteId = store.createSelector(
  (state, workspaceId: string): string | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.selectedNoteId ?? null,
);

export const selectNewlyCreatedNoteId = store.createSelector(
  (state, workspaceId: string): string | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.newlyCreatedNoteId ?? null,
);

export const selectNotesVersion = store.createSelector(
  (state, workspaceId: string): number =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.notesVersion ?? 0,
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

export const selectAllNotes = store.createSelector(
  (state, workspaceId?: string): Note[] => {
    if (!workspaceId) return [];
    const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
    if (!ws) return [];
    return getItems(ws.notes);
  },
);

export const selectNoteVersions = store.createSelector(
  (state, workspaceId: string): NoteVersionsState | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.noteVersions ?? null,
);
