import type { HostRole } from '$shared/types/principal';

export function determineOnboardingInitialStep(inputs: {
  hostRole?: HostRole | null;
  requirementsCheckedOnce: boolean;
  allRequirementsMet: boolean;
}): 'requirements' | 'welcome' | 'project' {
  // Members use the host's existing setup; provider/account administration is owner-only.
  if (inputs.hostRole === 'member') return 'project';
  return inputs.requirementsCheckedOnce && inputs.allRequirementsMet ? 'welcome' : 'requirements';
}
