import { describe, expect, it } from 'vitest';
import {
  gitlabPersonalAccessTokenUrl,
  normalizeGitLabHost,
  normalizeGitLabInstanceUrl,
} from './gitlab-host';

describe('GitLab instance input', () => {
  it.each([
    ['gitlab.com', 'https://gitlab.com'],
    [' https://Git.Example.test:8443/Forge/ ', 'https://git.example.test:8443/Forge'],
    ['git.example.test:8443/Parent/Forge', 'https://git.example.test:8443/Parent/Forge'],
    ['HTTPS://Git.Example.test/', 'https://git.example.test'],
    ['https://git.example.test:443/Forge', 'https://git.example.test/Forge'],
    ['https://[::1]:8443/Forge', 'https://[::1]:8443/Forge'],
  ])('normalizes %s without discarding the instance prefix', (input, expected) => {
    expect(normalizeGitLabInstanceUrl(input)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    'http://git.example.test/Forge',
    'ssh://git.example.test/Forge',
    'https://person:token@git.example.test/Forge',
    'https://person@git.example.test',
    'https://git.example.test/Forge?token=secret',
    'https://git.example.test/Forge#fragment',
    'https://git.example.test/Forge?',
    'https://git.example.test/Forge#',
    'https://git.example.test/Forge/../Other',
    'https://git.example.test/Forge/./Other',
    'https://git.example.test/Forge/%2e%2e/Other',
    'https://git.example.test/Forge%2fOther',
    'https://git.example.test//Forge',
    'https://git.example.test/Forge//',
    'https://git.example.test\\Forge',
    'https://git.example.test/Fo rge',
    'https://git.example.test/For\nge',
    'https://git.example.test:99999/Forge',
    'https://%67it.example.test/Forge',
  ])('refuses ambiguous or unsafe instance input: %s', (input) => {
    expect(normalizeGitLabInstanceUrl(input)).toBeNull();
    expect(gitlabPersonalAccessTokenUrl(input)).toBeNull();
  });

  it('keeps distinct same-host prefixes and their path case separate', () => {
    const first = normalizeGitLabInstanceUrl('https://git.example.test/Forge');
    expect(first).not.toBe(normalizeGitLabInstanceUrl('https://git.example.test/forge'));
    expect(first).not.toBe(normalizeGitLabInstanceUrl('https://git.example.test/Other'));
    expect(normalizeGitLabHost(first!)).toBe('git.example.test');
  });

  it('builds the PAT settings link underneath the full instance', () => {
    expect(gitlabPersonalAccessTokenUrl('https://git.example.test:8443/Parent/Forge/')).toBe(
      'https://git.example.test:8443/Parent/Forge/-/user_settings/personal_access_tokens?scopes=api',
    );
    expect(gitlabPersonalAccessTokenUrl('gitlab.com')).toBe(
      'https://gitlab.com/-/user_settings/personal_access_tokens?scopes=api',
    );
  });
});
