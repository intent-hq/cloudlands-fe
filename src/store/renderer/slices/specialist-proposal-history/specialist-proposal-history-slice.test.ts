import { describe, expect, it } from 'vitest';
import {
  clearSpecialistApplied,
  hydrateSpecialistProposalHistory,
  initialState,
  pruneExpiredSpecialistProposalHistoryEntries,
  recordSpecialistApplied,
  SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS,
  specialistProposalHistoryReducer,
} from './specialist-proposal-history-slice';
import { selectSpecialistProposalAppliedState } from './specialist-proposal-history-selectors';
import type { StoreState } from '../../types';
import type { SpecialistReverseAction } from './specialist-proposal-history-types';

const reverse: SpecialistReverseAction = { kind: 'delete', id: 'review-buddy', scope: 'user' };

describe('specialistProposalHistoryReducer', () => {
  it('returns initial state', () => {
    expect(specialistProposalHistoryReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('records and selects applied proposal state', () => {
    const state = specialistProposalHistoryReducer(
      initialState,
      recordSpecialistApplied({ proposalId: 'proposal-1', appliedAt: 123, reverse }),
    );

    expect(state.entries['proposal-1']).toEqual({ appliedAt: 123, reverse });
    expect(
      selectSpecialistProposalAppliedState.select(
        { specialistProposalHistory: state } as StoreState,
        'proposal-1',
      ),
    ).toEqual({ appliedAt: 123, reverse });
  });

  it('clears an applied proposal entry', () => {
    const state = specialistProposalHistoryReducer(
      { entries: { 'proposal-1': { appliedAt: 123, reverse } } },
      clearSpecialistApplied('proposal-1'),
    );

    expect(state.entries).toEqual({});
  });

  it('hydrates entries and prunes entries older than 30 days with the helper', () => {
    const now = 10_000_000_000;
    const fresh = { appliedAt: now - SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS + 1, reverse };
    const stale = { appliedAt: now - SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS - 1, reverse };
    const pruned = pruneExpiredSpecialistProposalHistoryEntries({ fresh, stale }, now);
    const state = specialistProposalHistoryReducer(
      initialState,
      hydrateSpecialistProposalHistory(pruned),
    );

    expect(state.entries).toEqual({ fresh });
  });
});
