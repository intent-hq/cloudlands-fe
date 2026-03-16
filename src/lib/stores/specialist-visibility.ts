import {
  GITHUB_DEPENDENT_SPECIALIST_IDS,
  type Specialist,
} from '$lib/constants/specialists';

interface SpecialistVisibilityFilters {
  isRalphAgentEnabled: boolean;
  isGithubAuthenticated: boolean;
}

export function applySpecialistVisibilityFilters(
  specialists: Specialist[],
  { isRalphAgentEnabled, isGithubAuthenticated }: SpecialistVisibilityFilters,
): Specialist[] {
  let result = specialists;

  if (!isRalphAgentEnabled) {
    result = result.filter((specialist) => specialist.id !== 'ralph');
  }

  if (!isGithubAuthenticated) {
    result = result.filter((specialist) => !GITHUB_DEPENDENT_SPECIALIST_IDS.has(specialist.id));
  }

  return result;
}