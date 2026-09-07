import { describe, expect, it } from 'vitest';
import {
  getNewFolderNameError,
  getSourceValidationError,
  isSourceValid,
} from './source-validation';

describe('new-workspace source validation', () => {
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

  it('rejects an unsafe restored new-folder source before launch', () => {
    const source = { kind: 'newFolder' as const, parentPath: '/projects', name: '../outside' };

    expect(getSourceValidationError(source)).toBe('path-separator');
    expect(isSourceValid(source)).toBe(false);
  });
});
