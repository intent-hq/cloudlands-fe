import { describe, expect, it } from 'vitest';
import { initialState, prBranchLookupReducer } from './pr-branch-lookup-slice';

describe('prBranchLookupReducer', () => {
  it('returns the initial state', () => {
    expect(prBranchLookupReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });
});
