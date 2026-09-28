import { describe, expect, it } from 'vitest';
import {
  closePalette,
  initialState,
  openGoToLine,
  openPalette,
  paletteReducer,
  togglePalette,
} from './palette-slice';

describe('paletteReducer', () => {
  it('returns the initial state', () => {
    expect(paletteReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('updates open and query state', () => {
    expect(paletteReducer(initialState, openPalette())).toMatchObject({ isOpen: true, query: '' });
    expect(
      paletteReducer({ ...initialState, isOpen: true, query: 'abc' }, closePalette()),
    ).toMatchObject({
      isOpen: false,
      query: '',
    });
    expect(paletteReducer(initialState, openGoToLine())).toMatchObject({
      isOpen: true,
      query: ':',
    });
    expect(paletteReducer(initialState, togglePalette()).isOpen).toBe(true);
  });

  it('opens a recovery search without changing recent entries, and clears it for a normal open', () => {
    const before = { ...initialState, fileMru: { 'notes/context.ts': 123 } };
    const opened = paletteReducer(before, openPalette('GitLab'));
    expect(opened).toEqual({ ...before, isOpen: true, query: 'GitLab' });
    expect(paletteReducer(opened, openPalette())).toEqual({ ...before, isOpen: true, query: '' });
    expect(paletteReducer(opened, closePalette())).toEqual(before);
  });
});
