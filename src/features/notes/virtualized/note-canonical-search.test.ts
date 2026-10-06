import { expect, it } from 'vitest';
import { createCanonicalNoteMatcher } from './note-canonical-search';
import type { NoteWindow } from './note-window-reader';
function part(
  text: string,
  start: number,
  renderedStart = 0,
  node = 'n',
  mapping = 'identity',
): NoteWindow {
  return {
    native: { texts: { t: text } },
    context: [
      {
        kind: 'sourceMap',
        mapping,
        textNodeId: node,
        textRef: 't',
        sourceRange: { start, end: start + text.length },
        renderedRange: { start: renderedStart, end: renderedStart + text.length },
      },
    ],
  } as unknown as NoteWindow;
}
it('matches case-insensitively and overlaps', () => {
  expect(createCanonicalNoteMatcher('ana')(part('BANANA', 2))).toMatchObject([
    { sourceRange: { start: 3, end: 6 } },
    { sourceRange: { start: 5, end: 8 } },
  ]);
});
it('finds a match split across pinned page cuts without reporting overlap twice', () => {
  const match = createCanonicalNoteMatcher('hello');
  expect(match(part('hel', 2))).toEqual([]);
  expect(match(part('llo world', 4, 2))).toMatchObject([{ sourceRange: { start: 2, end: 7 } }]);
  expect(match(part('world', 8, 6))).toEqual([]);
});
it('does not join separate canonical text nodes', () => {
  const match = createCanonicalNoteMatcher('hello');
  match(part('hel', 0));
  expect(match(part('lo', 3, 0, 'other'))).toEqual([]);
});
it('searches rendered text and uses normalized source maps, excluding markup and dynamic labels', () => {
  const w = part('&', 5, 0, 'entity', 'entity');
  w.context[0].sourceRange.end = 10;
  expect(createCanonicalNoteMatcher('&')(w)).toMatchObject([
    { sourceRange: { start: 5, end: 10 } },
  ]);
  expect(createCanonicalNoteMatcher('amp')(w)).toEqual([]);
  expect(createCanonicalNoteMatcher('Live task status')(w)).toEqual([]);
});
