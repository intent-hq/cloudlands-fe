import { store } from "../../store";
import type {
  ProposalApplyResult,
  ProposalLifecycleEntry,
  ProposalLifecycleStatus,
} from './proposal-lifecycle-types';

export const selectProposalLifecycleEntry = store.createSelector(
  (state, proposalId: string): ProposalLifecycleEntry | null =>
    state.proposalLifecycle[proposalId] ?? null,
);

export const selectProposalLifecycleEntries = store.createSelector(
  (state): Record<string, ProposalLifecycleEntry> => state.proposalLifecycle,
);

export const selectProposalStatus = store.createSelector(
  (state, proposalId: string): ProposalLifecycleStatus =>
    state.proposalLifecycle[proposalId]?.status ?? 'idle',
);

export const selectProposalError = store.createSelector(
  (state, proposalId: string): string | null => state.proposalLifecycle[proposalId]?.error ?? null,
);

export const selectProposalResult = store.createSelector(
  (state, proposalId: string): ProposalApplyResult | null =>
    state.proposalLifecycle[proposalId]?.result ?? null,
);
