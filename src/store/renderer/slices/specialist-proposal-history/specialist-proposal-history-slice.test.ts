import { describe, expect, it } from 'vitest';
import { initialState, specialistProposalHistoryReducer } from './specialist-proposal-history-slice';
describe('specialistProposalHistoryReducer', () => {
  it('returns initial state', () => {
    expect(specialistProposalHistoryReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });
});
