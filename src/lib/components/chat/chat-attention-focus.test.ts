import { describe, expect, it } from 'vitest';
import { getChatAttentionFocusAction } from './chat-attention-focus';

// Failures: mount targets the previous agent; hydration loses the click; a
// stale question opens a newer set; Reply leaves composer inert; rerenders
// steal focus repeatedly; focusing accidentally answers or clears drafts.
const state = {
  active: true,
  handledRequestId: 0,
  questionMessageId: 'q1',
  collapsed: true,
  questionReady: true,
  promptReady: true,
};
describe('explicit Home chat focus', () => {
  it('opens the requested hidden question, then focuses it once', () => {
    const request = { requestId: 1, questionMessageId: 'q1' };
    expect(getChatAttentionFocusAction(request, state)).toBe('expand-question');
    expect(getChatAttentionFocusAction(request, { ...state, collapsed: false })).toBe(
      'focus-question',
    );
    expect(
      getChatAttentionFocusAction(request, { ...state, collapsed: false, handledRequestId: 1 }),
    ).toBeNull();
  });
  it('waits for hydration and refuses a different current question', () => {
    const request = { requestId: 1, questionMessageId: 'q1' };
    expect(getChatAttentionFocusAction(request, { ...state, questionMessageId: null })).toBeNull();
    expect(getChatAttentionFocusAction(request, { ...state, questionMessageId: 'q2' })).toBeNull();
    expect(
      getChatAttentionFocusAction(request, { ...state, collapsed: false, questionReady: false }),
    ).toBeNull();
  });
  it('exposes the composer for Reply and waits until its draft is ready', () => {
    expect(getChatAttentionFocusAction({ requestId: 2 }, { ...state, collapsed: false })).toBe(
      'collapse-question',
    );
    expect(
      getChatAttentionFocusAction({ requestId: 2 }, { ...state, promptReady: false }),
    ).toBeNull();
    expect(getChatAttentionFocusAction({ requestId: 2 }, state)).toBe('focus-prompt');
  });
  it('does nothing without an explicit request or in an inactive panel', () => {
    expect(getChatAttentionFocusAction(undefined, state)).toBeNull();
    expect(getChatAttentionFocusAction({ requestId: 2 }, { ...state, active: false })).toBeNull();
  });
});
