import { describe, it, expect, vi } from 'vitest';

import { applyExternalUpdateHtmlToEditorPreservingCursor } from '../external-update-editor';

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

describe('external-update-editor', () => {
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
