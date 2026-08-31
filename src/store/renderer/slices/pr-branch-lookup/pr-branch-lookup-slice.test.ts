import { describe, expect, it } from 'vitest';
import {
  getPrBranchLookupKey,
  initialState,
  prBranchLookupFailed,
  prBranchLookupReducer,
  prBranchLookupStarted,
  prBranchLookupSucceeded,
} from './pr-branch-lookup-slice';

const request = { owner: 'intent-hq', repo: 'intentd', prNumber: 42 };
const payload = { ...request, key: getPrBranchLookupKey(request) };

describe('prBranchLookupReducer', () => {
  it('returns the initial state', () => {
    expect(prBranchLookupReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('derives the lookup key from owner/repo#number', () => {
    expect(payload.key).toBe('intent-hq/intentd#42');
  });

  it('marks the entry loading on started', () => {
    const state = prBranchLookupReducer(initialState, prBranchLookupStarted(payload));
    expect(state.byKey[payload.key]).toEqual({ status: 'loading' });
  });

  it('stores the branch on succeeded', () => {
    const loading = prBranchLookupReducer(initialState, prBranchLookupStarted(payload));
    const state = prBranchLookupReducer(loading, prBranchLookupSucceeded(payload, 'feat/thing'));
    expect(state.byKey[payload.key]).toEqual({ status: 'succeeded', branch: 'feat/thing' });
  });

  it('stores the error on failed', () => {
    const loading = prBranchLookupReducer(initialState, prBranchLookupStarted(payload));
    const state = prBranchLookupReducer(loading, prBranchLookupFailed(payload, 'boom'));
    expect(state.byKey[payload.key]).toEqual({ status: 'failed', error: 'boom' });
  });
});
