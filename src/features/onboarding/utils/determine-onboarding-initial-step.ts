export function determineOnboardingInitialStep(inputs: {
  requirementsCheckedOnce: boolean;
  allRequirementsMet: boolean;
}): 'requirements' | 'welcome' {
  return inputs.requirementsCheckedOnce && inputs.allRequirementsMet ? 'welcome' : 'requirements';
}
