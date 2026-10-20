import { describe, expect, it } from 'vitest';

import { repoAgentSettingsToApply } from './repo-agent-settings';

const remembered = { isTeamMode: true, selectedModel: 'opus' };
const fallback = { isTeamMode: false, selectedModel: 'sonnet' };

describe('repoAgentSettingsToApply', () => {
  it('applies the remembered setup of a newly selected repository', () => {
    expect(
      repoAgentSettingsToApply({
        previousRepoKey: undefined,
        repoKey: 'local:/a',
        remembered,
        fallback,
      }),
    ).toBe(remembered);
    expect(
      repoAgentSettingsToApply({
        previousRepoKey: 'local:/b',
        repoKey: 'local:/a',
        remembered,
        fallback,
      }),
    ).toBe(remembered);
  });

  it('keeps the opening setup for the first repository without memory', () => {
    expect(
      repoAgentSettingsToApply({
        previousRepoKey: undefined,
        repoKey: 'local:/a',
        remembered: null,
        fallback,
      }),
    ).toBeNull();
  });

  it('falls back to the global setup when switching to a repository without memory', () => {
    expect(
      repoAgentSettingsToApply({
        previousRepoKey: 'local:/b',
        repoKey: 'local:/a',
        remembered: null,
        fallback,
      }),
    ).toBe(fallback);
  });

  it('changes nothing while the repository is unchanged or unidentifiable', () => {
    expect(
      repoAgentSettingsToApply({
        previousRepoKey: 'local:/a',
        repoKey: 'local:/a',
        remembered,
        fallback,
      }),
    ).toBeNull();
    expect(
      repoAgentSettingsToApply({
        previousRepoKey: 'local:/a',
        repoKey: null,
        remembered,
        fallback,
      }),
    ).toBeNull();
  });
});
