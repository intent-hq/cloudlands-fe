import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import { describe, it, expect, vi } from 'vitest';

import {
  applyExternalUpdateHtmlToEditorPreservingCursor,
  docPosOfTextOffset,
  mapDocSelectionThroughDiff,
  textOffsetOfDocPos,
} from '../external-update-editor';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph+' },
    text: { group: 'inline' },
  },
});

const p = (text: string) => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const docOf = (...nodes: PMNode[]) => schema.node('doc', null, nodes);

/** Position of the caret after `prefix` inside `text`'s first paragraph. */
const caretAfter = (prefix: string) => 1 + prefix.length;

function mapCaret(oldDoc: PMNode, newDoc: PMNode, caret: number): number {
  return mapDocSelectionThroughDiff({ oldDoc, newDoc, anchor: caret, head: caret }).anchor;
}

function createMockEditor({
  initialHtml,
  selectionAnchor,
  docSize,
  resolve,
}: {
  initialHtml: string;
  selectionAnchor?: number;
  docSize?: number;
  resolve?: (pos: number) => { pos: number };
}) {
  const operations: Array<
    { type: 'command'; fn: (ctx: any) => any } | { type: 'setContent'; html: string }
  > = [];
  let setContentHtml: string | null = null;

  const meta: Record<string, unknown> = {};
  const tr = {
    setMeta: vi.fn((key: string, value: unknown) => {
      meta[key] = value;
    }),
    setSelection: vi.fn(),
  };

  const doc = {
    content: { size: docSize ?? 10 },
    resolve: vi.fn(resolve ?? ((pos: number) => ({ pos }))),
  };

  const ctx = {
    tr,
    state: {
      doc,
    },
  };

  const chainObj: any = {
    command(fn: any) {
      operations.push({ type: 'command', fn });
      return chainObj;
    },
    setContent(html: string) {
      operations.push({ type: 'setContent', html });
      return chainObj;
    },
    run() {
      for (const op of operations) {
        if (op.type === 'command') op.fn(ctx);
        else setContentHtml = op.html;
      }
    },
  };

  const editor = {
    getHTML: vi.fn(() => initialHtml),
    state: {
      selection: {
        anchor: selectionAnchor,
      },
    },
    chain: vi.fn(() => chainObj),
  };

  return {
    editor,
    tr,
    doc,
    meta,
    getSetContentHtml: () => setContentHtml,
  };
}

describe('doc text offsets', () => {
  it('round-trips inline positions through the plain-text offset', () => {
    const doc = docOf(p('ab'), p(''), p('cd'));
    for (const pos of [1, 2, 3, 5, 7, 8, 9]) {
      expect(docPosOfTextOffset(doc, textOffsetOfDocPos(doc, pos))).toBe(pos);
    }
  });

  it('lands inside the nested paragraph for an offset at a list item boundary', () => {
    const doc = docOf(
      p('a'),
      schema.node('bullet_list', null, [schema.node('list_item', null, [p('b')])]),
    );
    // Text: "a\nb" — offset 2 is the start of "b", whose paragraph sits inside
    // bullet_list > list_item.
    const pos = docPosOfTextOffset(doc, 2);
    expect(doc.resolve(pos).parent.inlineContent).toBe(true);
    expect(doc.textBetween(pos, pos + 1)).toBe('b');
  });

  it('clamps offsets past the end to the document size', () => {
    const doc = docOf(p('ab'));
    expect(docPosOfTextOffset(doc, 99)).toBe(doc.content.size);
  });
});

describe('mapDocSelectionThroughDiff', () => {
  it('leaves the caret where it is when the change is after it', () => {
    const oldDoc = docOf(p('hello world'));
    const newDoc = docOf(p('hello world and more'));
    const caret = caretAfter('hello');
    expect(mapCaret(oldDoc, newDoc, caret)).toBe(caret);
  });

  it('shifts the caret by the net delta when the change is before it', () => {
    const oldDoc = docOf(p('hello world'));
    const newDoc = docOf(p('well hello world'));
    expect(mapCaret(oldDoc, newDoc, caretAfter('hello w'))).toBe(caretAfter('well hello w'));
  });

  it('clamps the caret to the end of a span that replaced it', () => {
    const oldDoc = docOf(p('the quick fox'));
    const newDoc = docOf(p('the slow fox'));
    expect(mapCaret(oldDoc, newDoc, caretAfter('the qui'))).toBe(caretAfter('the slow'));
  });

  it('clamps the caret to the deletion point when a deletion spans it', () => {
    const oldDoc = docOf(p('AAAA xxxx yyyy BBBB'));
    const newDoc = docOf(p('AAAA BBBB'));
    expect(mapCaret(oldDoc, newDoc, caretAfter('AAAA xxxx y'))).toBe(caretAfter('AAAA '));
  });

  it('counts a surrogate-pair (emoji) change before the caret in UTF-16 units', () => {
    const oldDoc = docOf(p('note: done'));
    const newDoc = docOf(p('note: 🎉 done'));
    // "🎉 " is three UTF-16 code units, matching ProseMirror's position units.
    expect(mapCaret(oldDoc, newDoc, caretAfter('note: do'))).toBe(caretAfter('note: 🎉 do'));
  });

  it('maps the caret across paragraphs inserted above it', () => {
    const oldDoc = docOf(p('first'), p('second'));
    const newDoc = docOf(p('first'), p('inserted'), p('second'));
    const caret = 1 + 'first'.length + 2 + 'sec'.length;
    const mapped = mapCaret(oldDoc, newDoc, caret);
    expect(newDoc.textBetween(mapped - 3, mapped)).toBe('sec');
    expect(newDoc.resolve(mapped).parent.textContent).toBe('second');
  });

  it('maps anchor and head independently for a range selection', () => {
    const oldDoc = docOf(p('hello world'));
    const newDoc = docOf(p('oh hello world'));
    const mapped = mapDocSelectionThroughDiff({
      oldDoc,
      newDoc,
      anchor: caretAfter('hello'),
      head: caretAfter('hello wor'),
    });
    expect(mapped).toEqual({ anchor: caretAfter('oh hello'), head: caretAfter('oh hello wor') });
  });
});

describe('external-update-editor', () => {
  it('maps the selection through the diff when mapSelectionThroughDiff is set', () => {
    const oldDoc = docOf(p('hello world'));
    const newDoc = docOf(p('well hello world'));
    const tr = { setMeta: vi.fn(), setSelection: vi.fn() };
    const ctx = { tr, state: { doc: oldDoc as PMNode } };
    const chainObj: any = {
      command(fn: any) {
        chainObj.ops.push(fn);
        return chainObj;
      },
      setContent() {
        chainObj.ops.push(() => {
          ctx.state.doc = newDoc;
        });
        return chainObj;
      },
      run() {
        for (const op of chainObj.ops) op(ctx);
      },
      ops: [] as Array<(c: any) => any>,
    };
    const editor = {
      getHTML: () => '<p>hello world</p>',
      state: {
        doc: oldDoc,
        selection: { anchor: caretAfter('hello w'), head: caretAfter('hello w') },
      },
      chain: () => chainObj,
    };
    const createTextSelection = vi.fn(() => ({ selection: true }));

    const didUpdate = applyExternalUpdateHtmlToEditorPreservingCursor({
      editor,
      html: '<p>well hello world</p>',
      mapSelectionThroughDiff: true,
      createTextSelection,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(didUpdate).toBe(true);
    expect(createTextSelection).toHaveBeenCalledWith(
      newDoc,
      caretAfter('well hello w'),
      caretAfter('well hello w'),
    );
    expect(tr.setSelection).toHaveBeenCalledWith({ selection: true });
  });

  it('returns false when incoming html matches current html', () => {
    const { editor } = createMockEditor({ initialHtml: '<p>same</p>' });

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const didUpdate = applyExternalUpdateHtmlToEditorPreservingCursor({
      editor: editor as any,
      html: '<p>same</p>',
      cursorPos: 3,
      createTextSelection: vi.fn(),
      logger,
    });

    expect(didUpdate).toBe(false);
    expect(editor.chain).not.toHaveBeenCalled();
  });

  it('marks transaction meta, sets content, and restores selection (cursorPos wins)', () => {
    const { editor, tr, meta, getSetContentHtml } = createMockEditor({
      initialHtml: '<p>old</p>',
      selectionAnchor: 2,
      docSize: 10,
    });

    const createTextSelection = vi.fn((doc: any, anchor: number, head?: number) => ({
      doc,
      anchor,
      head,
    }));

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const didUpdate = applyExternalUpdateHtmlToEditorPreservingCursor({
      editor: editor as any,
      html: '<p>new</p>',
      cursorPos: 7,
      createTextSelection,
      logger,
    });

    expect(didUpdate).toBe(true);
    expect(meta['external-update']).toBe(true);
    expect(getSetContentHtml()).toBe('<p>new</p>');
    expect(createTextSelection).toHaveBeenCalled();
    expect(tr.setSelection).toHaveBeenCalled();
  });

  it('clamps cursor position to the document size', () => {
    const { editor, doc } = createMockEditor({
      initialHtml: '<p>old</p>',
      selectionAnchor: 2,
      docSize: 5,
    });

    const createTextSelection = vi.fn(() => ({ selection: true }));
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    applyExternalUpdateHtmlToEditorPreservingCursor({
      editor: editor as any,
      html: '<p>new</p>',
      cursorPos: 50,
      createTextSelection,
      logger,
    });

    expect(doc.resolve).toHaveBeenCalledWith(5);
  });

  it('logs debug if cursor restoration fails', () => {
    const { editor } = createMockEditor({
      initialHtml: '<p>old</p>',
      selectionAnchor: 1,
      resolve: () => {
        throw new Error('boom');
      },
    });

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    applyExternalUpdateHtmlToEditorPreservingCursor({
      editor: editor as any,
      html: '<p>new</p>',
      cursorPos: 1,
      createTextSelection: vi.fn(),
      logger,
    });

    expect(logger.debug).toHaveBeenCalledWith(
      '[NoteWithComments] Could not restore cursor position',
      expect.any(Error),
    );
  });
});
