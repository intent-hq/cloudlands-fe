import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  SettingsProposalHistoryState,
  SettingsProposalReverseChange,
} from './settings-proposal-history-types';

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

export const settingsProposalHistoryReducer =
  createReducer<SettingsProposalHistoryState>(initialState);
settingsProposalHistoryReducer.with(
  recordProposalApplied,
  (state, { payload: [{ proposalId, appliedAt, reverseChanges }] }) => ({
    ...state,
    entries: {
      ...state.entries,
      [proposalId]: { appliedAt, reverseChanges },
    },
  }),
);
settingsProposalHistoryReducer.with(clearProposalApplied, (state, { payload: [proposalId] }) => {
  if (!(proposalId in state.entries)) return state;
  const { [proposalId]: _removed, ...entries } = state.entries;
  return { ...state, entries };
});
