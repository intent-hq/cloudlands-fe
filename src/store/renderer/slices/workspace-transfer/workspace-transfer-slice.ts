/**
 * Workspace Transfer Slice
 *
 * State + actions for the Transfer/Download wizard (steps 1–2). Step 1 picks
 * a destination (a remote connection, or "download to file"); step 2 shows
 * the read-only `workspace.transfer.plan` result for confirmation. The
 * transfer itself is NOT started from this slice yet (later surface).
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  TransferDestination,
  TransferPlan,
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

export const workspaceTransferReducer = createReducer<WorkspaceTransferState>(initialState);
workspaceTransferReducer.with(openTransferModal, (state, { payload: [{ workspaceId, workspaceTitle }] }) => ({
  ...initialState,
  open: true,
  workspaceId,
  workspaceTitle,
}));
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
