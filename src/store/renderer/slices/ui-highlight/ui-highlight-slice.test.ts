import { describe, expect, it } from 'vitest';
import {
  clearUiHighlight,
  initialState,
  requestUiHighlight,
  uiHighlightReducer,
} from './ui-highlight-slice';

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

  it('clears a matching token', () => {
    const active = uiHighlightReducer(initialState, requestUiHighlight('theme'));
    const cleared = uiHighlightReducer(active, clearUiHighlight('theme', 1));

    expect(cleared.activeById.theme).toBeUndefined();
  });

  it('clears custom highlight duration with the active token', () => {
    const active = uiHighlightReducer(
      initialState,
      requestUiHighlight('theme', { durationMs: 1200 }),
    );
    const cleared = uiHighlightReducer(active, clearUiHighlight('theme', 1));

    expect(cleared.activeById.theme).toBeUndefined();
    expect(cleared.durationMsById.theme).toBeUndefined();
  });

  it('keeps newer highlights when an older token clears', () => {
    const once = uiHighlightReducer(initialState, requestUiHighlight('theme'));
    const twice = uiHighlightReducer(once, requestUiHighlight('theme'));
    const state = uiHighlightReducer(twice, clearUiHighlight('theme', 1));

    expect(state).toBe(twice);
    expect(state.activeById.theme).toBe(2);
  });

  it('ignores blank highlight ids', () => {
    const state = uiHighlightReducer(initialState, requestUiHighlight('   '));

    expect(state).toBe(initialState);
  });
});
