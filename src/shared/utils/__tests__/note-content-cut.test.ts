/**
 * The app's copy of the daemon's truncated-read cut rule (§5.2 "Truncated note
 * reads"), checked against the contract's vectors
 * (docs/protocol/fixtures/notes/truncated-read.json in the monorepo).
 */
import { describe, expect, it } from 'vitest';
import { cutNoteContentForView } from '../note-content';

const VECTORS: Array<[id: string, content: string, limit: number, expected: string | null]> = [
  ['empty', '', 1, null],
  ['fits-exactly', 'a\nb\n', 4, null],
  ['limit-on-line-feed', 'ab\ncd\nef', 6, 'ab\ncd\n'],
  ['back-to-previous-line-feed', 'ab\ncd\nef', 5, 'ab\n'],
  ['early-line-feed-wins-over-char-boundary', 'a\nbcdefghij', 8, 'a\n'],
  ['crlf-never-split', 'a\r\nb\r\nc', 5, 'a\r\n'],
  ['crlf-whole-lines', 'a\r\nb\r\nc', 6, 'a\r\nb\r\n'],
  ['no-line-feed-ascii', 'abcdef\n', 4, 'abcd'],
  ['no-line-feed-multibyte', 'é😀x', 4, 'é'],
  ['first-char-longer-than-limit', '😀', 2, ''],
  ['multibyte-lines', '中文\n😀😀\n', 12, '中文\n'],
  ['fallback-never-splits-crlf', 'abc\r\nd', 4, 'abc'],
  ['fallback-never-splits-crlf-multibyte', 'é\r\nx', 3, 'é'],
];

describe('cutNoteContentForView', () => {
  it.each(VECTORS)('%s', (_id, content, limit, expected) => {
    const cut = cutNoteContentForView(content, limit);
    if (expected === null) {
      expect(cut).toBeNull();
      return;
    }
    expect(cut).toEqual({
      content: expected,
      contentBytes: new TextEncoder().encode(content).length,
    });
  });
});
