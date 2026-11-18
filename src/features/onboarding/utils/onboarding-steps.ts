/**
 * The onboarding steps the step indicator counts and Back walks through.
 * The `requirements` gate is never shown; members skip the provider steps;
 * `connect` (the provider's key or token) runs only on an orchestrator.
 */
import {
  STEP_ORDER,
  type OnboardingStep,
} from '$store/renderer/slices/onboarding/onboarding-types';

export function visibleOnboardingSteps(input: {
  hostRole: string | null | undefined;
  orchestrator: boolean;
}): OnboardingStep[] {
  return STEP_ORDER.filter((step) => {
    if (step === 'requirements') return false;
    if (
      input.hostRole === 'member' &&
      (step === 'welcome' || step === 'connect' || step === 'forge')
    )
      return false;
    return step !== 'connect' || input.orchestrator;
  });
}

export function stepAfterWelcome(orchestrator: boolean): OnboardingStep {
  return orchestrator ? 'connect' : 'forge';
}
