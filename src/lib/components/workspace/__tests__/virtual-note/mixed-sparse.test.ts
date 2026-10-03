import { beforeAll, afterAll, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
beforeAll(() => store.init());
afterAll(() => store.dispose());
const prefix = 'plain café 🌍\n\n- parent\n  - child\n\n```text\nfenced café 🌍\n```\n\n';
const table =
  '| H | R |\n| --- | --- |\n' +
  Array.from({ length: 800 }, (_, i) => `| cell-${i} café 🌍 | repeated |\n`).join('');
const suffix = '\nfollowing café 🌍 repeated';
const source = prefix + table + suffix;
for (const side of ['before', 'after'] as const)
  it(`admits native ${side} prose with an oversized table without hydrating its source hull`, async () => {
    const oracle = new Editor(
      createEditorConfig({
        element: document.createElement('div'),
        content: await processMarkdownToHTML(source),
        editable: true,
        useMarkdown: true,
        enableComments: false,
        enableMentions: false,
        onUpdate: () => {},
      }),
    );
    const service = new SourceJournal(() => source, 1),
      session = new DocumentSession(service, document.createElement('div'));
    const compare = () => {
      const p = session.projection!;
      expect(p.mixed).toBeDefined();
      const part = p.mixed!.parts.find((p) => p.projection.table)!.projection.table!;
      expect(part.window.cells.length).toBeLessThan(20);
      const full = oracle.getJSON();
      const expected: JSONContent = { type: 'doc', content: [] };
      const tableIndex = full.content!.findIndex((n) => n.type === 'table');
      for (const [index, node] of full.content!.entries()) {
        if (node.type === 'table') {
          const rows = [...new Set(part.window.cells.map((c) => c.row))];
          expected.content!.push({
            ...node,
            content: rows.map((row) => ({
              ...node.content![row],
              content: part.window.cells
                .filter((c) => c.row === row)
                .map((c) => node.content![row].content![c.column]),
            })),
          });
        } else if (side === 'before' ? index < tableIndex : index > tableIndex)
          expected.content!.push(node);
      }
      expect(session.editor!.getJSON()).toEqual(expected);
      expect(session.snapshot().mounted).toBe(1);
      expect(session.snapshot().cachePages).toBeLessThanOrEqual(4);
      expect(session.snapshot().maxSourceRead).toBeLessThanOrEqual(4096);
      expect(new TextEncoder().encode(p.source).length).toBeLessThanOrEqual(16384);
      expect(p.source).not.toContain('cell-400');
    };
    try {
      await session.seek(side === 'before' ? 0 : source.length - 1);
      expect(session.error).toBe('');
      compare();
      const needle = side === 'before' ? 'fenced café' : 'following café';
      const at = source.indexOf(needle) + 3;
      let nativeAt = -1;
      oracle.state.doc.descendants((node, pos) => {
        if (node.isText && node.text!.includes(needle))
          nativeAt = pos + node.text!.indexOf(needle) + 3;
      });
      oracle.commands.setTextSelection(nativeAt);
      session.editor!.commands.setTextSelection(session.projection!.pmAt(at));
      oracle.view.dispatch(oracle.state.tr.insertText('X'));
      session.editor!.view.dispatch(session.editor!.state.tr.insertText('X'));
      expect(session.error).toBe('');
      expect(service.region(0)).toBe(source.slice(0, at) + 'X' + source.slice(at));
      compare();
      const old = session.editor!;
      session.save();
      await session.seek(session.selection.head);
      expect(old.isDestroyed).toBe(true);
      compare();
      oracle.commands.undo();
      await session.history();
      expect(service.region(0)).toBe(source);
      compare();
      oracle.commands.redo();
      await session.history(true);
      compare();
    } finally {
      session.destroy();
      oracle.destroy();
    }
  });

for (const side of ['before', 'after'] as const) {
  for (const operation of ['Backspace', 'Delete', 'paste'] as const) {
    it(`matches native ${operation} at the ${side} sparse table boundary`, async () => {
      const oracle = new Editor(
        createEditorConfig({
          element: document.createElement('div'),
          content: await processMarkdownToHTML(source),
          editable: true,
          useMarkdown: true,
          enableComments: false,
          enableMentions: false,
          onUpdate: () => {},
        }),
      );
      const service = new SourceJournal(() => source, 1),
        session = new DocumentSession(service, document.createElement('div'));
      try {
        await session.seek(side === 'before' ? 0 : source.length - 1);
        const left =
          side === 'before'
            ? source.indexOf('fenced café 🌍') + 'fenced café 🌍'.length
            : prefix.length + table.lastIndexOf('repeated') + 'repeated'.length;
        const right =
          side === 'before' ? prefix.length + table.indexOf('H') : source.indexOf('following');
        const nativeAt = (logical: number) => {
          const needle =
            logical === left
              ? side === 'before'
                ? 'fenced café 🌍'
                : 'repeated'
              : side === 'before'
                ? 'H'
                : 'following';
          let at = -1;
          oracle.state.doc.descendants((n, p) => {
            if (n.isText && n.text!.includes(needle)) {
              const resolved = oracle.state.doc.resolve(p);
              if (
                needle === 'repeated' &&
                !Array.from(
                  { length: resolved.depth },
                  (_, i) => resolved.node(i + 1).type.name,
                ).includes('table')
              )
                return;
              at = p + n.text!.indexOf(needle) + (logical === left ? needle.length : 0);
            }
          });
          return at;
        };
        for (const editor of [oracle, session.editor!]) {
          const map = (n: number) =>
            editor === oracle ? nativeAt(n) : session.projection!.pmAt(n);
          editor.commands.setTextSelection(
            operation === 'paste'
              ? { from: map(left) - 1, to: map(right) + 1 }
              : map(operation === 'Backspace' ? right : left),
          );
          if (operation === 'paste') editor.commands.insertContent('PASTED');
          else editor.commands.keyboardShortcut(operation);
        }
        expect(session.error).toBe('');
        const window = session.projection!.mixed!.parts.find((p) => p.projection.table)!.projection
          .table!.window;
        const crop = (doc: JSONContent) => ({
          type: 'doc',
          content: doc.content!.flatMap((n, i, all) => {
            const tableIndex = all.findIndex((n) => n.type === 'table');
            if (n.type !== 'table')
              return (side === 'before' ? i < tableIndex : i > tableIndex) ? [n] : [];
            const rows = [...new Set(window.cells.map((c) => c.row))];
            return [
              {
                ...n,
                content: rows.map((row) => ({
                  ...n.content![row],
                  content: window.cells
                    .filter((c) => c.row === row)
                    .map((c) => n.content![row].content![c.column]),
                })),
              },
            ];
          }),
        });
        expect(session.editor!.getJSON()).toEqual(crop(oracle.getJSON()));
        expect(service.region(0)).toContain('cell-400 café 🌍');
        const nativeSelection = oracle.state.selection.toJSON();
        if (nativeSelection.type === 'cell') {
          const tableSel = session.selection.table;
          expect(tableSel?.kind).toBe('cell');
          // A native whole-table selection retains both logical endpoints,
          // including rows absent from the mounted slice.
          expect(tableSel!.anchor.cell).toBe(prefix.length + 1);
          expect(tableSel!.head.cell).toBe(prefix.length + table.lastIndexOf(' repeated '));
        }
        const old = session.editor!;
        session.save();
        await session.seek(session.selection.head);
        expect(old.isDestroyed).toBe(true);
        oracle.commands.undo();
        await session.history();
        expect(service.region(0)).toBe(source);
      } finally {
        session.destroy();
        oracle.destroy();
      }
    });
  }
}

it('paginates sparse annotations over admitted source intervals only', async () => {
  const service = new SourceJournal(() => source, 1);
  service.anchors = [
    {
      id: 'hidden',
      from: source.indexOf('cell-400'),
      to: source.indexOf('cell-400') + 5,
      alive: true,
    },
    ...Array.from({ length: 19 }, (_, i) => ({
      id: `visible-${i}`,
      from: source.indexOf('fenced'),
      to: prefix.length + table.indexOf('H') + 1,
      alive: true,
    })),
  ];
  const adapter = new Proxy(service, {
    get(t, k) {
      if (k === 'anchors') throw new Error('whole anchor map');
      const v = Reflect.get(t, k, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const session = new DocumentSession(adapter, document.createElement('div'));
  try {
    await session.seek(0);
    const ids = [];
    do {
      ids.push(...session.annotationPage!.items.map((a) => a.id));
      const next = session.annotationPage!.next;
      if (!next) break;
      await session.loadAnnotations(next);
    } while (true);
    expect(ids).toEqual(Array.from({ length: 19 }, (_, i) => `visible-${i}`));
    expect(session.snapshot().maxAnnotationPageBytes).toBeLessThanOrEqual(4096);
    expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(session.snapshot().cachePages).toBeLessThanOrEqual(4);
  } finally {
    session.destroy();
  }
});

for (const edge of ['before', 'after'] as const)
  it(`retains full table identity when native normalizes a ${edge} table node selection`, async () => {
    const service = new SourceJournal(() => source, 1),
      session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.seek(edge === 'before' ? 0 : source.length - 1);
      const part = session.projection!.mixed!.parts.find((p) => p.projection.table)!;
      session.editor!.view.dispatch(
        session.editor!.state.tr.setSelection(
          NodeSelection.create(session.editor!.state.doc, part.pm),
        ),
      );
      expect(session.error).toBe('');
      expect(session.selection.table).toEqual({
        kind: 'cell',
        anchor: { cell: prefix.length + 1, block: 0, offset: 0 },
        head: { cell: prefix.length + table.lastIndexOf(' repeated '), block: 0, offset: 0 },
      });
      const logical = structuredClone(session.selection.table),
        old = session.editor!;
      await session.seek(session.selection.head);
      expect(old.isDestroyed).toBe(true);
      expect(session.selection.table).toEqual(logical);
      expect(session.editor!.state.selection.toJSON().type).toBe('cell');
    } finally {
      session.destroy();
    }
  });
