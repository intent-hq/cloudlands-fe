import { describe, expect, it } from 'vitest';
import { initialState, settingsProposalHistoryReducer } from './settings-proposal-history-slice';

describe('settingsProposalHistoryReducer', () => {
  it('returns initial state', () => {
    expect(settingsProposalHistoryReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });
});
