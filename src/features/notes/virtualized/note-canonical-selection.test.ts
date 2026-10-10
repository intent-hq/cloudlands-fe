import { expect, it } from 'vitest';
import { createCanonicalSelection } from './note-canonical-selection';
import type { NoteWindow } from './note-window-reader';
function window(text: string, from: number, start = 0, id = 't', parent = 'p'): NoteWindow {
  return {
    native: { texts: { ref: text }, references: { parent: [parent] } },
    context: [
      { kind: 'nativeNode', id: parent, nodeType: 'paragraph', parentRef: null },
      { kind: 'nativeNode', id, nodeType: 'text', parentRef: 'parent' },
      {
        kind: 'sourceMap',
        textNodeId: id,
        textRef: 'ref',
        mapping: 'identity',
        sourceRange: { start: from, end: from + text.length },
        renderedRange: { start, end: start + text.length },
      },
    ],
  } as unknown as NoteWindow;
}
it('omits Markdown delimiters and clips exact Unicode selections across pages', () => {
  const take = createCanonicalSelection({ start: 3, end: 9 });
  expect(take(window('漢字 hello', 2))).toBe('字 hell');
  expect(take(window('hello', 5, 3))).toBe('');
});
it('keeps adjacent formatted leaves together and separates text blocks', () => {
  const take = createCanonicalSelection({ start: 0, end: 100 });
  expect(take(window('bold', 2, 0, 'a'))).toBe('bold');
  expect(take(window(' plain', 8, 0, 'b'))).toBe(' plain');
  expect(take(window('next', 20, 0, 'c', 'p2'))).toBe('\nnext');
});
