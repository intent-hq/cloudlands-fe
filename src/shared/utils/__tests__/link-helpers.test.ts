import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  isAuthUrl,
  isCmdClickModifier,
  isGitHubUrl,
} from '../link-helpers';

describe('link-helpers', () => {
  it('detects auth URLs by pathname', () => {
    expect(isAuthUrl('https://example.com/oauth/authorize')).toBe(true);
    expect(isAuthUrl('https://example.com/login/oauth/callback')).toBe(true);
    expect(isAuthUrl('https://example.com/docs/authentication')).toBe(false);
  });

  it('detects github hosts and subdomains', () => {
    expect(isGitHubUrl('https://github.com/example-org/example-repo')).toBe(true);
    expect(isGitHubUrl('https://api.github.com/repos/example-org/example-repo')).toBe(true);
    expect(isGitHubUrl('https://gitlab.com/example-org/example-repo')).toBe(false);
  });

  it('uses metaKey on mac platforms', () => {
    expect(isCmdClickModifier({ modifiers: { metaKey: true } }, 'MacIntel')).toBe(true);
    expect(isCmdClickModifier({ modifiers: { ctrlKey: true } }, 'MacIntel')).toBe(false);
  });

  it('uses ctrlKey on non-mac platforms', () => {
    expect(isCmdClickModifier({ modifiers: { ctrlKey: true } }, 'Win32')).toBe(true);
    expect(isCmdClickModifier({ modifiers: { metaKey: true } }, 'Linux x86_64')).toBe(false);
  });
});