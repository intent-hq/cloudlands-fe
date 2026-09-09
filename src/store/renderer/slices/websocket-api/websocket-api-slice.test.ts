import { describe, expect, it } from 'vitest';
import { initialState, websocketApiReducer } from './websocket-api-slice';

describe('websocketApiReducer', () => {
  it('returns the initial state', () => {
    expect(websocketApiReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });
});
