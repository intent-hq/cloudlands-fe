import { describe, expect, it } from 'vitest';

import {
  hasAgentSetupFields,
  proposalAgentSetup,
  proposalRepoKeys,
  resolveProposalRepoAgentDefault,
} from './proposal-repo-agent';

describe('proposalRepoKeys', () => {
  it('tries the local checkout before the GitHub repository', () => {
    expect(
      proposalRepoKeys({
        repoType: 'github',
        clonePath: '/code/app/',
        githubUrl: 'https://github.com/Acme/App.git',
      }),
    ).toEqual(['local:/code/app', 'github:github.com/acme/app']);
  });

  it('does not treat a GitHub shorthand repo path as a local folder', () => {
    expect(
      proposalRepoKeys({ repoType: 'github', repoPath: 'acme/app', githubUrl: 'acme/app' }),
    ).toEqual(['github:github.com/acme/app']);
  });

  it('keys a local repository by its path and a remote one not at all', () => {
    expect(proposalRepoKeys({ repoType: 'local', repoPath: '/code/app' })).toEqual([
      'local:/code/app',
    ]);
    expect(proposalRepoKeys({ repoType: 'remote', repoPath: '/srv/app' })).toEqual([]);
  });
});

describe('resolveProposalRepoAgentDefault', () => {
  const specialists = [{ id: 'coordinator' }, { id: 'implementor' }];
  const resolve = (
    agentByRepo: Record<string, object>,
    orchestratorId: string | null = 'coordinator',
  ) =>
    resolveProposalRepoAgentDefault({
      repoKeys: ['local:/a', 'github:github.com/acme/a'],
      agentByRepo,
      specialists,
      orchestratorId,
    });

  it('prefers the first key that has a remembered setup', () => {
    const local = { isTeamMode: false, selectedSpecialist: 'implementor' };
    const github = { isTeamMode: true };
    expect(resolve({ 'local:/a': local, 'github:github.com/acme/a': github })).toEqual({
      specialist: 'implementor',
      settings: local,
    });
    expect(resolve({ 'github:github.com/acme/a': github })?.specialist).toBe('coordinator');
  });

  it('maps a single-agent General setup to null', () => {
    expect(
      resolve({ 'local:/a': { isTeamMode: false, selectedSpecialist: null } })?.specialist,
    ).toBeNull();
  });

  it('falls through to the next key when the first remembered agent is unavailable', () => {
    const github = { isTeamMode: false, selectedSpecialist: 'implementor' };
    expect(
      resolve({
        'local:/a': { selectedSpecialist: 'deleted-custom' },
        'github:github.com/acme/a': github,
      }),
    ).toEqual({ specialist: 'implementor', settings: github });
  });

  it('gives up when the remembered agent is unavailable', () => {
    expect(resolve({ 'local:/a': { selectedSpecialist: 'deleted-custom' } })).toBeNull();
    expect(resolve({ 'local:/a': { isTeamMode: true } }, null)).toBeNull();
    expect(resolve({})).toBeNull();
  });
});

describe('proposalAgentSetup', () => {
  it('sends the model only when it was an explicit pick, like New Workspace', () => {
    expect(
      proposalAgentSetup({
        selectedProvider: 'claude-code',
        selectedModel: 'claude-opus-4-5',
        modelWasOverridden: true,
        selectedReasoningEffort: 'high',
      }),
    ).toEqual({ provider: 'claude-code', model: 'claude-opus-4-5', reasoningEffort: 'high' });
    expect(
      proposalAgentSetup({
        selectedProvider: 'claude-code',
        selectedModel: 'claude-opus-4-5',
        modelWasOverridden: false,
      }),
    ).toEqual({ provider: 'claude-code' });
  });

  it('splits a legacy compound model id and keeps an explicitly cleared effort', () => {
    expect(
      proposalAgentSetup({
        selectedModel: 'codex:gpt-fixture',
        modelWasOverridden: true,
        selectedReasoningEffort: '',
      }),
    ).toEqual({ provider: 'codex', model: 'gpt-fixture', reasoningEffort: '' });
  });
});

describe('hasAgentSetupFields', () => {
  it('needs a provider or a non-empty effort', () => {
    expect(hasAgentSetupFields({ provider: 'claude-code' })).toBe(true);
    expect(hasAgentSetupFields({ reasoningEffort: 'low' })).toBe(true);
    expect(hasAgentSetupFields({})).toBe(false);
    expect(hasAgentSetupFields({ reasoningEffort: '' })).toBe(false);
  });
});
