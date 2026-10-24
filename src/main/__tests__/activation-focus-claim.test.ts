import { describe, expect, it } from 'vitest';

import {
  ACTIVATION_FOCUS_CLAIM_TTL_MS,
  claimActivationFocus,
  getActivationFocusClaim,
} from '../activation-focus-claim';

function fakeWindow(destroyed = false) {
  return {
    destroyed,
    isDestroyed() {
      return this.destroyed;
    },
  };
}

describe('activation focus claim', () => {
  it('returns the claimed window until the claim expires', () => {
    const window = fakeWindow();
    claimActivationFocus(window, 1000);

    expect(getActivationFocusClaim(1000 + ACTIVATION_FOCUS_CLAIM_TTL_MS - 1)).toBe(window);
    expect(getActivationFocusClaim(1000 + ACTIVATION_FOCUS_CLAIM_TTL_MS)).toBeUndefined();
    // An expired claim stays cleared.
    expect(getActivationFocusClaim(1000)).toBeUndefined();
  });

  it('drops a claim whose window was destroyed', () => {
    const window = fakeWindow();
    claimActivationFocus(window, 0);
    window.destroyed = true;

    expect(getActivationFocusClaim(1)).toBeUndefined();
  });

  it('a newer claim replaces the previous one', () => {
    const first = fakeWindow();
    const second = fakeWindow();
    claimActivationFocus(first, 0);
    claimActivationFocus(second, 10);

    expect(getActivationFocusClaim(20)).toBe(second);
  });
});
