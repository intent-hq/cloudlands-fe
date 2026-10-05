/** @vitest-environment jsdom */
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { expect, it, vi } from 'vitest';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { serializeSelectionToMarkdown } from '$lib/utils/selected-note-markdown-copy';
import { SourceProjection } from '../projection/source-projection';
import { isNoteMarkerCapture } from './note-marker-capture';
import {
  captureNoteMarkerSelection,
  isNoteMarkerSelectionCapture,
} from './note-marker-selection-capture';

const literal = '<!--anchor:legacy-id:point-->';
async function fixture(left = 'ab', right = 'cd', marker = literal) {
  const source = left + marker + right;
  const config = createEditorConfig({
    element: document.createElement('div'),
    content: '',
    editable: false,
    useMarkdown: true,
    workspace: { id: 'w' },
    enableNotePrimitives: true,
    enableMentions: true,
    enableComments: false,
    onUpdate: () => {},
  });
  const editor = new Editor({
    ...config,
    extensions: [...(config.extensions ?? []), CommentAnchor],
    content: await processMarkdownToHTML(source, { workspaceId: 'w', preserveAnchors: true }),
  });
  const projection = new SourceProjection(source, 65538);
  const identity = {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    sourceRevision: 'r',
    snapshotId: 's',
    documentGeneration: 0,
    liveGeneration: 1,
    selectionGeneration: 2,
    expiresAt: '2099-01-01T00:00:00Z',
  };
  function select(anchor: number, head: number) {
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)),
    );
    return {
      projection,
      identity,
      selection: {
        anchor: projection.sourceAt(anchor, 1),
        head: projection.sourceAt(head, -1),
        anchorAffinity: 1 as const,
        headAffinity: -1 as const,
      },
      // Controlled original owner; no actual Store proof or DATA grant claimed.
      current: () => true,
    };
  }
  return { editor, projection, identity, select };
}

it.each([
  { anchor: 1, head: 6, markdown: 'abcd' },
  { anchor: 6, head: 1, markdown: 'abcd' },
  { anchor: 1, head: 3, markdown: 'ab' },
  { anchor: 1, head: 4, markdown: 'ab' },
  { anchor: 3, head: 6, markdown: 'cd' },
  { anchor: 4, head: 6, markdown: 'cd' },
  { anchor: 3, head: 4, markdown: null },
  { anchor: 4, head: 3, markdown: null },
  { anchor: 3, head: 3, markdown: null },
  { anchor: 4, head: 4, markdown: null },
])('captures actual selection $anchor -> $head with independent copy parity', async (example) => {
  const f = await fixture();
  try {
    const input = f.select(example.anchor, example.head);
    const result = captureNoteMarkerSelection(f.editor.view, input);
    expect(result.markdown).toBe(example.markdown);
    expect(result.markdown).toBe(serializeSelectionToMarkdown(f.editor.view, 'w'));
    expect(result.selection).toEqual(input.selection);
    expect(result.direction).toBe(example.anchor > example.head ? 'backward' : 'forward');
    expect(result.left.sourceRange).toEqual({ start: 65538, end: 65540 });
    expect(result.left.nativeRange).toEqual({ from: 1, to: 3 });
    expect(result.right.sourceRange).toEqual({
      start: 65540 + literal.length,
      end: 65542 + literal.length,
    });
    expect(result.right.nativeRange).toEqual({ from: 4, to: 6 });
    expect(result.marker.nativeRange).toEqual({ from: 3, to: 4 });
    expect(result.marker.canonicalId).toBe('legacy-id');
    expect(result.marker.literal).toBe(literal);
    expect(result.marker.provenance).toBe('native-correspondence-only');
    expect(isNoteMarkerCapture(result.marker)).toBe(true);
    expect(isNoteMarkerSelectionCapture(result)).toBe(true);
    expect(isNoteMarkerSelectionCapture({ ...result })).toBe(false);
    for (const value of [
      result,
      result.left,
      result.right,
      result.selection,
      result.marker.attributes,
    ])
      expect(Object.isFrozen(value)).toBe(true);
  } finally {
    f.editor.destroy();
  }
});

it.each(
  [
    { left: 'A ', right: ' B', from: 1, to: 6, expected: 'A  B' },
    { left: 'ab ', right: ' cd', from: 2, to: 7, expected: 'b  c' },
    { left: 'ab ', right: 'cd', from: 2, to: 6, expected: 'b c' },
    { left: 'ab', right: ' cd', from: 2, to: 6, expected: 'b c' },
    { left: 'ab ', right: ' cd', from: 3, to: 7, expected: 'c' },
    { left: 'ab ', right: ' cd', from: 2, to: 6, expected: 'b' },
    { left: 'a ', right: ' b', from: 2, to: 5, expected: null },
  ].flatMap((example) => [false, true].map((backward) => ({ ...example, backward }))),
)('preserves actual whitespace $expected backward=$backward', async (example) => {
  const f = await fixture(example.left, example.right);
  try {
    const input = f.select(
      example.backward ? example.to : example.from,
      example.backward ? example.from : example.to,
    );
    expect(captureNoteMarkerSelection(f.editor.view, input).markdown).toBe(example.expected);
  } finally {
    f.editor.destroy();
  }
});

it.each([
  ['Unicode', '😀a', 'b', literal],
  ['punctuation', 'a!', 'b', literal],
  ['missing left', '', 'b', literal],
  ['missing right', 'a', '', literal],
  ['start marker', 'a', 'b', literal.replace(':point', ':start')],
  ['two markers', 'a', literal + 'b', literal],
  ['marked', '**a', 'b**', literal],
])('refuses unsupported %s shape', async (_name, left, right, raw) => {
  const f = await fixture(left, right, raw);
  try {
    const input = f.select(1, f.editor.state.doc.content.size - 1);
    expect(() => captureNoteMarkerSelection(f.editor.view, input)).toThrow();
  } finally {
    f.editor.destroy();
  }
});

it.each(['projection', 'mapping', 'token', 'attrs', 'identity', 'selection', 'state'])(
  'refuses serializer callback changing %s',
  async (kind) => {
    const f = await fixture();
    const input = f.select(1, 6);
    const spec = f.editor.state.schema.nodes.paragraph.spec,
      original = spec.toDOM;
    try {
      Reflect.deleteProperty(f.editor.state.schema.cached, 'domSerializer');
      spec.toDOM = () => {
        if (kind === 'projection')
          input.projection = new SourceProjection(f.projection.source, 65538);
        if (kind === 'mapping') vi.spyOn(f.projection, 'pmAt').mockReturnValue(1);
        if (kind === 'token') f.projection.tokens.find((t) => t.pm === 3)!.raw = 'bad';
        if (kind === 'attrs') Reflect.set(f.editor.state.doc.firstChild!.attrs, 'extra', 'bad');
        if (kind === 'identity') input.identity = { ...input.identity, snapshotId: 'other' };
        if (kind === 'selection') input.selection = { ...input.selection, head: 65538 };
        if (kind === 'state')
          f.editor.view.dispatch(f.editor.state.tr.setSelection(f.editor.state.selection));
        return ['p', 0];
      };
      expect(() => captureNoteMarkerSelection(f.editor.view, input)).toThrow();
    } finally {
      spec.toDOM = original;
      Reflect.deleteProperty(f.editor.state.schema.cached, 'domSerializer');
      f.editor.destroy();
    }
  },
);

it.each(['forward', 'reverse', 'selection', 'owner'])(
  'refuses final owner callback changing %s',
  async (kind) => {
    const f = await fixture();
    let calls = 0;
    const input = {
      ...f.select(1, 6),
      current: () => {
        if (++calls === 5) {
          if (kind === 'forward') f.projection.positions.set(1, 0);
          if (kind === 'reverse') f.projection.ends.set(6, 0);
          if (kind === 'selection') input.selection = { ...input.selection, anchor: 0 };
          if (kind === 'owner') return false;
        }
        return true;
      },
    };
    try {
      expect(() => captureNoteMarkerSelection(f.editor.view, input)).toThrow();
    } finally {
      f.editor.destroy();
    }
  },
);

it('rejects source selection inside marker literal even when nearest pmAt returns a boundary', async () => {
  const f = await fixture();
  try {
    const input = f.select(3, 4);
    input.selection.anchor++;
    expect(() => captureNoteMarkerSelection(f.editor.view, input)).toThrow();
  } finally {
    f.editor.destroy();
  }
});

it('uses actual serializer output and refuses a configured nonempty anchor serialization', async () => {
  const f = await fixture();
  const spec = f.editor.state.schema.nodes.commentAnchor.spec,
    original = spec.toDOM;
  try {
    Reflect.deleteProperty(f.editor.state.schema.cached, 'domSerializer');
    spec.toDOM = () => ['span', 'visible'];
    expect(() => captureNoteMarkerSelection(f.editor.view, f.select(1, 6))).toThrow();
  } finally {
    spec.toDOM = original;
    Reflect.deleteProperty(f.editor.state.schema.cached, 'domSerializer');
    f.editor.destroy();
  }
});

it('rejects expired original identity before invoking the serializer', async () => {
  const f = await fixture();
  let calls = 0;
  const spec = f.editor.state.schema.nodes.paragraph.spec,
    original = spec.toDOM;
  try {
    Reflect.deleteProperty(f.editor.state.schema.cached, 'domSerializer');
    spec.toDOM = () => {
      calls++;
      return ['p', 0];
    };
    expect(() =>
      captureNoteMarkerSelection(f.editor.view, {
        ...f.select(1, 6),
        now: () => Date.parse(f.identity.expiresAt),
      }),
    ).toThrow();
    expect(calls).toBe(0);
  } finally {
    spec.toDOM = original;
    Reflect.deleteProperty(f.editor.state.schema.cached, 'domSerializer');
    f.editor.destroy();
  }
});

it.each(['raw parent', 'marker attributes'])(
  'preflights %s before any serializer callback',
  async (kind) => {
    const left = kind === 'raw parent' ? 'a'.repeat(4097 - literal.length - 1) : 'ab';
    const f = await fixture(left, 'b');
    const input = f.select(1, f.editor.state.doc.content.size - 1);
    const spec = f.editor.state.schema.nodes.paragraph.spec,
      original = spec.toDOM;
    let calls = 0;
    try {
      if (kind === 'raw parent') {
        expect(f.projection.source.length).toBe(4097);
        expect(f.editor.state.doc.firstChild!.content.size).toBeLessThan(4096);
      } else {
        const attrs = f.editor.state.doc.nodeAt(left.length + 1)!.attrs;
        Reflect.set(attrs, 'commentId', 'x'.repeat(4097));
        Reflect.set(attrs, 'id', 'x'.repeat(4097) + ':point');
      }
      Reflect.deleteProperty(f.editor.state.schema.cached, 'domSerializer');
      spec.toDOM = () => {
        calls++;
        return ['p', 0];
      };
      expect(() => captureNoteMarkerSelection(f.editor.view, input)).toThrow();
      expect(calls).toBe(0);
    } finally {
      spec.toDOM = original;
      Reflect.deleteProperty(f.editor.state.schema.cached, 'domSerializer');
      f.editor.destroy();
    }
  },
);
