import { store } from "../../store";
import type { SettingsProposalHistoryEntry } from './settings-proposal-history-types';

export const selectSettingsProposalHistoryEntries = store.createSelector(
  (state): Record<string, SettingsProposalHistoryEntry> => state.settingsProposalHistory.entries,
);

export const selectProposalAppliedState = store.createSelector(
  (state, proposalId: string): SettingsProposalHistoryEntry | null => {
    return state.settingsProposalHistory.entries[proposalId] ?? null;
  },
);
