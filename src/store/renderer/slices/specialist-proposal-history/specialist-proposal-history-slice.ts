import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  SpecialistProposalHistoryState,
  SpecialistReverseAction,
} from './specialist-proposal-history-types';

export const initialState: SpecialistProposalHistoryState = { entries: {} };

export const recordSpecialistApplied = createAction<
  [
    payload: {
      proposalId: string;
      appliedAt: number;
      reverse: SpecialistReverseAction;
    },
  ]
>('specialistProposalHistory/recordSpecialistApplied');

export const clearSpecialistApplied = createAction<[proposalId: string]>(
  'specialistProposalHistory/clearSpecialistApplied',
);

export const specialistProposalHistoryReducer =
  createReducer<SpecialistProposalHistoryState>(initialState);
specialistProposalHistoryReducer.with(
  recordSpecialistApplied,
  (state, { payload: [{ proposalId, appliedAt, reverse }] }) => ({
    ...state,
    entries: {
      ...state.entries,
      [proposalId]: { appliedAt, reverse },
    },
  }),
);
specialistProposalHistoryReducer.with(
  clearSpecialistApplied,
  (state, { payload: [proposalId] }) => {
    if (!(proposalId in state.entries)) return state;
    const { [proposalId]: _removed, ...entries } = state.entries;
    return { ...state, entries };
  },
);
