import { describe, expect, it, vi } from 'vitest';

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

import {
  clearProposalApplied,
  initialState,
  recordProposalApplied,
  settingsProposalHistoryReducer,
} from './settings-proposal-history-slice';
import { selectProposalAppliedState } from './settings-proposal-history-selectors';
import type { SettingsProposalReverseChange } from './settings-proposal-history-types';

const reverseChanges: SettingsProposalReverseChange[] = [
  {
    path: 'appearance.theme',
    value: 'dark',
    apply: { kind: 'redux-action', action: 'settings/setTheme' },
  },
];

describe('settingsProposalHistoryReducer', () => {
  it('returns initial state', () => {
    expect(settingsProposalHistoryReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('records an applied proposal entry', () => {
    const state = settingsProposalHistoryReducer(
      initialState,
      recordProposalApplied({ proposalId: 'p1', appliedAt: 100, reverseChanges }),
    );
    expect(state.entries.p1).toEqual({ appliedAt: 100, reverseChanges });
  });

  it('overwrites an existing entry for the same proposal id', () => {
    let state = settingsProposalHistoryReducer(
      initialState,
      recordProposalApplied({ proposalId: 'p1', appliedAt: 100, reverseChanges }),
    );
    state = settingsProposalHistoryReducer(
      state,
      recordProposalApplied({ proposalId: 'p1', appliedAt: 200, reverseChanges: [] }),
    );
    expect(state.entries.p1).toEqual({ appliedAt: 200, reverseChanges: [] });
  });

  it('clears a recorded entry and keeps the rest', () => {
    let state = settingsProposalHistoryReducer(
      initialState,
      recordProposalApplied({ proposalId: 'p1', appliedAt: 100, reverseChanges }),
    );
    state = settingsProposalHistoryReducer(
      state,
      recordProposalApplied({ proposalId: 'p2', appliedAt: 150, reverseChanges: [] }),
    );

    state = settingsProposalHistoryReducer(state, clearProposalApplied('p1'));

    expect(state.entries.p1).toBeUndefined();
    expect(state.entries.p2).toEqual({ appliedAt: 150, reverseChanges: [] });
  });

  it('returns the same state reference when clearing an unknown proposal id', () => {
    const state = settingsProposalHistoryReducer(
      initialState,
      recordProposalApplied({ proposalId: 'p1', appliedAt: 100, reverseChanges }),
    );
    const next = settingsProposalHistoryReducer(state, clearProposalApplied('other'));
    expect(next).toBe(state);
  });
});

describe('selectProposalAppliedState', () => {
  it('returns the entry after a record action and null after a clear', () => {
    let sliceState = settingsProposalHistoryReducer(
      initialState,
      recordProposalApplied({ proposalId: 'p1', appliedAt: 100, reverseChanges }),
    );
    const recorded = selectProposalAppliedState.select(
      { settingsProposalHistory: sliceState },
      'p1',
    );
    expect(recorded).toEqual({ appliedAt: 100, reverseChanges });

    sliceState = settingsProposalHistoryReducer(sliceState, clearProposalApplied('p1'));
    const cleared = selectProposalAppliedState.select(
      { settingsProposalHistory: sliceState },
      'p1',
    );
    expect(cleared).toBeNull();
  });
});
