import { describe, expect, it } from 'vitest';
import {
  parseCommitMessage,
  shouldSkipCommit,
  groupCommitsByType,
  renderCommitEntry,
  renderSection,
  renderRepoNotes,
  renderIntentdSection,
} from './release-notes-lib.mjs';

describe('parseCommitMessage', () => {
  it('parses a standard conventional commit', () => {
    const result = parseCommitMessage('feat: add new feature (#123)');
    expect(result).toEqual({
      type: 'feat',
      scope: null,
      breaking: false,
      subject: 'add new feature',
      prNumber: 123,
    });
  });

  it('parses a commit with scope', () => {
    const result = parseCommitMessage('fix(ui): fix button color (#456)');
    expect(result).toEqual({
      type: 'fix',
      scope: 'ui',
      breaking: false,
      subject: 'fix button color',
      prNumber: 456,
    });
  });

  it('parses a breaking change commit', () => {
    const result = parseCommitMessage('feat!: breaking API change (#789)');
    expect(result).toEqual({
      type: 'feat',
      scope: null,
      breaking: true,
      subject: 'breaking API change',
      prNumber: 789,
    });
  });

  it('parses a commit without PR number', () => {
    const result = parseCommitMessage('docs: update README');
    expect(result).toEqual({
      type: 'docs',
      scope: null,
      breaking: false,
      subject: 'update README',
      prNumber: null,
    });
  });

  it('returns null for non-conventional commits', () => {
    expect(parseCommitMessage('just a commit message')).toBeNull();
    expect(parseCommitMessage('Merge pull request #123')).toBeNull();
  });
});

describe('shouldSkipCommit', () => {
  it('skips chore(release) commits', () => {
    const parsed = parseCommitMessage('chore(release): release v2.0.6 (#100)');
    expect(shouldSkipCommit(parsed)).toBe(true);
  });

  it('skips version bump commits', () => {
    expect(shouldSkipCommit(parseCommitMessage('chore: bump version to 2.0.6'))).toBe(true);
    expect(shouldSkipCommit(parseCommitMessage('feat: bump version to 2.0.6'))).toBe(true);
    expect(shouldSkipCommit(parseCommitMessage('chore: version 2.0.6'))).toBe(true);
  });

  it('skips release-plz style chore bump commits', () => {
    expect(shouldSkipCommit(parseCommitMessage('chore: release v0.2.4'))).toBe(true);
    expect(shouldSkipCommit(parseCommitMessage('chore: release 0.2.4'))).toBe(true);
    expect(shouldSkipCommit(parseCommitMessage('chore: release v0.2.4-beta.1'))).toBe(true);
  });

  it('does not skip non-chore commits mentioning release', () => {
    expect(shouldSkipCommit(parseCommitMessage('feat: release v0.2.4'))).toBe(false);
    expect(shouldSkipCommit(parseCommitMessage('fix: release notes formatting (#12)'))).toBe(false);
  });

  it('does not skip regular commits', () => {
    expect(shouldSkipCommit(parseCommitMessage('feat: add feature (#123)'))).toBe(false);
    expect(shouldSkipCommit(parseCommitMessage('fix: fix bug (#456)'))).toBe(false);
  });

  it('skips null commits', () => {
    expect(shouldSkipCommit(null)).toBe(true);
  });
});

describe('groupCommitsByType', () => {
  it('groups commits by type', () => {
    const commits = [
      parseCommitMessage('feat: feature 1 (#1)'),
      parseCommitMessage('fix: fix 1 (#2)'),
      parseCommitMessage('feat: feature 2 (#3)'),
      parseCommitMessage('docs: doc update (#4)'),
      parseCommitMessage('perf: performance improvement (#5)'),
      parseCommitMessage('ci: update CI (#6)'),
    ];

    const groups = groupCommitsByType(commits);

    expect(groups.feat).toHaveLength(2);
    expect(groups.fix).toHaveLength(1);
    expect(groups.docs).toHaveLength(1);
    expect(groups.perf).toHaveLength(1);
    expect(groups.other).toHaveLength(1); // ci goes to other
  });

  it('handles empty array', () => {
    const groups = groupCommitsByType([]);
    expect(groups.feat).toHaveLength(0);
    expect(groups.fix).toHaveLength(0);
  });
});

describe('renderCommitEntry', () => {
  it('renders a commit with PR number', () => {
    const commit = parseCommitMessage('feat: add feature (#123)');
    const result = renderCommitEntry(commit, 'intent-hq', 'cloudlands-fe');
    expect(result).toBe('- add feature ([#123](https://github.com/intent-hq/cloudlands-fe/pull/123))');
  });

  it('renders a commit without PR number', () => {
    const commit = parseCommitMessage('docs: update docs');
    const result = renderCommitEntry(commit, 'intent-hq', 'cloudlands-fe');
    expect(result).toBe('- update docs');
  });

  it('returns empty string for null commit', () => {
    expect(renderCommitEntry(null, 'intent-hq', 'cloudlands-fe')).toBe('');
  });
});

describe('renderSection', () => {
  it('renders a section with commits', () => {
    const commits = [
      parseCommitMessage('feat: feature 1 (#1)'),
      parseCommitMessage('feat: feature 2 (#2)'),
    ];

    const result = renderSection('Features', commits, 'intent-hq', 'cloudlands-fe');
    
    expect(result).toContain('### Features');
    expect(result).toContain('- feature 1 ([#1](https://github.com/intent-hq/cloudlands-fe/pull/1))');
    expect(result).toContain('- feature 2 ([#2](https://github.com/intent-hq/cloudlands-fe/pull/2))');
  });

  it('returns empty string for empty commits', () => {
    const result = renderSection('Features', [], 'intent-hq', 'cloudlands-fe');
    expect(result).toBe('');
  });
});

describe('renderRepoNotes', () => {
  it('renders full repo notes with multiple sections', () => {
    const commits = [
      parseCommitMessage('feat: feature 1 (#1)'),
      parseCommitMessage('fix: fix 1 (#2)'),
      parseCommitMessage('perf: perf improvement (#3)'),
    ];

    const result = renderRepoNotes('Desktop app (cloudlands-fe)', commits, 'intent-hq', 'cloudlands-fe');
    
    expect(result).toContain('## Desktop app (cloudlands-fe)');
    expect(result).toContain('### Features');
    expect(result).toContain('### Bug Fixes');
    expect(result).toContain('### Performance');
  });

  it('separates each section heading from the previous list with a blank line', () => {
    const commits = [
      parseCommitMessage('feat: feature 1 (#1)'),
      parseCommitMessage('fix: fix 1 (#2)'),
      parseCommitMessage('perf: perf improvement (#3)'),
    ];

    const result = renderRepoNotes('Desktop app (cloudlands-fe)', commits, 'intent-hq', 'cloudlands-fe');

    // Every `### Heading` must be preceded by a blank line
    expect(result).not.toMatch(/[^\n]\n### /);
    expect(result).toContain('\n\n### Bug Fixes');
    expect(result).toContain('\n\n### Performance');
  });

  it('renders "No changes." for empty commits', () => {
    const result = renderRepoNotes('Backend daemon (intentd)', [], 'intent-hq', 'intentd');
    expect(result).toContain('## Backend daemon (intentd)');
    expect(result).toContain('No changes.');
  });
});

describe('renderIntentdSection', () => {
  it('renders the pin line only when no base version is known', () => {
    const result = renderIntentdSection({ version: '0.9.0' });
    expect(result).toContain('## Backend daemon (intentd)');
    expect(result).toContain(
      'Bundles the pinned [intentd v0.9.0](https://github.com/intent-hq/intentd/releases/tag/v0.9.0) release.',
    );
    expect(result).not.toContain('previously');
  });

  it('renders an unchanged line when base equals version', () => {
    const result = renderIntentdSection({ version: '0.9.0', baseVersion: '0.9.0' });
    expect(result).toContain('## Backend daemon (intentd)');
    expect(result).toContain(
      'intentd unchanged ([v0.9.0](https://github.com/intent-hq/intentd/releases/tag/v0.9.0)).',
    );
    expect(result).not.toContain('Bundles');
  });

  it('renders the pin line, compare link, and grouped commits for a delta', () => {
    const commits = [
      parseCommitMessage('feat: add daemon feature (#10)'),
      parseCommitMessage('fix: fix daemon bug (#11)'),
    ];
    const result = renderIntentdSection({ version: '0.9.0', baseVersion: '0.8.0', commits });

    expect(result).toContain('## Backend daemon (intentd)');
    expect(result).toContain(
      'Bundles [intentd v0.9.0](https://github.com/intent-hq/intentd/releases/tag/v0.9.0) (previously v0.8.0)',
    );
    expect(result).toContain('https://github.com/intent-hq/intentd/compare/v0.8.0...v0.9.0');
    expect(result).toContain('### Features');
    expect(result).toContain('- add daemon feature ([#10](https://github.com/intent-hq/intentd/pull/10))');
    expect(result).toContain('### Bug Fixes');
    expect(result).toContain('- fix daemon bug ([#11](https://github.com/intent-hq/intentd/pull/11))');
  });

  it('renders "No changes." for a delta with no renderable commits', () => {
    const result = renderIntentdSection({ version: '0.9.0', baseVersion: '0.8.0', commits: [] });
    expect(result).toContain('(previously v0.8.0)');
    expect(result).toContain('https://github.com/intent-hq/intentd/compare/v0.8.0...v0.9.0');
    expect(result).toContain('No changes.');
  });

  it('renders the pin line + compare link only when commits are unknown (null)', () => {
    const result = renderIntentdSection({ version: '0.9.0', baseVersion: '0.8.0', commits: null });
    expect(result).toContain('(previously v0.8.0)');
    expect(result).toContain('https://github.com/intent-hq/intentd/compare/v0.8.0...v0.9.0');
    expect(result).not.toContain('No changes.');
    expect(result).not.toContain('###');
  });
});
