import { describe, expect, it } from 'vitest';

import {
  isAuthUrl,
  isCmdClickModifier,
  isGitHubUrl,
  parseFilePathLineSuffix,
  parseGitHubIssueOrPrUrl,
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

  describe('parseFilePathLineSuffix', () => {
    it.each([
      ['docs/chl-spec.md:2471', { path: 'docs/chl-spec.md', line: 2471 }],
      ['src/a.ts:10:5', { path: 'src/a.ts', line: 10, column: 5 }],
      ['src/a.ts#L10', { path: 'src/a.ts', line: 10 }],
      ['src/a.ts#L10-20', { path: 'src/a.ts', line: 10 }],
      ['src/a.ts#L10C5', { path: 'src/a.ts', line: 10, column: 5 }],
      ['C:/repo/src/a.ts:10', { path: 'C:/repo/src/a.ts', line: 10 }],
    ])('parses %s', (path, expected) => {
      expect(parseFilePathLineSuffix(path)).toEqual(expected);
    });

    it.each(['foo:1', ':1', '#L10', 'C:/repo/src/a.ts', 'src/a.ts:line', 'src/a.ts:10:5:2'])(
      'leaves ambiguous or invalid path unchanged: %s',
      (path) => {
        expect(parseFilePathLineSuffix(path)).toEqual({ path });
      },
    );
  });

  describe('parseGitHubIssueOrPrUrl', () => {
    it('parses issue URLs', () => {
      expect(parseGitHubIssueOrPrUrl('https://github.com/acme/widgets/issues/42')).toEqual({
        owner: 'acme',
        repo: 'widgets',
        number: 42,
        kind: 'issue',
      });
    });

    it('parses pull request URLs', () => {
      expect(parseGitHubIssueOrPrUrl('https://github.com/acme/widgets/pull/7')).toEqual({
        owner: 'acme',
        repo: 'widgets',
        number: 7,
        kind: 'pr',
      });
    });

    it('accepts www.github.com and tolerates extra segments, query, and hash', () => {
      expect(parseGitHubIssueOrPrUrl('https://www.github.com/acme/widgets/pull/7/files')).toEqual({
        owner: 'acme',
        repo: 'widgets',
        number: 7,
        kind: 'pr',
      });
      expect(
        parseGitHubIssueOrPrUrl('https://github.com/acme/widgets/issues/42?foo=bar#comment-1'),
      ).toMatchObject({ number: 42, kind: 'issue' });
    });

    it('returns null for non-issue/PR GitHub URLs', () => {
      expect(parseGitHubIssueOrPrUrl('https://github.com/acme/widgets')).toBeNull();
      expect(parseGitHubIssueOrPrUrl('https://github.com/acme/widgets/issues')).toBeNull();
      expect(parseGitHubIssueOrPrUrl('https://github.com/acme/widgets/pulls')).toBeNull();
      expect(parseGitHubIssueOrPrUrl('https://github.com/acme/widgets/issues/abc')).toBeNull();
      expect(parseGitHubIssueOrPrUrl('https://github.com/acme/widgets/commit/abc123')).toBeNull();
    });

    it('returns null for non-GitHub hosts and invalid URLs', () => {
      expect(parseGitHubIssueOrPrUrl('https://gitlab.com/acme/widgets/issues/42')).toBeNull();
      expect(
        parseGitHubIssueOrPrUrl('https://api.github.com/repos/acme/widgets/issues/42'),
      ).toBeNull();
      expect(parseGitHubIssueOrPrUrl('not a url')).toBeNull();
    });
  });
});
