/**
 * Workspace Import Slice
 *
 * State + actions for the "Import Workspace from File…" wizard. The File
 * menu opens the wizard and immediately kicks off the main-process import
 * (file dialog → manifest read → sha256 → chunked upload → commit); the
 * wizard renders `transfer:import-progress` counters, then a success screen
 * (workspace title, open affordance, interrupted agents) or a failure screen
 * (daemon error verbatim + retry against the same file).
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { ImportProgress, WorkspaceImportState } from './workspace-import-types';

export const initialState: WorkspaceImportState = {
  open: false,
  step: 'importing',
  runStatus: 'idle',
  progress: null,
  runError: null,
  workspaceId: null,
  workspaceTitle: '',
  interruptedAgents: [],
};

/**
 * Kick off an import run (File menu, or the failure screen's Retry). The
 * saga invokes the main-process relay; the reducer opens the wizard in
 * `running`. `reuseLastFile` skips the dialog and re-runs the picked file.
 */
export const importStartRequested = createAction<[payload: { reuseLastFile: boolean }]>(
  'workspaceImport/startRequested',
);

/** Close the wizard and reset all wizard state. */
export const closeImportModal = createAction('workspaceImport/closeModal');

/** Saga: a `transfer:import-progress` counter frame arrived from main. */
export const importProgressReceived = createAction<[progress: ImportProgress]>(
  'workspaceImport/progressReceived',
);

/** Saga: the import committed successfully. */
export const importRunSucceeded = createAction<
  [payload: { workspaceId: string | null; workspaceTitle: string; interruptedAgents: string[] }]
>('workspaceImport/runSucceeded');

/** Saga: the import failed; the result screen shows the reason + retry. */
export const importRunFailed = createAction<[error: string]>('workspaceImport/runFailed');

/** Saga: the user dismissed the open dialog (or cancelled) — close silently. */
export const importRunCancelled = createAction('workspaceImport/runCancelled');

/** Success screen: open the imported workspace (the saga navigates + closes). */
export const importOpenWorkspaceRequested = createAction('workspaceImport/openWorkspaceRequested');

export const workspaceImportReducer = createReducer<WorkspaceImportState>(initialState);
workspaceImportReducer.with(importStartRequested, (state) => {
  // Valid from closed (menu) and from a failed run (retry).
  if (state.open && !(state.step === 'result' && state.runStatus === 'failed')) return state;
  return { ...initialState, open: true, step: 'importing', runStatus: 'running' };
});
workspaceImportReducer.with(closeImportModal, () => initialState);
workspaceImportReducer.with(importProgressReceived, (state, { payload: [progress] }) => {
  if (!state.open || state.step !== 'importing' || state.runStatus !== 'running') return state;
  return { ...state, progress };
});
workspaceImportReducer.with(
  importRunSucceeded,
  (state, { payload: [{ workspaceId, workspaceTitle, interruptedAgents }] }) => {
    if (!state.open || state.step !== 'importing') return state;
    return {
      ...state,
      step: 'result',
      runStatus: 'succeeded',
      workspaceId,
      workspaceTitle,
      interruptedAgents,
    };
  },
);
workspaceImportReducer.with(importRunFailed, (state, { payload: [error] }) => {
  if (!state.open || state.step !== 'importing') return state;
  return { ...state, step: 'result', runStatus: 'failed', runError: error };
});
workspaceImportReducer.with(importRunCancelled, (state) => {
  if (!state.open || state.step !== 'importing') return state;
  return initialState;
});
