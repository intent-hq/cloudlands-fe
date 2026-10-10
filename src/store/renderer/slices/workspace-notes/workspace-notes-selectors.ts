/**
 * Workspace Notes Selectors
 *
 * Selectors for note state accessed by workspace ID.
 */

import { store } from '../../store';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import type { Note } from '$shared/types';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { emptyWorkspaceNotesState } from './workspace-notes-slice';
import type { NoteVersionsState, WorkspaceNotesWorkspaceState } from './workspace-notes-types';

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

export const selectSelectedNoteId = store.createSelector(
  (state, workspaceId: string): string | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.selectedNoteId ?? null,
);

export const selectNewlyCreatedNoteId = store.createSelector(
  (state, workspaceId: string): string | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.newlyCreatedNoteId ?? null,
);

export const selectHasPendingNoteContent = store.createSelector(
  (state, workspaceId: string, noteId: string): boolean =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.pendingContentByNoteId[noteId] === true ||
    !!state.workspaceNotes.retainedDrafts?.[JSON.stringify([workspaceId, noteId])],
);

export const selectNoteContentView = store.createSelector(
  (state, workspaceId: string, consumerId: string) =>
    getItem(
      state.workspaceNotes.byWorkspaceId[workspaceId]?.contentViews ??
        emptyWorkspaceNotesState.contentViews,
      consumerId,
    ),
);

export const selectNoteWorkspaceRoot = store.createSelector(
  (state, workspaceId: string, consumerId: string) =>
    getItem(
      state.workspaceNotes.byWorkspaceId[workspaceId]?.workspaceRoots ??
        emptyWorkspaceNotesState.workspaceRoots,
      consumerId,
    ),
);

export const selectNotePresenceView = store.createSelector(
  (state, workspaceId: string, consumerId: string) => {
    const view = getItem(
      state.workspaceNotes.byWorkspaceId[workspaceId]?.presenceViews ??
        emptyWorkspaceNotesState.presenceViews,
      consumerId,
    );
    return view ? { ...view, viewers: getItems(view.viewers) } : undefined;
  },
);

export const selectNoteAttributionView = store.createSelector(
  (state, workspaceId: string, consumerId: string) =>
    getItem(
      state.workspaceNotes.byWorkspaceId[workspaceId]?.attributionViews ??
        emptyWorkspaceNotesState.attributionViews,
      consumerId,
    ),
);

// ============================================================================
// Note item selectors
// ============================================================================

export const selectNoteById = store.createSelector(
  (
    state,
    workspaceId: string | null | undefined,
    noteId: string | null | undefined,
  ): Note | undefined => {
    if (!workspaceId || !noteId) return undefined;
    const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
    if (!ws) return undefined;
    return getItem(ws.notes, noteId as Note['id']);
  },
);

export const selectSpec = store.createSelector((state, workspaceId: string): Note | undefined => {
  const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
  if (!ws) return undefined;
  return getItem(ws.notes, SPEC_NOTE_ID as Note['id']);
});

export const selectAllNotes = store.createSelector((state, workspaceId?: string | null): Note[] => {
  if (!workspaceId) return [];
  const ws = state.workspaceNotes.byWorkspaceId[workspaceId];
  if (!ws) return [];
  return getItems(ws.notes);
});

export const selectNoteVersions = store.createSelector(
  (state, workspaceId: string): NoteVersionsState | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.noteVersions ?? null,
);

export const selectSpecTaskLinks = store.createSelector(
  (state, workspaceId: string): string[] | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.specTaskLinks ?? null,
);

export const selectRetainedNoteDraft = store.createSelector(
  (state, workspaceId: string, noteId: string) =>
    state.workspaceNotes.retainedDrafts?.[JSON.stringify([workspaceId, noteId])],
);

export const selectNoteDeleteView = store.createSelector(
  (state, workspaceId: string, noteId: string) =>
    state.workspaceNotes.deleteOperations?.[
      JSON.stringify([state.daemonHealth?.connectionGeneration ?? 0, workspaceId, noteId])
    ],
);
