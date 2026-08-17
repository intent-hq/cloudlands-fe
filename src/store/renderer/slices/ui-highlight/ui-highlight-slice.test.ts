import { describe, expect, it } from 'vitest';
import { initialState, requestUiHighlight, uiHighlightReducer } from './ui-highlight-slice';

describe('uiHighlightReducer', () => {
  it('returns initial state', () => {
    expect(uiHighlightReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('activates a highlight token for an id', () => {
    const state = uiHighlightReducer(initialState, requestUiHighlight('theme'));

    expect(state.activeById.theme).toBe(1);
  });

  it('increments the token when the same id is highlighted again', () => {
    const once = uiHighlightReducer(initialState, requestUiHighlight('theme'));
    const twice = uiHighlightReducer(once, requestUiHighlight('theme'));

    expect(twice.activeById.theme).toBe(2);
  });

  it('stores custom highlight duration when provided', () => {
    const state = uiHighlightReducer(
      initialState,
      requestUiHighlight('theme', { durationMs: 1200 }),
    );

    expect(state.activeById.theme).toBe(1);
    expect(state.durationMsById.theme).toBe(1200);
  });

  it('resets custom duration when the same id is highlighted without one', () => {
    const custom = uiHighlightReducer(
      initialState,
      requestUiHighlight('theme', { durationMs: 1200 }),
    );
    const state = uiHighlightReducer(custom, requestUiHighlight('theme'));

    expect(state.activeById.theme).toBe(2);
    expect(state.durationMsById.theme).toBeUndefined();
  });

  it('ignores blank highlight ids', () => {
    const state = uiHighlightReducer(initialState, requestUiHighlight('   '));

    expect(state).toBe(initialState);
  });
});
