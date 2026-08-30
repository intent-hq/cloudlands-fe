/**
 * Workspace Transfer Slice
 *
 * State + actions for the Transfer/Download wizard. Step 1 picks a
 * destination (a remote connection, or "download to file"); step 2 shows the
 * read-only `workspace.transfer.plan` result for confirmation; step 3 runs
 * the main-process relay and renders its `transfer:progress` counters; step 4
 * shows the result with the archive-source checkbox + finalize.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { TransferFailurePhase } from '$shared/types/workspace-transfer';
import type {
  TransferDestination,
  TransferPlan,
  TransferProgress,
  WorkspaceTransferState,
} from './workspace-transfer-types';

export const initialState: WorkspaceTransferState = {
  open: false,
  workspaceId: null,
  workspaceTitle: '',
  step: 'destination',
  destination: null,
  planStatus: 'idle',
  plan: null,
  planError: null,
  runStatus: 'idle',
  progress: null,
  runError: null,
  failurePhase: null,
  restartAgents: false,
  downloadFilePath: null,
  interruptedAgents: [],
  archiveSource: true,
  finalizeStatus: 'idle',
  finalizeError: null,
};

/** Open the wizard for a workspace (from the card context menu). */
export const openTransferModal = createAction<
  [payload: { workspaceId: string; workspaceTitle: string }]
>('workspaceTransfer/openModal');

/** Close the wizard and reset all wizard state. */
export const closeTransferModal = createAction('workspaceTransfer/closeModal');

/** Step 1: the user picked a destination (does not advance the step). */
export const selectTransferDestination = createAction<[destination: TransferDestination]>(
  'workspaceTransfer/selectDestination',
);

/**
 * Advance to the confirm step. The saga fetches `workspace.transfer.plan`
 * for the pending workspace; the reducer moves to step 2 in `loading`.
 */
export const transferPlanRequested = createAction('workspaceTransfer/planRequested');

/** Saga: plan fetch succeeded. */
export const transferPlanLoaded = createAction<[plan: TransferPlan]>(
  'workspaceTransfer/planLoaded',
);

/** Saga: plan fetch failed. */
export const transferPlanFailed = createAction<[error: string]>('workspaceTransfer/planFailed');

/** Back from confirm to the destination step (keeps the picked destination). */
export const transferWizardBack = createAction('workspaceTransfer/wizardBack');

/**
 * Start the transfer (confirm step's primary button). The saga invokes the
 * main-process relay; the reducer advances to step 3 in `running`. Also
 * dispatched from the failed result screen to retry.
 */
export const transferStartRequested = createAction('workspaceTransfer/startRequested');

/** Saga: a `transfer:progress` counter frame arrived from main. */
export const transferProgressReceived = createAction<[progress: TransferProgress]>(
  'workspaceTransfer/progressReceived',
);

/** Saga: the relay settled successfully (server relay or download). */
export const transferRunSucceeded = createAction<
  [payload: { interruptedAgents: string[]; downloadFilePath: string | null }]
>('workspaceTransfer/runSucceeded');

/** Saga: the relay failed; the result screen shows the reason, impact, and retry. */
export const transferRunFailed = createAction<
  [payload: { error: string; failurePhase: TransferFailurePhase | null }]
>('workspaceTransfer/runFailed');

/** Saga: the user dismissed the save dialog — return to the confirm step. */
export const transferRunCancelled = createAction('workspaceTransfer/runCancelled');

/** Step 3 toggle: restart in-flight (interrupted) agents on the target. */
export const setTransferRestartAgents = createAction<[value: boolean]>(
  'workspaceTransfer/setRestartAgents',
);

/** Step 4 checkbox: archive the source workspace on finalize. */
export const setTransferArchiveSource = createAction<[value: boolean]>(
  'workspaceTransfer/setArchiveSource',
);

/**
 * Step 4 primary button: settle the source via `workspace.export.finalize`
 * (archive + final status message) and optionally resume agents on the
 * target. The saga closes the modal (and optionally opens the target
 * backend's window) after.
 */
export const transferFinalizeRequested = createAction<[payload: { openTarget: boolean }]>(
  'workspaceTransfer/finalizeRequested',
);

/** Saga: finalize succeeded (the saga closes the modal itself). */
export const transferFinalizeSucceeded = createAction('workspaceTransfer/finalizeSucceeded');

/** Saga: finalize failed; the result screen shows the reason. */
export const transferFinalizeFailed = createAction<[error: string]>(
  'workspaceTransfer/finalizeFailed',
);

export const workspaceTransferReducer = createReducer<WorkspaceTransferState>(initialState);
workspaceTransferReducer.with(
  openTransferModal,
  (state, { payload: [{ workspaceId, workspaceTitle }] }) => ({
    ...initialState,
    open: true,
    workspaceId,
    workspaceTitle,
  }),
);
workspaceTransferReducer.with(closeTransferModal, () => initialState);
workspaceTransferReducer.with(selectTransferDestination, (state, { payload: [destination] }) => ({
  ...state,
  destination,
}));
workspaceTransferReducer.with(transferPlanRequested, (state) => {
  if (!state.open || !state.destination) return state;
  return { ...state, step: 'confirm', planStatus: 'loading', plan: null, planError: null };
});
workspaceTransferReducer.with(transferPlanLoaded, (state, { payload: [plan] }) => {
  if (!state.open || state.step !== 'confirm') return state;
  return { ...state, planStatus: 'loaded', plan, planError: null };
});
workspaceTransferReducer.with(transferPlanFailed, (state, { payload: [error] }) => {
  if (!state.open || state.step !== 'confirm') return state;
  return { ...state, planStatus: 'error', plan: null, planError: error };
});
workspaceTransferReducer.with(transferWizardBack, (state) => ({
  ...state,
  step: 'destination',
  planStatus: 'idle',
  plan: null,
  planError: null,
}));
workspaceTransferReducer.with(transferStartRequested, (state) => {
  // Valid from the confirm step (start) and from a failed run (retry).
  if (!state.open || !state.destination) return state;
  if (state.step !== 'confirm' && !(state.step === 'result' && state.runStatus === 'failed')) {
    return state;
  }
  return {
    ...state,
    step: 'transferring',
    runStatus: 'running',
    progress: null,
    runError: null,
    failurePhase: null,
    downloadFilePath: null,
    interruptedAgents: [],
    finalizeStatus: 'idle',
    finalizeError: null,
  };
});
workspaceTransferReducer.with(transferProgressReceived, (state, { payload: [progress] }) => {
  if (!state.open || state.step !== 'transferring' || state.runStatus !== 'running') return state;
  return { ...state, progress };
});
workspaceTransferReducer.with(
  transferRunSucceeded,
  (state, { payload: [{ interruptedAgents, downloadFilePath }] }) => {
    if (!state.open || state.step !== 'transferring') return state;
    return {
      ...state,
      step: 'result',
      runStatus: 'succeeded',
      interruptedAgents,
      downloadFilePath,
    };
  },
);
workspaceTransferReducer.with(
  transferRunFailed,
  (state, { payload: [{ error, failurePhase }] }) => {
    if (!state.open || state.step !== 'transferring') return state;
    return { ...state, step: 'result', runStatus: 'failed', runError: error, failurePhase };
  },
);
workspaceTransferReducer.with(transferRunCancelled, (state) => {
  if (!state.open || state.step !== 'transferring') return state;
  return { ...state, step: 'confirm', runStatus: 'idle', progress: null, runError: null };
});
workspaceTransferReducer.with(setTransferRestartAgents, (state, { payload: [value] }) => ({
  ...state,
  restartAgents: value,
}));
workspaceTransferReducer.with(setTransferArchiveSource, (state, { payload: [value] }) => ({
  ...state,
  archiveSource: value,
}));
workspaceTransferReducer.with(transferFinalizeRequested, (state) => {
  if (!state.open || state.step !== 'result' || state.runStatus !== 'succeeded') return state;
  return { ...state, finalizeStatus: 'running', finalizeError: null };
});
workspaceTransferReducer.with(transferFinalizeSucceeded, (state) => ({
  ...state,
  finalizeStatus: 'done',
  finalizeError: null,
}));
workspaceTransferReducer.with(transferFinalizeFailed, (state, { payload: [error] }) => {
  if (!state.open || state.step !== 'result') return state;
  return { ...state, finalizeStatus: 'error', finalizeError: error };
});
