import { describe, expect, it } from 'vitest';

import { isAbsolutePathOutsideRoot } from './path-utils';

describe('isAbsolutePathOutsideRoot', () => {
  it('returns false for relative paths (they resolve against the root)', () => {
    expect(isAbsolutePathOutsideRoot('src/x.ts', '/repo')).toBe(false);
    expect(isAbsolutePathOutsideRoot('../x.ts', '/repo')).toBe(false);
    expect(isAbsolutePathOutsideRoot('~/notes/x.md', '/repo')).toBe(false);
  });

  it('returns false for empty path or root', () => {
    expect(isAbsolutePathOutsideRoot('', '/repo')).toBe(false);
    expect(isAbsolutePathOutsideRoot('/etc/passwd', '')).toBe(false);
  });

  it('detects Unix paths outside the root', () => {
    expect(isAbsolutePathOutsideRoot('/etc/passwd', '/repo')).toBe(true);
    expect(isAbsolutePathOutsideRoot('/repo/src/x.ts', '/repo')).toBe(false);
    expect(isAbsolutePathOutsideRoot('/repo', '/repo')).toBe(false);
  });

  it('does not treat root-name-prefix siblings as inside', () => {
    expect(isAbsolutePathOutsideRoot('/repository/x.ts', '/repo')).toBe(true);
    expect(isAbsolutePathOutsideRoot('C:/repository/x.ts', 'C:/repo')).toBe(true);
  });

  it('handles trailing-slash and filesystem roots', () => {
    expect(isAbsolutePathOutsideRoot('/repo/src/x.ts', '/repo/')).toBe(false);
    expect(isAbsolutePathOutsideRoot('/anything', '/')).toBe(false);
  });

  it('resolves .. segments before comparing', () => {
    expect(isAbsolutePathOutsideRoot('/repo/../etc/passwd', '/repo')).toBe(true);
    expect(isAbsolutePathOutsideRoot('/repo/../repo/x', '/repo')).toBe(false);
  });

  it('handles mixed Windows separators', () => {
    expect(isAbsolutePathOutsideRoot('C:\\repo\\src\\x.ts', 'C:/repo')).toBe(false);
    expect(isAbsolutePathOutsideRoot('C:/repo/src/x.ts', 'C:\\repo')).toBe(false);
  });

  it('compares Windows drive-letter paths case-insensitively', () => {
    expect(isAbsolutePathOutsideRoot('c:/REPO/src/x.ts', 'C:\\repo')).toBe(false);
    expect(isAbsolutePathOutsideRoot('C:/Repo/x.ts', 'c:/repo')).toBe(false);
    expect(isAbsolutePathOutsideRoot('D:/repo/x.ts', 'C:/repo')).toBe(true);
  });

  it('compares UNC paths case-insensitively in both separator forms', () => {
    expect(isAbsolutePathOutsideRoot('\\\\SERVER\\share\\x.ts', '\\\\server\\share')).toBe(false);
    expect(isAbsolutePathOutsideRoot('//server/SHARE/repo/x.ts', '//Server/Share/repo')).toBe(false);
    expect(isAbsolutePathOutsideRoot('\\\\other\\share\\x.ts', '\\\\server\\share')).toBe(true);
    expect(isAbsolutePathOutsideRoot('\\\\server\\other\\x.ts', '\\\\server\\share')).toBe(true);
  });

  it('keeps Unix path comparison case-sensitive (intended)', () => {
    expect(isAbsolutePathOutsideRoot('/Users/x/Repo/src/a.ts', '/Users/x/repo')).toBe(true);
  });
});
