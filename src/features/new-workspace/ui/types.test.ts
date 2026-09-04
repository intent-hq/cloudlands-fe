import { describe, expect, it } from 'vitest';
import { getNewFolderNameError } from './types';

describe('getNewFolderNameError', () => {
  it.each([
    ['', 'required'],
    ['   ', 'required'],
    ['nested/project', 'path-separator'],
    ['nested\\project', 'path-separator'],
    ['..', 'dot-name'],
    ['...', 'dot-name'],
    ['bad\0name', 'null-character'],
    ['bad:name', 'invalid-character'],
    ['a'.repeat(256), 'too-long'],
  ] as const)('rejects unsafe name %j', (name, error) => {
    expect(getNewFolderNameError(name)).toBe(error);
  });

  it('accepts and trims a single safe directory component', () => {
    expect(getNewFolderNameError(' fresh-project ')).toBeUndefined();
  });
});
