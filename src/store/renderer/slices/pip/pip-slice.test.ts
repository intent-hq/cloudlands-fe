import { describe, it, expect } from 'vitest';
import { pipReducer, initialState } from './pip-slice';

describe('pipReducer', () => {
  it('should return initial state', () => {
    const state = pipReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });
});
