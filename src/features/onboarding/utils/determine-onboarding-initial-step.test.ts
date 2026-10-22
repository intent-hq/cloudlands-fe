import { describe, expect, it } from 'vitest';

import { determineOnboardingInitialStep } from './determine-onboarding-initial-step';

const setupStates = [false, true].flatMap((fullFlowRequested) =>
  [false, true].flatMap((hasReadyProvider) =>
    [false, true].flatMap((hasCompletedProviderSetup) =>
      [false, true].flatMap((hasWorkspaces) =>
        [false, true].map((providersCheckedOnce) => ({
          fullFlowRequested,
          hasReadyProvider,
          hasCompletedProviderSetup,
          hasWorkspaces,
          providersCheckedOnce,
        })),
      ),
    ),
  ),
);

describe('determineOnboardingInitialStep', () => {
  it('opens repository selection for members without running host setup', () => {
    expect(
      determineOnboardingInitialStep({
        hostRole: 'member',
        requirementsCheckedOnce: false,
        allRequirementsMet: false,
      }),
    ).toBe('project');
  });

  it.each(['owner', 'guest', null] as const)(
    'does not bypass setup with %s authority',
    (hostRole) => {
      expect(
        determineOnboardingInitialStep({
          hostRole,
          requirementsCheckedOnce: false,
          allRequirementsMet: false,
        }),
      ).toBe('requirements');
    },
  );
  it.each(setupStates)('starts at welcome regardless of prior setup: %j', (setupState) => {
    expect(
      determineOnboardingInitialStep({
        ...setupState,
        requirementsCheckedOnce: true,
        allRequirementsMet: true,
      }),
    ).toBe('welcome');
  });

  it.each([
    { requirementsCheckedOnce: false, allRequirementsMet: false },
    { requirementsCheckedOnce: false, allRequirementsMet: true },
    { requirementsCheckedOnce: true, allRequirementsMet: false },
  ])('keeps incomplete requirements blocking onboarding: %j', (requirements) => {
    for (const setupState of setupStates) {
      expect(determineOnboardingInitialStep({ ...setupState, ...requirements })).toBe(
        'requirements',
      );
    }
  });
});
