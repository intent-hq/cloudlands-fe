import { describe, expect, it } from 'vitest';
import {
  clearPrBranchLookup,
  initialState,
  prBranchLookupFailed,
  prBranchLookupReducer,
  prBranchLookupStarted,
  prBranchLookupSucceeded,
  requestPrBranchLookup,
} from './pr-branch-lookup-slice';

const request = requestPrBranchLookup({
  owner: 'augmentcode',
  repo: 'intent',
  prNumber: 648,
}).payload;

describe('prBranchLookupReducer', () => {
  it('returns the initial state', () => {
    expect(prBranchLookupReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('tracks loading, success, and failure entries by lookup key', () => {
    const loading = prBranchLookupReducer(initialState, prBranchLookupStarted(request));
    expect(loading.byKey[request.key]).toEqual({ status: 'loading' });

    const succeeded = prBranchLookupReducer(
      loading,
      prBranchLookupSucceeded(request, 'install-local-package'),
    );
    expect(succeeded.byKey[request.key]).toEqual({
      status: 'succeeded',
      branch: 'install-local-package',
    });

    const failed = prBranchLookupReducer(succeeded, prBranchLookupFailed(request, 'rate limited'));
    expect(failed.byKey[request.key]).toEqual({ status: 'failed', error: 'rate limited' });
  });

  it('clears cached entries', () => {
    const state = prBranchLookupReducer(initialState, prBranchLookupStarted(request));

    expect(prBranchLookupReducer(state, clearPrBranchLookup())).toEqual(initialState);
  });
});
