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

/**
 * Reconcile a daemon-persisted `agent.resolveProposal` outcome (PROTOCOL
 * §5.5) into local lifecycle state. Dispatched by the resolve-proposal
 * mutation saga on wire success and by metadata-driven reconciliation
 * (resolutions from other clients converging via `agent:updated`). An
 * existing 'applied' entry is never downgraded to 'dismissed' — resolution
 * is idempotent daemon-side and the first outcome wins.
 */
export const proposalResolutionReconciled = createAction<
  [payload: { proposalId: string; outcome: 'applied' | 'dismissed'; completedAt: number }]
>('proposalLifecycle/proposalResolutionReconciled');

/**
 * Agent-scoped lifecycle key for daemon-parity proposal identities
 * (`applyToolCallId ?? preview.title`, PROTOCOL §5.5). Id-less proposals are
 * title-keyed, so a global entry for "Split flaky suite" resolved on agent A
 * would also retire agent B's identically titled, still-pending proposal.
 * Wire reconciliations therefore key under agent + daemon id; transcript-card
 * applies (keyed by `getProposalId`) stay global.
 */
export function agentScopedProposalKey(agentId: string, proposalId: string): string {
  return `${agentId}::${proposalId}`;
}

export function pruneAppliedProposalLifecycleEntries(
  entries: ProposalLifecycleState,
  now: number,
): ProposalLifecycleState {
  const cutoff = now - PROPOSAL_LIFECYCLE_RETENTION_MS;
  return Object.fromEntries(
    Object.entries(entries).filter(
      ([, entry]) =>
        (entry.status === 'applied' || entry.status === 'dismissed') &&
        (entry.completedAt ?? 0) >= cutoff,
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
proposalLifecycleReducer.with(
  proposalResolutionReconciled,
  (state, { payload: [{ proposalId, outcome, completedAt }] }) => {
    const current = state[proposalId];
    if (current?.status === outcome) return state;
    // First outcome wins: never downgrade a locally applied proposal to
    // dismissed (or vice versa) — resolution is idempotent daemon-side.
    if (current?.status === 'applied' || current?.status === 'dismissed') return state;
    if (outcome === 'applied') {
      return {
        ...state,
        [proposalId]: {
          ...current,
          status: 'applied',
          error: undefined,
          errorCode: undefined,
          completedAt,
          lastAction: 'apply' as const,
        },
      };
    }
    return {
      ...state,
      [proposalId]: {
        ...current,
        status: 'dismissed',
        error: undefined,
        errorCode: undefined,
        completedAt,
        lastAction: 'dismiss' as const,
      },
    };
  },
);
