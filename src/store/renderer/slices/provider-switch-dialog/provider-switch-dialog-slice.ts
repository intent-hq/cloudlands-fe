import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createCollection, updateItem } from '@themislib/themis/utils/collections/collection-utils';
import type { BulkAgentOutcome, BulkSwitchTarget } from '$features/agent/bulk-provider-switch';
import type { GroupedFailureKind } from '$features/agent/agent-failure-groups';
import type {
  ProviderSwitchDialogRow,
  ProviderSwitchDialogSliceState,
} from './provider-switch-dialog-types';

const initialState: ProviderSwitchDialogSliceState = {
  open: false,
  groupKey: null,
  kind: null,
  providerLabel: '',
  loading: false,
  running: false,
  finished: false,
  progress: { done: 0, total: 0 },
  rows: createCollection<ProviderSwitchDialogRow, 'key'>('key'),
  outcomes: {},
  workersSwitched: {},
};

/** Saga: open the dialog for a failure group; rows load next. Ignored while a run is active. */
export const providerSwitchDialogOpened = createAction<
  [payload: { groupKey: string; kind: GroupedFailureKind; providerLabel: string }]
>('providerSwitchDialog/opened');

/** Saga: rows built for the open group. */
export const providerSwitchRowsLoaded = createAction<
  [groupKey: string, rows: ProviderSwitchDialogRow[]]
>('providerSwitchDialog/rowsLoaded');

/** User: pick a target for one row. */
export const providerSwitchTargetChosen = createAction<[rowKey: string, target: BulkSwitchTarget]>(
  'providerSwitchDialog/targetChosen',
);

/** User: switch every row's agents to its target and restart them. */
export const providerSwitchConfirmRequested = createAction('providerSwitchDialog/confirmRequested');

/** User: retry every agent on its current provider. */
export const providerSwitchRetryAllRequested = createAction(
  'providerSwitchDialog/retryAllRequested',
);

/** User or saga: close and reset. Ignored while a run is active. */
export const providerSwitchDialogClosed = createAction('providerSwitchDialog/closed');

/** Saga: a bulk run started over `total` agents. */
export const providerSwitchRunStarted = createAction<[total: number]>(
  'providerSwitchDialog/runStarted',
);

/** Saga: one agent of the run settled. */
export const providerSwitchAgentSettled = createAction<[outcome: BulkAgentOutcome]>(
  'providerSwitchDialog/agentSettled',
);

/** Saga: the run ended. */
export const providerSwitchRunFinished = createAction('providerSwitchDialog/runFinished');

export const providerSwitchDialogReducer =
  createReducer<ProviderSwitchDialogSliceState>(initialState);
providerSwitchDialogReducer.with(providerSwitchDialogOpened, (state, { payload: [payload] }) =>
  state.running ? state : { ...initialState, ...payload, open: true, loading: true },
);
providerSwitchDialogReducer.with(
  providerSwitchRowsLoaded,
  (state, { payload: [groupKey, rows] }) =>
    state.open && state.groupKey === groupKey
      ? { ...state, loading: false, rows: createCollection('key', rows) }
      : state,
);
providerSwitchDialogReducer.with(
  providerSwitchTargetChosen,
  (state, { payload: [rowKey, target] }) =>
    state.running || state.finished
      ? state
      : { ...state, rows: updateItem(state.rows, { key: rowKey, selection: target }) },
);
providerSwitchDialogReducer.with(providerSwitchDialogClosed, (state) =>
  state.running ? state : initialState,
);
providerSwitchDialogReducer.with(providerSwitchRunStarted, (state, { payload: [total] }) => ({
  ...state,
  running: true,
  progress: { done: 0, total },
}));
providerSwitchDialogReducer.with(providerSwitchAgentSettled, (state, { payload: [outcome] }) => ({
  ...state,
  progress: { ...state.progress, done: state.progress.done + 1 },
  outcomes: {
    ...state.outcomes,
    [outcome.agentId]: {
      status: outcome.status,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    },
  },
  workersSwitched: outcome.workersSwitched
    ? {
        ...state.workersSwitched,
        [outcome.agentId]: (state.workersSwitched[outcome.agentId] ?? 0) + outcome.workersSwitched,
      }
    : state.workersSwitched,
}));
providerSwitchDialogReducer.with(providerSwitchRunFinished, (state) => ({
  ...state,
  running: false,
  finished: true,
}));
