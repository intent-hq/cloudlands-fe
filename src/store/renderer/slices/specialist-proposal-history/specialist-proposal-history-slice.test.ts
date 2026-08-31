import { describe, expect, it, vi } from 'vitest';

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

import {
  clearSpecialistApplied,
  initialState,
  recordSpecialistApplied,
  specialistProposalHistoryReducer,
} from './specialist-proposal-history-slice';
import { selectSpecialistProposalAppliedState } from './specialist-proposal-history-selectors';
import type { SpecialistReverseAction } from './specialist-proposal-history-types';

const deleteReverse: SpecialistReverseAction = { kind: 'delete', id: 'spec-1', scope: 'user' };
const saveReverse: SpecialistReverseAction = {
  kind: 'save',
  specialist: {
    id: 'spec-1',
    name: 'Reviewer',
    description: 'Reviews code',
    behaviorPrompt: 'Review carefully.',
  },
};

describe('specialistProposalHistoryReducer', () => {
  it('returns initial state', () => {
    expect(specialistProposalHistoryReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('records an applied specialist proposal entry', () => {
    const state = specialistProposalHistoryReducer(
      initialState,
      recordSpecialistApplied({ proposalId: 'p1', appliedAt: 100, reverse: deleteReverse }),
    );
    expect(state.entries.p1).toEqual({ appliedAt: 100, reverse: deleteReverse });
  });

  it('overwrites an existing entry for the same proposal id', () => {
    let state = specialistProposalHistoryReducer(
      initialState,
      recordSpecialistApplied({ proposalId: 'p1', appliedAt: 100, reverse: deleteReverse }),
    );
    state = specialistProposalHistoryReducer(
      state,
      recordSpecialistApplied({ proposalId: 'p1', appliedAt: 200, reverse: saveReverse }),
    );
    expect(state.entries.p1).toEqual({ appliedAt: 200, reverse: saveReverse });
  });

  it('clears a recorded entry and keeps the rest', () => {
    let state = specialistProposalHistoryReducer(
      initialState,
      recordSpecialistApplied({ proposalId: 'p1', appliedAt: 100, reverse: deleteReverse }),
    );
    state = specialistProposalHistoryReducer(
      state,
      recordSpecialistApplied({ proposalId: 'p2', appliedAt: 150, reverse: saveReverse }),
    );

    state = specialistProposalHistoryReducer(state, clearSpecialistApplied('p1'));

    expect(state.entries.p1).toBeUndefined();
    expect(state.entries.p2).toEqual({ appliedAt: 150, reverse: saveReverse });
  });

  it('returns the same state reference when clearing an unknown proposal id', () => {
    const state = specialistProposalHistoryReducer(
      initialState,
      recordSpecialistApplied({ proposalId: 'p1', appliedAt: 100, reverse: deleteReverse }),
    );
    const next = specialistProposalHistoryReducer(state, clearSpecialistApplied('other'));
    expect(next).toBe(state);
  });
});

describe('selectSpecialistProposalAppliedState', () => {
  it('returns the entry after a record action and null after a clear', () => {
    let sliceState = specialistProposalHistoryReducer(
      initialState,
      recordSpecialistApplied({ proposalId: 'p1', appliedAt: 100, reverse: deleteReverse }),
    );
    const recorded = selectSpecialistProposalAppliedState.select(
      { specialistProposalHistory: sliceState },
      'p1',
    );
    expect(recorded).toEqual({ appliedAt: 100, reverse: deleteReverse });

    sliceState = specialistProposalHistoryReducer(sliceState, clearSpecialistApplied('p1'));
    const cleared = selectSpecialistProposalAppliedState.select(
      { specialistProposalHistory: sliceState },
      'p1',
    );
    expect(cleared).toBeNull();
  });
});
