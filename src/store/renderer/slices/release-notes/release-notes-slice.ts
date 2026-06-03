/**
 * Release Notes — Actions & Reducer
 *
 * Manages state for fetching and displaying release notes after an app update.
 */

import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";
import type { ReleaseNotes, ReleaseNotesState } from "./release-notes-types";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Trigger initialization: check version change and fetch release notes */
export const initializeReleaseNotes = createAction<[currentVersion: string, channel: string]>(
  "releaseNotes/initialize",
);

/** Set the fetched release notes and show the modal */
export const setReleaseNotes = createAction<[notes: ReleaseNotes]>(
  "releaseNotes/setReleaseNotes",
);

/** Set loading state */
export const setLoading = createAction<[loading: boolean]>("releaseNotes/setLoading");

/** Set error state */
export const setError = createAction<[error: string | null]>("releaseNotes/setError");

/** Mark as initialized */
export const setInitialized = createAction("releaseNotes/setInitialized");

/** Close the release notes modal */
export const closeReleaseNotesModal = createAction("releaseNotes/closeModal");

/** Manually show release notes */
export const showReleaseNotes = createAction<[channel: string]>(
  "releaseNotes/showReleaseNotes",
);

/** Set release notes data and show modal (used by saga after fetch) */
export const showReleaseNotesSuccess = createAction<[notes: ReleaseNotes]>(
  "releaseNotes/showReleaseNotesSuccess",
);

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------

export const initialState: ReleaseNotesState = {
  releaseNotes: null,
  showModal: false,
  loading: false,
  error: null,
  initialized: false,
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const releaseNotesReducer = createReducer<ReleaseNotesState>(initialState)
  .with(setReleaseNotes, (state, { payload: [notes] }) => ({
    ...state,
    releaseNotes: notes,
    showModal: true,
  }))
  .with(setLoading, (state, { payload: [loading] }) => ({
    ...state,
    loading,
  }))
  .with(setError, (state, { payload: [error] }) => ({
    ...state,
    error,
  }))
  .with(setInitialized, (state) => ({
    ...state,
    initialized: true,
  }))
  .with(closeReleaseNotesModal, (state) => ({
    ...state,
    showModal: false,
  }))
  .with(showReleaseNotesSuccess, (state, { payload: [notes] }) => ({
    ...state,
    releaseNotes: notes,
    showModal: true,
    loading: false,
    error: null,
  }));

