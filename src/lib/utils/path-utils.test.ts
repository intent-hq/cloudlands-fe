import { describe, expect, it } from 'vitest';

import { isAbsolutePathOutsideRoot, isTildePath } from './path-utils';

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

describe('isTildePath', () => {
  it('detects home-relative tilde paths', () => {
    expect(isTildePath('~')).toBe(true);
    expect(isTildePath('~/')).toBe(true);
    expect(isTildePath('~/.claude/projects/x.jsonl')).toBe(true);
    expect(isTildePath('~\\notes\\x.md')).toBe(true);
  });

  it('detects user-specific home forms only with a trailing separator', () => {
    expect(isTildePath('~user/notes.md')).toBe(true);
    expect(isTildePath('~user\\notes.md')).toBe(true);
    expect(isTildePath('~user/')).toBe(true);
  });

  it('treats a bare tilde-prefixed name as an ordinary filename', () => {
    // Office lock files and editor backups live in the workspace and must load.
    expect(isTildePath('~$report.docx')).toBe(false);
    expect(isTildePath('~backup.ts')).toBe(false);
    expect(isTildePath('~user')).toBe(false);
  });

  it('returns false for paths that merely contain a tilde', () => {
    expect(isTildePath('a~b')).toBe(false);
    expect(isTildePath('./~')).toBe(false);
    expect(isTildePath('./~/x.md')).toBe(false);
    expect(isTildePath('src/~backup.ts')).toBe(false);
    expect(isTildePath('/home/dev/~x')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(isTildePath('')).toBe(false);
  });
});
