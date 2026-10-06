import { describe, expect, it } from 'vitest';
import { shouldUseRawNoteEditor } from './note-edit-policy';
describe('full note edit mode', () => {
  it.each([
    ['a'.repeat(299_999), false],
    ['a'.repeat(300_000), false],
    ['a'.repeat(300_001), true],
    ['漢'.repeat(100_000), false],
    ['漢'.repeat(100_000) + 'a', true],
    ['😀'.repeat(75_000), false],
    ['😀'.repeat(75_000) + 'a', true],
  ])('uses UTF-8 bytes at the exact inclusive rich boundary', (source, raw) => {
    expect(shouldUseRawNoteEditor(source as string)).toBe(raw);
  });
  it('preserves an explicit raw preference for a small or empty note', () => {
    expect(shouldUseRawNoteEditor('', true)).toBe(true);
    expect(shouldUseRawNoteEditor('small', true)).toBe(true);
  });
});
