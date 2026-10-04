import { expect, it } from 'vitest';
import type { NoteWindow } from './note-window-reader';
import { projectNoteWindow } from './note-window-projection';
// Projection-only fixture: no producer, transport, native browser or heap claim.
function atomWindow(text: string): NoteWindow {
  const range = { start: 2_000_000, end: 2_000_000 + text.length };
  const common = {
    kind: 'nativeNode' as const,
    profile: 'canonicalNote' as const,
    profileVersion: 1 as const,
    sourceRange: range,
    provenance: 'explicit' as const,
    attributesRef: 'attrs',
  };
  return {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    sourceRevision: 'r',
    snapshotId: 's',
    sourceLength: range.end,
    range,
    text,
    context: [
      {
        ...common,
        id: 'doc',
        nodeType: 'doc',
        nodeClass: 'container',
        parentRef: null,
        childIndex: 0,
      },
      {
        ...common,
        id: 'paragraph',
        nodeType: 'paragraph',
        nodeClass: 'container',
        parentRef: 'doc',
        childIndex: 3,
      },
      {
        ...common,
        id: 'break',
        nodeType: 'hardBreak',
        nodeClass: 'atom',
        parentRef: 'paragraph',
        childIndex: 5,
      },
    ],
    details: {},
    mapBindings: [],
    documentEnd: true,
    native: {
      references: { doc: ['doc'], paragraph: ['paragraph'] },
      attributes: { attrs: {} },
      texts: {},
    },
    cost: { requests: 0, wireBytes: 0, sourceBytes: 0, contextBytes: 0, assemblyPeakBytes: 0 },
  };
}
it.each(['\n', '\r\n'])(
  'projects an explicit native newline atom without a fabricated text map %j',
  (text) => {
    const w = atomWindow(text);
    const p = projectNoteWindow(w);
    expect(p.content.content?.[0].content).toEqual([{ type: 'hardBreak', attrs: {} }]);
    expect(p.sourceAt(1)).toBe(w.range.start);
    expect(p.sourceAt(2)).toBe(w.range.end);
    expect(p.pmAt(w.range.start)).toBe(1);
    expect(p.pmAt(w.range.end)).toBe(2);
    if (text.length === 2) {
      expect(p.pmAt(w.range.start + 1, -1)).toBe(1);
      expect(p.pmAt(w.range.start + 1, 1)).toBe(2);
    }
  },
);
it('does not use a container envelope as source coverage', () => {
  const w = atomWindow('unmapped');
  w.context = w.context.filter((n) => n.id !== 'break');
  expect(() => projectNoteWindow(w)).toThrow(/coverage/);
});
it('rejects a newline atom with mismatched raw source', () => {
  expect(() => projectNoteWindow(atomWindow('xx'))).toThrow(/coverage|newline/);
});
