import { describe, expect, it } from 'vitest';
import { deepLinksReducer, initialState } from './deep-links-slice';

describe('deepLinksReducer', () => {
  it('returns the initial state', () => {
    expect(deepLinksReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });
});
