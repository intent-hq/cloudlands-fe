import { describe, expect, it, vi } from 'vitest';

vi.mock(
  'typed-redux-saga',
  async () => await import('$store/renderer/utils/test-helpers/typed-redux-saga-mock'),
);

import {
  clearUiHighlight,
  requestUiHighlight,
  UI_HIGHLIGHT_DURATION_MS,
} from '../ui-highlight-slice';
import { selectUiHighlightToken } from '../ui-highlight-selectors';
import { handleRequestUiHighlight, uiHighlightSaga } from './ui-highlight-saga';

describe('uiHighlightSaga', () => {
  it('clears a requested highlight after the pulse duration', () => {
    const saga = handleRequestUiHighlight(requestUiHighlight('theme'));

    expect(saga.next().value).toMatchObject({
      type: 'SELECT',
      payload: { selector: selectUiHighlightToken.select, args: ['theme'] },
    });

    const delayEffect = saga.next(3).value as any;
    expect(delayEffect).toMatchObject({ type: 'CALL' });
    expect(delayEffect.payload.args).toEqual([UI_HIGHLIGHT_DURATION_MS]);

    expect(saga.next().value).toMatchObject({
      type: 'PUT',
      payload: { action: clearUiHighlight('theme', 3) },
    });
    expect(saga.next().done).toBe(true);
  });

  it('uses a custom duration when requested', () => {
    const saga = handleRequestUiHighlight(requestUiHighlight('theme', { durationMs: 750 }));

    saga.next();
    const delayEffect = saga.next(3).value as any;
    expect(delayEffect).toMatchObject({ type: 'CALL' });
    expect(delayEffect.payload.args).toEqual([750]);
  });

  it('ignores blank highlight ids', () => {
    const saga = handleRequestUiHighlight(requestUiHighlight('   '));

    expect(saga.next().done).toBe(true);
  });

  it('watches highlight requests', () => {
    const saga = uiHighlightSaga();
    const effect = saga.next().value as any;

    expect(effect).toMatchObject({ type: 'FORK' });
    expect(effect.payload.args).toEqual([requestUiHighlight, handleRequestUiHighlight]);
    expect(saga.next().done).toBe(true);
  });
});
