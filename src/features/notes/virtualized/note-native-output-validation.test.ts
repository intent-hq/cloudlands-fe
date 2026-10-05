import { beforeAll, afterAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { Schema } from '@tiptap/pm/model';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import type { Workspace } from '$shared/types';
import { NoteNativeLifetime } from './note-native-lifetime';
import {
  validateNoteNativeOutput,
  UnsupportedNoteNativeOutput,
} from './note-native-output-validation';

let editor: Editor;
const lifetime = new NoteNativeLifetime();
const admission = { current: () => true };
const doc = (content: unknown[]) => ({ type: 'doc', content });
const paragraph = (text = 'abc', marks: unknown[] = []) => ({
  type: 'paragraph',
  content: [{ type: 'text', text, marks }],
});
beforeAll(() => {
  store.init();
  const config = createEditorConfig({
    element: null,
    content: '',
    workspace: { id: 'schema-test' } as Workspace,
    editable: false,
    useMarkdown: true,
    enableComments: false,
    enableMentions: true,
    enableNotePrimitives: true,
    onUpdate: () => {},
  });
  const extensions = (config.extensions ?? []).map((e) =>
    e.name === 'starterKit' ? e.configure({ undoRedo: false }) : e,
  );
  editor = new Editor({
    ...config,
    element: null,
    content: '',
    extensions: lifetime.extensions([...extensions, CommentAnchor]),
  });
});
afterAll(async () => {
  await lifetime.dispose(
    () => editor.destroy(),
    () => {},
  );
  store.dispose();
});
it('uses the actual configured editor schema for supported paragraph text and marks', () => {
  const input = doc([paragraph('A🦀é', [{ type: 'bold' }])]);
  const result = validateNoteNativeOutput(editor.schema, input, admission);
  expect(result.type.schema).toBe(editor.schema);
  expect(result.textContent).toBe('A🦀é');
  expect(result.firstChild!.firstChild!.marks[0].type).toBe(editor.schema.marks.bold);
  expect(input).toEqual(doc([paragraph('A🦀é', [{ type: 'bold' }])]));
});
it('accepts exact configured scalar defaults without treating default type as a domain', () => {
  expect(
    validateNoteNativeOutput(
      editor.schema,
      doc([{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'a' }] }]),
      admission,
    ).firstChild!.attrs.level,
  ).toBe(1);
  expect(() =>
    validateNoteNativeOutput(
      editor.schema,
      doc([{ type: 'heading', attrs: { level: 99 }, content: [] }]),
      admission,
    ),
  ).toThrow(UnsupportedNoteNativeOutput);
  expect(() =>
    validateNoteNativeOutput(
      editor.schema,
      doc([paragraph('a', [{ type: 'link', attrs: { href: 'https://example.com' } }])]),
      admission,
    ),
  ).toThrow(UnsupportedNoteNativeOutput);
});
it.each([
  doc([{ type: 'notConfigured' }]),
  doc([paragraph('a', [{ type: 'notConfigured' }])]),
  doc([{ type: 'paragraph', attrs: { injected: 'value' } }]),
  doc([paragraph('a', [{ type: 'bold', attrs: { injected: true } }])]),
  doc([{ type: 'paragraph', unexpected: true }]),
  doc([{ type: 'text', text: 'root text' }]),
  doc([{ type: 'paragraph', content: [{ type: 'paragraph' }] }]),
  doc([paragraph('a', [{ type: 'bold' }, { type: 'bold' }])]),
  doc([paragraph('a', [{ type: 'code' }, { type: 'bold' }])]),
  doc([{ type: 'paragraph', content: [{ type: 'text', text: '' }] }]),
  doc([paragraph('\uD800')]),
  { ...doc([]), marks: [{ type: 'bold' }] },
])('refuses unsupported or malformed configured-schema output %#', (input) => {
  expect(() => validateNoteNativeOutput(editor.schema, input, admission)).toThrow();
});
it('validates attributes with actual schema type/function domains and required fields', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph*' },
      paragraph: {
        content: 'text*',
        attrs: {
          count: { validate: 'number' },
          tone: {
            default: 'normal',
            validate: (v) => {
              if (v !== 'normal' && v !== 'quiet') throw new Error('tone');
            },
          },
        },
      },
      text: {},
    },
  });
  const input = doc([
    {
      type: 'paragraph',
      attrs: { count: 2, tone: 'quiet' },
      content: [{ type: 'text', text: 'x' }],
    },
  ]);
  expect(validateNoteNativeOutput(schema, input, admission).firstChild!.attrs).toEqual({
    count: 2,
    tone: 'quiet',
  });
  for (const attrs of [
    { tone: 'quiet' },
    { count: '2' },
    { count: 2, tone: 'loud' },
    { count: Infinity },
  ])
    expect(() =>
      validateNoteNativeOutput(schema, doc([{ type: 'paragraph', attrs }]), admission),
    ).toThrow();
});
it('checks admission before traversal and after a configured validator callback', () => {
  let reads = 0;
  const input = {
    get type() {
      reads++;
      return 'doc';
    },
  };
  expect(() => validateNoteNativeOutput(editor.schema, input, { current: () => false })).toThrow(
    'admission',
  );
  expect(reads).toBe(0);
  expect(() => validateNoteNativeOutput(editor.schema, input, admission)).toThrow('property');
  expect(reads).toBe(0);
  let current = true;
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph*' },
      paragraph: {
        attrs: {
          id: {
            validate: () => {
              current = false;
            },
          },
        },
      },
      text: {},
    },
  });
  expect(() =>
    validateNoteNativeOutput(schema, doc([{ type: 'paragraph', attrs: { id: 'x' } }]), {
      current: () => current,
    }),
  ).toThrow('admission');
});
it('bounds nodes, text, graph depth, marks and cycles before adoption', () => {
  expect(() =>
    validateNoteNativeOutput(
      editor.schema,
      doc(Array.from({ length: 4096 }, () => paragraph())),
      admission,
    ),
  ).toThrow('node budget');
  expect(() =>
    validateNoteNativeOutput(
      editor.schema,
      doc([paragraph('x'.repeat(4 * 1024 * 1024 + 1))]),
      admission,
    ),
  ).toThrow('byte budget');
  expect(() =>
    validateNoteNativeOutput(
      editor.schema,
      doc([
        paragraph(
          'a',
          Array.from({ length: 33 }, () => ({ type: 'bold' })),
        ),
      ]),
      admission,
    ),
  ).toThrow('mark budget');
  let nested: unknown = paragraph();
  for (let i = 0; i < 65; i++) nested = { type: 'blockquote', content: [nested] };
  expect(() => validateNoteNativeOutput(editor.schema, doc([nested]), admission)).toThrow(
    'graph budget',
  );
  const cyclic: { type: string; content: unknown[] } = { type: 'doc', content: [] };
  cyclic.content.push(cyclic);
  expect(() => validateNoteNativeOutput(editor.schema, cyclic, admission)).toThrow('tree');
});
it('refuses unbounded configured defaults instead of silently allocating them', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph*' },
      paragraph: { attrs: { blob: { default: 'x'.repeat(4 * 1024 * 1024 + 1) } } },
      text: {},
    },
  });
  expect(() => validateNoteNativeOutput(schema, doc([{ type: 'paragraph' }]), admission)).toThrow(
    'byte budget',
  );
});
