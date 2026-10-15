/**
 * Workspace Notes Selectors
 *
 * Selectors for note state accessed by workspace ID.
 */

import { store } from '../../store';
import * as projections from './workspace-notes-projections';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { emptyWorkspaceNotesState } from './workspace-notes-slice';
import type { NoteVersionsState } from './workspace-notes-types';

// ============================================================================
// Per-workspace base selector
// ============================================================================

export const selectWorkspaceNotesState = store.createSelector(projections.getWorkspaceNotesState);

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
    state.workspaceNotes.byWorkspaceId[workspaceId]?.pendingContentByNoteId[noteId] === true,
);

export const selectNoteContentView = store.createSelector(projections.getNoteContentView);

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

export const selectNoteById = store.createSelector(projections.getNoteById);

export const selectSpec = store.createSelector(projections.getSpec);

export const selectAllNotes = store.createSelector(projections.getAllNotes);

export const selectNoteVersions = store.createSelector(
  (state, workspaceId: string): NoteVersionsState | null =>
    state.workspaceNotes.byWorkspaceId[workspaceId]?.noteVersions ?? null,
);
