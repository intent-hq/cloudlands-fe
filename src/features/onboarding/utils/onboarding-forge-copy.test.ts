import { describe, expect, it } from 'vitest';
import { onboardingForgeCopy } from './onboarding-forge-copy';

describe('onboardingForgeCopy', () => {
  it('names GitHub and GitLab when GitLab can be set up', () => {
    const copy = onboardingForgeCopy(true);
    expect(copy.title).toBe('Connect GitHub or GitLab (optional)');
    expect(copy.after).toContain('Skip this');
  });

  it('names only GitHub on a daemon that cannot set up GitLab', () => {
    expect(onboardingForgeCopy(false).title).toBe('Connect GitHub (optional)');
  });
});
