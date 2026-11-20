import { describe, expect, it } from 'vitest';

import {
  extensionsFromAccept,
  extensionsFromFilters,
  fileMatchesExtensions,
  mimeTypeForFileName,
} from './in-app-file-dialog';

describe('extensionsFromFilters', () => {
  it('merges filter extensions, lowercased and without dots', () => {
    expect(
      extensionsFromFilters([
        { name: 'Zip', extensions: ['ZIP'] },
        { name: 'Text', extensions: ['.txt'] },
      ]),
    ).toEqual(['zip', 'txt']);
  });

  it('falls open for no filters or a * filter', () => {
    expect(extensionsFromFilters(undefined)).toBeUndefined();
    expect(extensionsFromFilters([{ extensions: ['zip', '*'] }])).toBeUndefined();
  });
});

describe('extensionsFromAccept', () => {
  it('reads dotted extensions and known MIME types', () => {
    expect(extensionsFromAccept('.md, application/pdf')).toEqual(['md', 'pdf']);
    expect(extensionsFromAccept('image/*')).toContain('png');
  });

  it('falls open for an empty or unknown accept', () => {
    expect(extensionsFromAccept('')).toBeUndefined();
    expect(extensionsFromAccept('.md,application/x-unknown')).toBeUndefined();
  });
});

describe('fileMatchesExtensions / mimeTypeForFileName', () => {
  it('matches case-insensitively and passes everything without a filter', () => {
    expect(fileMatchesExtensions('Photo.PNG', ['png'])).toBe(true);
    expect(fileMatchesExtensions('notes.txt', ['png'])).toBe(false);
    expect(fileMatchesExtensions('notes.txt', undefined)).toBe(true);
  });

  it('guesses common MIME types', () => {
    expect(mimeTypeForFileName('a.png')).toBe('image/png');
    expect(mimeTypeForFileName('README')).toBe('');
  });
});
