import { describe, expect, it } from 'vitest';
import { onboardingForgeCopy } from './onboarding-forge-copy';

describe('onboardingForgeCopy', () => {
  it('always offers GitHub or GitLab as an optional step', () => {
    const copy = onboardingForgeCopy();
    expect(copy.title).toBe('Connect GitHub or GitLab (optional)');
    expect(copy.after).toContain('Skip this');
  });
});
