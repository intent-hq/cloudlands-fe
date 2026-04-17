import { describe, expect, it } from 'vitest';

import {
  generateFindingLink,
  generateFixAllLink,
  type Finding,
} from '../generate-remediation-link';

const baseFinding: Finding = {
  file: 'src/api/users.ts',
  line: 42,
  message: 'SQL injection vulnerability. Use parameterized queries.',
};

describe('generateFindingLink', () => {
  it('generates a valid intent://create URL for a single finding', () => {
    const url = generateFindingLink({
      repo: '/path/to/repo',
      branch: 'feature-x',
      finding: baseFinding,
    });

    expect(url).toMatch(/^intent:\/\/create\?/);
    const params = new URLSearchParams(url.replace('intent://create?', ''));
    expect(params.get('repo')).toBe('/path/to/repo');
    expect(params.get('branch')).toBe('feature-x');
    expect(params.get('newWindow')).toBe('true');
    expect(params.get('autoCreate')).toBe('true');
    expect(params.get('prompt')).toContain('src/api/users.ts:42');
    expect(params.get('prompt')).toContain('SQL injection');
  });

  it('uses githubUrl when provided instead of repo', () => {
    const url = generateFindingLink({
      githubUrl: 'https://github.com/org/repo',
      branch: 'main',
      finding: baseFinding,
    });

    const params = new URLSearchParams(url.replace('intent://create?', ''));
    expect(params.get('githubUrl')).toBe('https://github.com/org/repo');
    expect(params.has('repo')).toBe(false);
  });

  it('prefers githubUrl over repo when both are provided', () => {
    const url = generateFindingLink({
      repo: '/local/path',
      githubUrl: 'https://github.com/org/repo',
      branch: 'main',
      finding: baseFinding,
    });

    const params = new URLSearchParams(url.replace('intent://create?', ''));
    expect(params.get('githubUrl')).toBe('https://github.com/org/repo');
    expect(params.has('repo')).toBe(false);
  });

  it('throws when neither repo nor githubUrl is provided', () => {
    expect(() =>
      generateFindingLink({ branch: 'main', finding: baseFinding }),
    ).toThrow('Either "repo" or "githubUrl" must be provided');
  });

  it('includes specialist when provided', () => {
    const url = generateFindingLink({
      repo: '/repo',
      branch: 'main',
      finding: baseFinding,
      specialist: 'pr-shepherd',
    });

    const params = new URLSearchParams(url.replace('intent://create?', ''));
    expect(params.get('specialist')).toBe('pr-shepherd');
  });

  it('includes suggestion in prompt when present', () => {
    const url = generateFindingLink({
      repo: '/repo',
      branch: 'main',
      finding: { ...baseFinding, suggestion: 'Use db.query($1, [value])' },
    });

    const params = new URLSearchParams(url.replace('intent://create?', ''));
    expect(params.get('prompt')).toContain('Use db.query($1, [value])');
  });

  it('includes severity in prompt when present', () => {
    const url = generateFindingLink({
      repo: '/repo',
      branch: 'main',
      finding: { ...baseFinding, severity: 'critical' },
    });

    const params = new URLSearchParams(url.replace('intent://create?', ''));
    expect(params.get('prompt')).toContain('[critical]');
  });
});

describe('generateFixAllLink', () => {
  const findings: Finding[] = [
    baseFinding,
    { file: 'src/utils/auth.ts', line: 15, message: 'Missing input validation on email field.' },
  ];

  it('generates a valid URL with multiple findings', () => {
    const url = generateFixAllLink({
      repo: '/repo',
      branch: 'feature-x',
      findings,
    });

    const params = new URLSearchParams(url.replace('intent://create?', ''));
    const prompt = params.get('prompt')!;
    expect(prompt).toContain('1. **src/api/users.ts:42**');
    expect(prompt).toContain('2. **src/utils/auth.ts:15**');
    expect(params.get('newWindow')).toBe('true');
  });

  it('includes PR metadata in prompt', () => {
    const url = generateFixAllLink({
      repo: '/repo',
      branch: 'feature-x',
      findings,
      pr: { number: 123, url: 'https://github.com/org/repo/pull/123', title: 'Add auth' },
    });

    const params = new URLSearchParams(url.replace('intent://create?', ''));
    const prompt = params.get('prompt')!;
    expect(prompt).toContain('PR #123');
    expect(prompt).toContain('"Add auth"');
    expect(prompt).toContain('https://github.com/org/repo/pull/123');
  });

  it('throws when findings array is empty', () => {
    expect(() =>
      generateFixAllLink({ repo: '/repo', branch: 'main', findings: [] }),
    ).toThrow('At least one finding is required');
  });

  it('round-trip: params survive URL encoding/decoding', () => {
    const finding: Finding = {
      file: 'src/special chars & stuff.ts',
      line: 1,
      message: 'Has "quotes" and <brackets> & ampersands',
      suggestion: 'Fix the `code` here',
    };

    const url = generateFixAllLink({
      githubUrl: 'https://github.com/org/repo',
      branch: 'fix/special-chars',
      findings: [finding],
    });

    // Parse back — URLSearchParams handles decoding
    const params = new URLSearchParams(url.replace('intent://create?', ''));
    expect(params.get('githubUrl')).toBe('https://github.com/org/repo');
    expect(params.get('branch')).toBe('fix/special-chars');
    const prompt = params.get('prompt')!;
    expect(prompt).toContain('special chars & stuff.ts');
    expect(prompt).toContain('"quotes"');
    expect(prompt).toContain('<brackets>');
    expect(prompt).toContain('`code`');
  });
});
