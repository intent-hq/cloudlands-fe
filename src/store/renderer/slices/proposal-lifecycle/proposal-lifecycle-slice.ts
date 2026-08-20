import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  ApplyProposalRequest,
  ProposalApplyResult,
  ProposalLifecycleAction,
  ProposalLifecycleState,
  UndoProposalRequest,
} from './proposal-lifecycle-types';

export const initialState: ProposalLifecycleState = {};

const PROPOSAL_LIFECYCLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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

export const proposalFailed = createAction<
  [
    payload: {
      proposalId: string;
      error: string;
      /** Daemon-provided machine-readable code (`error.data.code`), when present. */
      errorCode?: string;
      completedAt: number;
      lastAction: ProposalLifecycleAction;
    },
  ]
>('proposalLifecycle/proposalFailed');

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

export const proposalLifecycleReducer = createReducer<ProposalLifecycleState>(initialState);
proposalLifecycleReducer.with(
  proposalApplyStarted,
  (state, { payload: [{ proposalId, startedAt }] }) => {
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
  },
);
proposalLifecycleReducer.with(
  proposalApplySucceeded,
  (state, { payload: [{ proposalId, completedAt, result }] }) => ({
    ...state,
    [proposalId]: {
      ...state[proposalId],
      status: 'applied',
      error: undefined,
      errorCode: undefined,
      completedAt,
      lastAction: 'apply',
      ...(result !== undefined ? { result } : {}),
    },
  }),
);
proposalLifecycleReducer.with(
  proposalFailed,
  (state, { payload: [{ proposalId, error, errorCode, completedAt, lastAction }] }) => ({
    ...state,
    [proposalId]: {
      ...state[proposalId],
      status: 'failed',
      error,
      errorCode,
      completedAt,
      lastAction,
    },
  }),
);
