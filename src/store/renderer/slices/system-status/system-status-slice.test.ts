import { describe, expect, it } from 'vitest';
import { initialState, systemStatusReducer } from './system-status-slice';

describe('systemStatusReducer', () => {
  it('returns the initial state', () => {
    expect(systemStatusReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });
});
