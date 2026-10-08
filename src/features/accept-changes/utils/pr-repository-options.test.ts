import { describe, expect, it } from 'vitest';
import { summaryContext } from '../components/repository-context-summary.preview-fixtures';
import { prRepositoryOptions } from './pr-repository-options';

describe('PR repository options', () => {
  it.each(['github', 'self-managed', 'no-remote'] as const)('hides the picker for %s', (scene) => {
    expect(prRepositoryOptions(summaryContext(scene).roots[0])).toEqual([]);
  });

  it.each(['github', 'self-managed'] as const)('hides same-provider forks for %s', (scene) => {
    const context = summaryContext(scene).roots[0];
    const fork = structuredClone(context.remotes[0]);
    fork.name = 'upstream';
    if (fork.fetch[0].resolution.state === 'resolved')
      fork.fetch[0].resolution.target.projectPath = 'another/project';
    context.remotes.push(fork);
    expect(prRepositoryOptions(context)).toEqual([]);
  });

  it('offers the exact remote names only when GitHub and GitLab are both present', () => {
    expect(
      prRepositoryOptions(summaryContext('mixed-providers').roots[0]).map(
        (option) => option.remoteName,
      ),
    ).toEqual(['origin', 'github']);
  });

  it('does not infer GitLab from an unresolved URL or a push-only endpoint', () => {
    const context = summaryContext('mixed-providers').roots[0];
    context.remotes[0].push = context.remotes[0].fetch;
    context.remotes[0].fetch = [
      {
        url: 'https://gitlab.com/team/repo.git',
        resolution: { state: 'unresolved', reason: 'unknown-instance' },
      },
    ];
    expect(prRepositoryOptions(context)).toEqual([]);
    context.remotes[0].fetch = [];
    expect(prRepositoryOptions(context)).toEqual([]);
  });

  it('does not offer a remote whose fetch endpoints disagree', () => {
    const context = summaryContext('mixed-providers').roots[0];
    context.remotes[0].fetch.push(context.remotes[1].fetch[0]);
    expect(prRepositoryOptions(context)).toEqual([]);
  });
});
