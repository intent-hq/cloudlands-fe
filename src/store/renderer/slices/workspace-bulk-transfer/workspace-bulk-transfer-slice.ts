import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItems,
  updateItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type { TransferProgress } from '../workspace-transfer/workspace-transfer-types';
import type { BulkTransferItem, WorkspaceBulkTransferState } from './workspace-bulk-transfer-types';

const initialState: WorkspaceBulkTransferState = {
  open: false,
  step: 'setup',
  items: createCollection<BulkTransferItem, 'workspaceId'>('workspaceId'),
  connectionId: null,
  restartAgents: false,
  archiveSource: true,
  currentId: null,
  progress: null,
  cancelling: false,
};

/** Open the bulk dialog for a Home multi-selection; the saga loads size estimates. */
export const openBulkTransferModal = createAction<
  [payload: { workspaces: { workspaceId: string; title: string }[] }]
>('workspaceBulkTransfer/openModal');

/** Close and reset. Ignored while a run is in progress. */
export const closeBulkTransferModal = createAction('workspaceBulkTransfer/closeModal');

export const bulkTransferSizeLoaded = createAction<
  [payload: { workspaceId: string; sizeBytes: number }]
>('workspaceBulkTransfer/sizeLoaded');

export const bulkTransferSizeFailed = createAction<[payload: { workspaceId: string }]>(
  'workspaceBulkTransfer/sizeFailed',
);

export const selectBulkTransferTarget = createAction<[connectionId: string]>(
  'workspaceBulkTransfer/selectTarget',
);

export const setBulkTransferRestartAgents = createAction<[value: boolean]>(
  'workspaceBulkTransfer/setRestartAgents',
);

export const setBulkTransferArchiveSource = createAction<[value: boolean]>(
  'workspaceBulkTransfer/setArchiveSource',
);

export const bulkTransferStartRequested = createAction('workspaceBulkTransfer/startRequested');

export const bulkTransferItemStarted = createAction<[workspaceId: string]>(
  'workspaceBulkTransfer/itemStarted',
);

export const bulkTransferProgressReceived = createAction<[progress: TransferProgress]>(
  'workspaceBulkTransfer/progressReceived',
);

export const bulkTransferItemSucceeded = createAction<[workspaceId: string]>(
  'workspaceBulkTransfer/itemSucceeded',
);

export const bulkTransferItemFailed = createAction<
  [payload: { workspaceId: string; error: string }]
>('workspaceBulkTransfer/itemFailed');

/** Stop the run: the running transfer is cancelled, the rest are skipped. */
export const bulkTransferCancelRequested = createAction('workspaceBulkTransfer/cancelRequested');

/** Saga: the run ended; unfinished workspaces become skipped. */
export const bulkTransferFinished = createAction('workspaceBulkTransfer/finished');

function patchItem(
  state: WorkspaceBulkTransferState,
  workspaceId: string,
  patch: Partial<BulkTransferItem>,
): WorkspaceBulkTransferState {
  return { ...state, items: updateItem(state.items, { ...patch, workspaceId }) };
}

export const workspaceBulkTransferReducer = createReducer<WorkspaceBulkTransferState>(initialState);
workspaceBulkTransferReducer.with(openBulkTransferModal, (state, { payload: [{ workspaces }] }) =>
  state.step === 'transferring'
    ? state
    : {
        ...initialState,
        open: true,
        items: createCollection<BulkTransferItem, 'workspaceId'>(
          'workspaceId',
          workspaces.map(({ workspaceId, title }) => ({
            workspaceId,
            title,
            sizeStatus: 'loading',
            sizeBytes: null,
            status: 'pending',
            error: null,
          })),
        ),
      },
);
workspaceBulkTransferReducer.with(closeBulkTransferModal, (state) =>
  state.step === 'transferring' ? state : initialState,
);
workspaceBulkTransferReducer.with(
  bulkTransferSizeLoaded,
  (state, { payload: [{ workspaceId, sizeBytes }] }) =>
    patchItem(state, workspaceId, { sizeStatus: 'loaded', sizeBytes }),
);
workspaceBulkTransferReducer.with(bulkTransferSizeFailed, (state, { payload: [{ workspaceId }] }) =>
  patchItem(state, workspaceId, { sizeStatus: 'error', sizeBytes: null }),
);
workspaceBulkTransferReducer.with(selectBulkTransferTarget, (state, { payload: [connectionId] }) =>
  state.step === 'setup' ? { ...state, connectionId } : state,
);
workspaceBulkTransferReducer.with(setBulkTransferRestartAgents, (state, { payload: [value] }) =>
  state.step === 'setup' ? { ...state, restartAgents: value } : state,
);
workspaceBulkTransferReducer.with(setBulkTransferArchiveSource, (state, { payload: [value] }) =>
  state.step === 'setup' ? { ...state, archiveSource: value } : state,
);
workspaceBulkTransferReducer.with(bulkTransferStartRequested, (state) => {
  if (
    !state.open ||
    state.step !== 'setup' ||
    !state.connectionId ||
    !getItems(state.items).length
  ) {
    return state;
  }
  return { ...state, step: 'transferring', cancelling: false, currentId: null, progress: null };
});
workspaceBulkTransferReducer.with(bulkTransferItemStarted, (state, { payload: [workspaceId] }) => ({
  ...patchItem(state, workspaceId, { status: 'running', error: null }),
  currentId: workspaceId,
  progress: null,
}));
workspaceBulkTransferReducer.with(bulkTransferProgressReceived, (state, { payload: [progress] }) =>
  state.step === 'transferring' && state.currentId ? { ...state, progress } : state,
);
workspaceBulkTransferReducer.with(bulkTransferItemSucceeded, (state, { payload: [workspaceId] }) =>
  patchItem(state, workspaceId, { status: 'done', error: null }),
);
workspaceBulkTransferReducer.with(
  bulkTransferItemFailed,
  (state, { payload: [{ workspaceId, error }] }) =>
    patchItem(state, workspaceId, { status: 'failed', error }),
);
workspaceBulkTransferReducer.with(bulkTransferCancelRequested, (state) =>
  state.step === 'transferring' ? { ...state, cancelling: true } : state,
);
workspaceBulkTransferReducer.with(bulkTransferFinished, (state) => ({
  ...state,
  step: 'result',
  currentId: null,
  progress: null,
  items: createCollection<BulkTransferItem, 'workspaceId'>(
    'workspaceId',
    getItems(state.items).map((item) =>
      item.status === 'pending' || item.status === 'running'
        ? { ...item, status: 'skipped', error: null }
        : item,
    ),
  ),
}));
