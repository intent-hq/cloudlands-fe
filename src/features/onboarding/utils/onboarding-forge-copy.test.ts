import { describe, expect, it } from 'vitest';
import { onboardingForgeCopy } from './onboarding-forge-copy';

describe('onboardingForgeCopy', () => {
  it('titles the GitHub-only step as optional', () => {
    const copy = onboardingForgeCopy(false);
    expect(copy.title).toBe('Connect GitHub (optional)');
    expect(copy.after).toContain('Skip this');
  });

  it('titles the GitHub or GitLab step as optional', () => {
    expect(onboardingForgeCopy(true).title).toBe('Connect GitHub or GitLab (optional)');
  });
});
