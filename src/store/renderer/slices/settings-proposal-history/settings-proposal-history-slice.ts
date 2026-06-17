import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";
import type {
  SettingsProposalHistoryEntry,
  SettingsProposalHistoryState,
  SettingsProposalReverseChange,
} from './settings-proposal-history-types';

export const SETTINGS_PROPOSAL_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const initialState: SettingsProposalHistoryState = { entries: {} };

export const recordProposalApplied = createAction<
  [
    payload: {
      proposalId: string;
      appliedAt: number;
      reverseChanges: SettingsProposalReverseChange[];
    },
  ]
>('settingsProposalHistory/recordProposalApplied');

export const clearProposalApplied = createAction<[proposalId: string]>(
  'settingsProposalHistory/clearProposalApplied',
);

export const hydrateProposalHistory = createAction<
  [entries: Record<string, SettingsProposalHistoryEntry>]
>('settingsProposalHistory/hydrateProposalHistory');

export function pruneExpiredProposalHistoryEntries(
  entries: Record<string, SettingsProposalHistoryEntry>,
  now: number,
): Record<string, SettingsProposalHistoryEntry> {
  const cutoff = now - SETTINGS_PROPOSAL_HISTORY_RETENTION_MS;
  return Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => entry.appliedAt >= cutoff),
  );
}

export const settingsProposalHistoryReducer = createReducer<SettingsProposalHistoryState>(
  initialState,
)
  .with(
    recordProposalApplied,
    (state, { payload: [{ proposalId, appliedAt, reverseChanges }] }) => ({
      ...state,
      entries: {
        ...state.entries,
        [proposalId]: { appliedAt, reverseChanges },
      },
    }),
  )
  .with(clearProposalApplied, (state, { payload: [proposalId] }) => {
    if (!(proposalId in state.entries)) return state;
    const { [proposalId]: _removed, ...entries } = state.entries;
    return { ...state, entries };
  })
  .with(hydrateProposalHistory, (_state, { payload: [entries] }) => ({ entries }));
