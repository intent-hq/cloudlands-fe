import { describe, expect, it } from 'vitest';
import { stepAfterWelcome, visibleOnboardingSteps } from './onboarding-steps';

describe('visibleOnboardingSteps', () => {
  it('shows four steps on a regular backend', () => {
    expect(visibleOnboardingSteps({ hostRole: 'owner', orchestrator: false })).toEqual([
      'welcome',
      'forge',
      'project',
      'configuring',
      'ready',
    ]);
  });

  it('adds the connect step after the provider on an orchestrator (five steps)', () => {
    expect(visibleOnboardingSteps({ hostRole: 'owner', orchestrator: true })).toEqual([
      'welcome',
      'connect',
      'forge',
      'project',
      'configuring',
      'ready',
    ]);
  });

  it('never shows provider steps to a member', () => {
    for (const orchestrator of [false, true]) {
      expect(visibleOnboardingSteps({ hostRole: 'member', orchestrator })).toEqual([
        'project',
        'configuring',
        'ready',
      ]);
    }
  });
});

describe('stepAfterWelcome', () => {
  it('goes to connect only on an orchestrator', () => {
    expect(stepAfterWelcome(true)).toBe('connect');
    expect(stepAfterWelcome(false)).toBe('forge');
  });
});
