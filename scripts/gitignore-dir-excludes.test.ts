import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitignoreDirExcludes, gitignoreDirExcludesFromText } from './gitignore-dir-excludes.mjs';

describe('gitignoreDirExcludesFromText', () => {
  it('ignores blank lines and trims surrounding whitespace', () => {
    expect(gitignoreDirExcludesFromText('\n   \n  .dev/  \n\t.wt-*/\t\n\n')).toEqual([
      '**/.dev/**',
      '**/.wt-*/**',
    ]);
  });

  it('skips comment lines', () => {
    expect(gitignoreDirExcludesFromText('# scratch/\n  # .dev/\n.dev/\n')).toEqual(['**/.dev/**']);
  });

  it('skips negated entries', () => {
    expect(gitignoreDirExcludesFromText('!keep/\n!/build/keep/\n.dev/\n')).toEqual(['**/.dev/**']);
  });

  it('skips file entries without a trailing slash', () => {
    expect(
      gitignoreDirExcludesFromText('*.log\n.env\n/dist\nsrc/generated\nnode_modules/\n'),
    ).toEqual(['**/node_modules/**']);
  });

  it('handles CRLF line endings', () => {
    expect(gitignoreDirExcludesFromText('# comment\r\n.dev/\r\nbuild/ios/\r\n*.log\r\n')).toEqual([
      '**/.dev/**',
      'build/ios/**',
    ]);
  });

  it('maps unanchored directory entries to **/<pattern>/** globs', () => {
    expect(gitignoreDirExcludesFromText('.dev/\n.wt-*/\n')).toEqual(['**/.dev/**', '**/.wt-*/**']);
  });

  it('maps anchored directory entries to <pattern>/** globs', () => {
    expect(gitignoreDirExcludesFromText('build/ios/\n')).toEqual(['build/ios/**']);
  });

  it('strips the leading slash from root-anchored entries', () => {
    expect(gitignoreDirExcludesFromText('/foo/\n/build/ios/\n')).toEqual([
      'foo/**',
      'build/ios/**',
    ]);
  });

  it('returns an empty list when nothing qualifies', () => {
    expect(gitignoreDirExcludesFromText('')).toEqual([]);
    expect(gitignoreDirExcludesFromText('# only comments\n*.log\n!keep/\n')).toEqual([]);
  });
});

describe('gitignoreDirExcludes', () => {
  it('derives the scratch excludes from the repo .gitignore', () => {
    const excludes = gitignoreDirExcludes(path.join(process.cwd(), '.gitignore'));
    expect(excludes).toContain('**/.dev/**');
    expect(excludes).toContain('**/.wt-*/**');
  });
});
