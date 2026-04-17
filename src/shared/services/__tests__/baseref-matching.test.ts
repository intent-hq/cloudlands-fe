import { describe, it, expect } from 'vitest';
import {
  matchesBaseRef,
  getBaseRefMatchCandidates,
} from '../baseref-matching';

describe('matchesBaseRef', () => {
  it('matches when baseRef has an allowlisted remote prefix', () => {
    expect(matchesBaseRef('feature-branch', 'origin/feature-branch')).toBe(true);
    expect(matchesBaseRef('feature-branch', 'upstream/feature-branch')).toBe(true);
    expect(matchesBaseRef('feature-branch', 'fork/feature-branch')).toBe(true);
  });

  it('matches multi-segment branches after an allowlisted remote', () => {
    expect(matchesBaseRef('feature/nested', 'origin/feature/nested')).toBe(true);
    expect(matchesBaseRef('release/1.0', 'upstream/release/1.0')).toBe(true);
  });

  it('matches plain branches with no prefix', () => {
    expect(matchesBaseRef('main', 'main')).toBe(true);
    expect(matchesBaseRef('develop', 'develop')).toBe(true);
  });

  it('does not over-strip local branches that share a slashed form', () => {
    // The bug the reviewer flagged: local baseRef "feature/foo" must NOT
    // falsely match a PR with sourceBranch "foo".
    expect(matchesBaseRef('foo', 'feature/foo')).toBe(false);
    expect(matchesBaseRef('bar', 'bugfix/bar')).toBe(false);
  });

  it('matches raw equality for slashed local branches', () => {
    expect(matchesBaseRef('feature/foo', 'feature/foo')).toBe(true);
  });

  it('returns false for empty or nullish inputs', () => {
    expect(matchesBaseRef('foo', undefined)).toBe(false);
    expect(matchesBaseRef('foo', null)).toBe(false);
    expect(matchesBaseRef('foo', '')).toBe(false);
    expect(matchesBaseRef('', 'origin/foo')).toBe(false);
    expect(matchesBaseRef(undefined, 'origin/foo')).toBe(false);
    expect(matchesBaseRef(null, 'origin/foo')).toBe(false);
    expect(matchesBaseRef(undefined, undefined)).toBe(false);
  });

  it('does not treat unknown remote-like prefixes as remotes', () => {
    // "remote" and "gh" are not in the allowlist, so no stripping.
    expect(matchesBaseRef('foo', 'remote/foo')).toBe(false);
    expect(matchesBaseRef('foo', 'gh/foo')).toBe(false);
  });

  it('does not match when the allowlisted prefix has no branch after it', () => {
    expect(matchesBaseRef('', 'origin/')).toBe(false);
  });
});

describe('getBaseRefMatchCandidates', () => {
  it('returns both the raw ref and the stripped branch for allowlisted remotes', () => {
    const result = getBaseRefMatchCandidates('origin/foo');
    expect(result).toContain('origin/foo');
    expect(result).toContain('foo');
    expect(result).toHaveLength(2);
  });

  it('strips only known remotes', () => {
    expect(getBaseRefMatchCandidates('upstream/release/1.0')).toEqual([
      'upstream/release/1.0',
      'release/1.0',
    ]);
    expect(getBaseRefMatchCandidates('fork/bar')).toEqual(['fork/bar', 'bar']);
  });

  it('does not strip slashed local branches', () => {
    expect(getBaseRefMatchCandidates('feature/foo')).toEqual(['feature/foo']);
    expect(getBaseRefMatchCandidates('bugfix/baz')).toEqual(['bugfix/baz']);
  });

  it('returns a single entry for plain branches', () => {
    expect(getBaseRefMatchCandidates('main')).toEqual(['main']);
  });

  it('returns an empty array for empty or nullish inputs', () => {
    expect(getBaseRefMatchCandidates(undefined)).toEqual([]);
    expect(getBaseRefMatchCandidates(null)).toEqual([]);
    expect(getBaseRefMatchCandidates('')).toEqual([]);
  });
});
