import { store } from "../../store";
import type { SpecialistProposalHistoryEntry } from './specialist-proposal-history-types';

export const selectSpecialistProposalHistoryEntries = store.createSelector(
  (state): Record<string, SpecialistProposalHistoryEntry> =>
    state.specialistProposalHistory.entries,
);

export const selectSpecialistProposalAppliedState = store.createSelector(
  (state, proposalId: string): SpecialistProposalHistoryEntry | null => {
    return state.specialistProposalHistory.entries[proposalId] ?? null;
  },
);
