import { describe, expect, it } from 'vitest';
import {
  clearProposalApplied,
  hydrateProposalHistory,
  initialState,
  pruneExpiredProposalHistoryEntries,
  recordProposalApplied,
  SETTINGS_PROPOSAL_HISTORY_RETENTION_MS,
  settingsProposalHistoryReducer,
} from './settings-proposal-history-slice';
import { selectProposalAppliedState } from './settings-proposal-history-selectors';
import type { StoreState } from '../../types';

const reverseChanges = [
  { path: 'theme.activePresetId', value: null, apply: { kind: 'redux-action', action: 'theme/selectThemePreset' } as const },
];

describe('settingsProposalHistoryReducer', () => {
  it('returns initial state', () => {
    expect(settingsProposalHistoryReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('records and selects applied proposal state', () => {
    const state = settingsProposalHistoryReducer(
      initialState,
      recordProposalApplied({ proposalId: 'proposal-1', appliedAt: 123, reverseChanges }),
    );

    expect(state.entries['proposal-1']).toEqual({ appliedAt: 123, reverseChanges });
    expect(selectProposalAppliedState.select({ settingsProposalHistory: state } as StoreState, 'proposal-1'))
      .toEqual({ appliedAt: 123, reverseChanges });
  });

  it('clears an applied proposal entry', () => {
    const state = settingsProposalHistoryReducer(
      { entries: { 'proposal-1': { appliedAt: 123, reverseChanges } } },
      clearProposalApplied('proposal-1'),
    );

    expect(state.entries).toEqual({});
  });

  it('hydrates entries and prunes entries older than 30 days with the helper', () => {
    const now = 10_000_000_000;
    const fresh = { appliedAt: now - SETTINGS_PROPOSAL_HISTORY_RETENTION_MS + 1, reverseChanges };
    const stale = { appliedAt: now - SETTINGS_PROPOSAL_HISTORY_RETENTION_MS - 1, reverseChanges };
    const pruned = pruneExpiredProposalHistoryEntries({ fresh, stale }, now);
    const state = settingsProposalHistoryReducer(initialState, hydrateProposalHistory(pruned));

    expect(state.entries).toEqual({ fresh });
  });
});
