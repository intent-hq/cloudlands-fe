/**
 * Release Notes — Actions & Reducer
 *
 * Manages state for fetching and displaying release notes after an app update.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { ReleaseNotes, ReleaseNotesState } from './release-notes-types';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Trigger initialization: subscribe to the main-process "show" push */
export const initializeReleaseNotes = createAction('releaseNotes/initialize');

/** Mark as initialized */
export const setInitialized = createAction('releaseNotes/setInitialized');

/** Close the release notes modal */
export const closeReleaseNotesModal = createAction('releaseNotes/closeModal');

/** Manually show release notes: opens the modal and fetches on demand */
export const showReleaseNotes = createAction('releaseNotes/showReleaseNotes');

/** Set release notes data and show modal (used after an on-demand fetch) */
export const showReleaseNotesSuccess = createAction<[notes: ReleaseNotes]>(
  'releaseNotes/showReleaseNotesSuccess',
);

/** On-demand fetch produced no notes — the modal renders its fallback */
export const showReleaseNotesUnavailable = createAction('releaseNotes/showReleaseNotesUnavailable');

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

export const releaseNotesReducer = createReducer<ReleaseNotesState>(initialState);
releaseNotesReducer.with(setInitialized, (state) => ({
  ...state,
  initialized: true,
}));
releaseNotesReducer.with(closeReleaseNotesModal, (state) => ({
  ...state,
  showModal: false,
}));
releaseNotesReducer.with(showReleaseNotes, (state) => ({
  ...state,
  releaseNotes: null,
  showModal: true,
  loading: true,
  error: null,
}));
releaseNotesReducer.with(showReleaseNotesSuccess, (state, { payload: [notes] }) => ({
  ...state,
  releaseNotes: notes,
  showModal: true,
  loading: false,
  error: null,
}));
releaseNotesReducer.with(showReleaseNotesUnavailable, (state) => ({
  ...state,
  releaseNotes: null,
  showModal: true,
  loading: false,
}));
