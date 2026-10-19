import { describe, expect, it } from 'vitest';

import { agentSettingsRepoKey } from './agent-settings-repo-key';

describe('agentSettingsRepoKey', () => {
  it('keys every clone of one GitHub repo the same, whatever the clone path or URL form', () => {
    const keys = [
      { githubUrl: 'https://github.com/Acme/App', path: '/Users/me/Developer/app' },
      { githubUrl: 'https://github.com/acme/app.git', path: '/tmp/other-clone' },
      { githubUrl: 'git@github.com:acme/app.git', path: '' },
      { githubUrl: 'ssh://git@github.com/acme/app/', path: '' },
      { githubUrl: '', path: 'acme/app' },
    ].map((identity) => agentSettingsRepoKey({ type: 'github', ...identity }));
    expect(new Set(keys)).toEqual(new Set(['github:github.com/acme/app']));
  });

  it('keeps GitHub repos on different hosts or owners apart', () => {
    expect(
      agentSettingsRepoKey({ type: 'github', githubUrl: 'https://ghe.example.com/acme/app' }),
    ).toBe('github:ghe.example.com/acme/app');
    expect(agentSettingsRepoKey({ type: 'github', githubUrl: 'other/app' })).toBe(
      'github:github.com/other/app',
    );
  });

  it('does not treat a GitHub clone destination path as the repository identity', () => {
    expect(
      agentSettingsRepoKey({ type: 'github', githubUrl: '', path: '/Users/me/Developer/app' }),
    ).toBeNull();
  });

  it('keys local repositories and worktrees by their own exact path', () => {
    expect(agentSettingsRepoKey({ type: 'local', path: '/code/app/' })).toBe('local:/code/app');
    expect(agentSettingsRepoKey({ type: 'local', path: '/code/app' })).toBe('local:/code/app');
    expect(agentSettingsRepoKey({ type: 'local', path: '/code/app-worktree' })).toBe(
      'local:/code/app-worktree',
    );
    expect(agentSettingsRepoKey({ type: 'local', path: 'C:\\code\\App\\' })).toBe(
      'local:C:\\code\\App',
    );
    expect(agentSettingsRepoKey({ type: 'local', path: '/' })).toBe('local:/');
    expect(agentSettingsRepoKey({ type: 'local', path: '  ' })).toBeNull();
  });

  it('keys remote setups by host and remote path', () => {
    expect(
      agentSettingsRepoKey({
        type: 'remote',
        path: 'ignored-when-setup-has-path',
        remote: { host: 'Build.Example.com', workspacePath: '/srv/app/' },
      }),
    ).toBe('remote:build.example.com:/srv/app');
    expect(
      agentSettingsRepoKey({ type: 'remote', path: '/srv/app', remote: { host: 'box' } }),
    ).toBe('remote:box:/srv/app');
    expect(agentSettingsRepoKey({ type: 'remote', path: '/srv/app', remote: null })).toBeNull();
  });

  it('keys GitLab checkouts by instance and project', () => {
    expect(
      agentSettingsRepoKey({
        type: 'gitlab',
        gitlab: { instanceBaseUrl: 'https://GitLab.example.com/', projectPath: 'Group/Sub/App' },
      }),
    ).toBe('gitlab:https://gitlab.example.com/group/sub/app');
    expect(
      agentSettingsRepoKey({
        type: 'gitlab',
        gitlab: { instanceBaseUrl: 'https://gitlab.example.com' },
      }),
    ).toBeNull();
  });
});
