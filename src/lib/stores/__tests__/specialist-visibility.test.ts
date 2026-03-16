import { describe, expect, it } from 'vitest';

import { SPECIALISTS } from '$lib/constants/specialists';

import { applySpecialistVisibilityFilters } from '../specialist-visibility';

describe('applySpecialistVisibilityFilters', () => {
  it('still applies GitHub gating when ralph-agent is disabled', () => {
    const ids = applySpecialistVisibilityFilters(SPECIALISTS, {
      isRalphAgentEnabled: false,
      isGithubAuthenticated: false,
    }).map((specialist) => specialist.id);

    expect(ids).not.toContain('ralph');
    expect(ids).not.toContain('pr-shepherd');
    expect(ids).not.toContain('pr-reviewer');
    expect(ids).toContain('implementor');
  });

  it('keeps GitHub-dependent specialists when GitHub is authenticated', () => {
    const ids = applySpecialistVisibilityFilters(SPECIALISTS, {
      isRalphAgentEnabled: false,
      isGithubAuthenticated: true,
    }).map((specialist) => specialist.id);

    expect(ids).not.toContain('ralph');
    expect(ids).toContain('pr-shepherd');
    expect(ids).toContain('pr-reviewer');
  });
});