import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";
import type {
  ApplyProposalRequest,
  ProposalApplyResult,
  ProposalLifecycleAction,
  ProposalLifecycleState,
  UndoProposalRequest,
} from './proposal-lifecycle-types';

export const initialState: ProposalLifecycleState = {};

export const PROPOSAL_LIFECYCLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const applyProposalRequested = createAction<[request: ApplyProposalRequest]>(
  'proposalLifecycle/applyProposalRequested',
);

export const undoProposalRequested = createAction<[request: UndoProposalRequest]>(
  'proposalLifecycle/undoProposalRequested',
);

export const proposalApplyStarted = createAction<
  [payload: { proposalId: string; startedAt: number }]
>('proposalLifecycle/proposalApplyStarted');

export const proposalApplySucceeded = createAction<
  [payload: { proposalId: string; completedAt: number; result?: ProposalApplyResult }]
>('proposalLifecycle/proposalApplySucceeded');

export const proposalUndoStarted = createAction<
  [payload: { proposalId: string; startedAt: number }]
>('proposalLifecycle/proposalUndoStarted');

export const proposalUndoSucceeded = createAction<
  [payload: { proposalId: string; completedAt: number }]
>('proposalLifecycle/proposalUndoSucceeded');

export const proposalFailed = createAction<
  [
    payload: {
      proposalId: string;
      error: string;
      completedAt: number;
      lastAction: ProposalLifecycleAction;
    },
  ]
>('proposalLifecycle/proposalFailed');

export const clearProposalLifecycle = createAction<[proposalId: string]>(
  'proposalLifecycle/clearProposalLifecycle',
);

export const hydrateProposalLifecycle = createAction<[entries: ProposalLifecycleState]>(
  'proposalLifecycle/hydrateProposalLifecycle',
);

export function pruneAppliedProposalLifecycleEntries(
  entries: ProposalLifecycleState,
  now: number,
): ProposalLifecycleState {
  const cutoff = now - PROPOSAL_LIFECYCLE_RETENTION_MS;
  return Object.fromEntries(
    Object.entries(entries).filter(
      ([, entry]) => entry.status === 'applied' && (entry.completedAt ?? 0) >= cutoff,
    ),
  );
}

export const proposalLifecycleReducer = createReducer<ProposalLifecycleState>(initialState)
  .with(proposalApplyStarted, (state, { payload: [{ proposalId, startedAt }] }) => {
    const current = state[proposalId];
    if (
      current?.status === 'applying' ||
      current?.status === 'undoing' ||
      current?.status === 'applied'
    ) {
      return state;
    }
    return {
      ...state,
      [proposalId]: { status: 'applying', startedAt, lastAction: 'apply' },
    };
  })
  .with(proposalApplySucceeded, (state, { payload: [{ proposalId, completedAt, result }] }) => ({
    ...state,
    [proposalId]: {
      ...state[proposalId],
      status: 'applied',
      error: undefined,
      completedAt,
      lastAction: 'apply',
      ...(result !== undefined ? { result } : {}),
    },
  }))
  .with(proposalUndoStarted, (state, { payload: [{ proposalId, startedAt }] }) => {
    const current = state[proposalId];
    if (
      current?.status === 'undoing' ||
      current?.status === 'applying' ||
      current?.status === 'idle'
    ) {
      return state;
    }
    return {
      ...state,
      [proposalId]: {
        ...current,
        status: 'undoing',
        error: undefined,
        startedAt,
        lastAction: 'undo',
      },
    };
  })
  .with(proposalUndoSucceeded, (state, { payload: [{ proposalId, completedAt }] }) => ({
    ...state,
    [proposalId]: {
      ...state[proposalId],
      status: 'idle',
      error: undefined,
      completedAt,
      lastAction: 'undo',
    },
  }))
  .with(proposalFailed, (state, { payload: [{ proposalId, error, completedAt, lastAction }] }) => ({
    ...state,
    [proposalId]: {
      ...state[proposalId],
      status: 'failed',
      error,
      completedAt,
      lastAction,
    },
  }))
  .with(clearProposalLifecycle, (state, { payload: [proposalId] }) => {
    if (!(proposalId in state)) return state;
    const { [proposalId]: _removed, ...rest } = state;
    return rest;
  })
  .with(hydrateProposalLifecycle, (_state, { payload: [entries] }) => entries);
