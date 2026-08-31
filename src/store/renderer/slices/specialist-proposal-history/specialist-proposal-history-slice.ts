import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  SpecialistProposalHistoryEntry,
  SpecialistProposalHistoryState,
  SpecialistReverseAction,
} from './specialist-proposal-history-types';

export const SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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

export const hydrateSpecialistProposalHistory = createAction<
  [entries: Record<string, SpecialistProposalHistoryEntry>]
>('specialistProposalHistory/hydrateSpecialistProposalHistory');

export function pruneExpiredSpecialistProposalHistoryEntries(
  entries: Record<string, SpecialistProposalHistoryEntry>,
  now: number,
): Record<string, SpecialistProposalHistoryEntry> {
  const cutoff = now - SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS;
  return Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => entry.appliedAt >= cutoff),
  );
}

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
specialistProposalHistoryReducer.with(
  hydrateSpecialistProposalHistory,
  (_state, { payload: [entries] }) => ({ entries }),
);
