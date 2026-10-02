import { afterAll, beforeAll, expect, it } from 'vitest';
import { DOMParser } from '@tiptap/pm/model';
import { store } from '$store/renderer/configured-store';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';

beforeAll(() => store.init());
afterAll(() => store.dispose());

for (const [name, source, needle] of [
  [
    'large rows',
    '| Left | Right |\n| :--- | ---: |\n' +
      Array.from({ length: 2400 }, (_, row) => `| row ${row} **bold** | repeated café text |`).join(
        '\n',
      ),
    'row 1200',
  ],
  [
    'oversized cell',
    '| H | R |\n| --- | --- |\n| ' + 'long café '.repeat(120000) + 'TARGET | right |',
    'TARGET',
  ],
  [
    'many columns',
    '| ' +
      Array.from({ length: 2000 }, (_, col) => `header ${col}`).join(' | ') +
      ' |\n| ' +
      Array(2000).fill('---').join(' | ') +
      ' |\n| ' +
      Array.from({ length: 2000 }, (_, col) => `cell ${col}`).join(' | ') +
      ' |',
    'cell 1000',
  ],
] as const) {
  it(`keeps native cells and exact source under bounded admission for ${name}`, async () => {
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    const at = source.indexOf(needle) + 2;
    try {
      await session.seek(at);
      const editor = session.editor!;
      editor.commands.setTextSelection(session.projection!.pmAt(at));
      expect(editor.state.selection.$from.node(2).type.name).toBe('tableRow');
      expect(editor.state.selection.$from.node(3).type.name).toBe('tableCell');
      const expected = document.createElement('div');
      expected.innerHTML = await processMarkdownToHTML('| H |\n| --- |\n| **bold** |');
      expect(DOMParser.fromSchema(editor.schema).parse(expected).firstChild!.type.name).toBe(
        'table',
      );
      editor.view.dispatch(editor.state.tr.insertText('NEW'));
      expect(session.error).toBe('');
      expect(session.selection.head).toBe(at + 3);
      expect(service.region(0) === source.slice(0, at) + 'NEW' + source.slice(at)).toBe(true);
      session.save();
      await session.seek(0);
      expect(editor.isDestroyed).toBe(true);
      await session.history();
      expect(service.region(0) === source).toBe(true);
      expect(session.selection.head).toBe(at);
      expect(
        session.editor!.state.selection.$head.parent.textContent.slice(
          session.editor!.state.selection.$head.parentOffset,
          session.editor!.state.selection.$head.parentOffset + 4,
        ),
      ).toBe(source.slice(at, at + 4));
      await session.history(true);
      expect(service.region(0) === source.slice(0, at) + 'NEW' + source.slice(at)).toBe(true);
      const stats = session.snapshot();
      expect(stats.maxSourceContextBytes).toBeLessThanOrEqual(4096);
      expect(stats.maxParsedBytes).toBeLessThanOrEqual(4096);
      expect(stats.cacheBytes).toBeLessThanOrEqual(16384);
      expect(stats.cachePages).toBeLessThanOrEqual(4);
      expect(stats.pmNodes).toBeLessThanOrEqual(256);
    } finally {
      session.destroy();
    }
  });
}

it('keeps live cell paragraphs in session history while fresh reload follows canonical Markdown', async () => {
  const source = '| H | R |\n| --- | --- |\n| beforeafter | right |';
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    const at = source.indexOf('after');
    await session.seek(at);
    const editor = session.editor!;
    editor.commands.setTextSelection(session.projection!.pmAt(at));
    expect(editor.commands.splitBlock()).toBe(true);
    expect(session.error).toBe('');
    const live = editor.state.doc.firstChild!.toJSON();
    expect(live.content![1].content![0].content).toHaveLength(2);
    expect(service.region(0)).toBe(source);
    session.save();
    await session.seek(at);
    expect(editor.isDestroyed).toBe(true);
    expect(session.editor!.state.doc.firstChild!.toJSON()).toEqual(live);
    await session.history();
    expect(session.editor!.state.doc.firstChild!.child(1).child(0).childCount).toBe(1);
    await session.history(true);
    expect(session.editor!.state.doc.firstChild!.toJSON()).toEqual(live);
    const fresh = new DocumentSession(
      new SourceJournal(() => service.region(0), 1),
      document.createElement('div'),
    );
    try {
      await fresh.seek(at);
      expect(fresh.editor!.state.doc.firstChild!.child(1).child(0).childCount).toBe(1);
    } finally {
      fresh.destroy();
    }
  } finally {
    session.destroy();
  }
});

it('retains empty native paragraphs and exact caret through eviction and history', async () => {
  const source = '| H | R |\n| --- | --- |\n| beforeafter | right |';
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(source.indexOf('after'));
    session.editor!.commands.setTextSelection(session.projection!.pmAt(source.indexOf('after')));
    session.editor!.commands.splitBlock();
    session.editor!.commands.splitBlock();
    expect(session.error).toBe('');
    const live = session.editor!.state.doc.toJSON();
    const selection = session.editor!.state.selection.toJSON();
    expect(live.content![0].content![1].content![0].content).toHaveLength(3);
    const old = session.editor!;
    await session.seek(session.selection.head);
    expect(old.isDestroyed).toBe(true);
    expect(session.editor!.state.doc.toJSON()).toEqual(live);
    expect(session.editor!.state.selection.toJSON()).toEqual(selection);
    await session.history();
    await session.history(true);
    expect(session.editor!.state.doc.toJSON()).toEqual(live);
    expect(session.editor!.state.selection.toJSON()).toEqual(selection);
  } finally {
    session.destroy();
  }
});

it('defers native Tab across the logical crop edge without appending an artificial row', async () => {
  const source =
    '| ' +
    Array.from({ length: 80 }, (_, n) => `H${n}`).join(' | ') +
    ' |\n| ' +
    Array(80).fill('---').join(' | ') +
    ' |\n| ' +
    Array.from({ length: 80 }, (_, n) => `C${n}`).join(' | ') +
    ' |';
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(source.indexOf('C40'));
    const entry = session.projection!.table!.entries.at(-1)!;
    session.editor!.commands.setTextSelection(entry.paragraph + 1);
    let release!: () => void;
    session.delayFetch = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    session.editor!.view.someProp('handleKeyDown', (handler) =>
      handler(session.editor!.view, new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })),
    );
    expect(service.region(0)).toBe(source);
    expect(service.pendingInputs).toBe(1);
    session.delayFetch = undefined;
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.error).toBe('');
    expect(service.pendingInputs).toBe(0);
    expect(session.editor!.state.selection.$head.parent.textContent).toBe(
      `C${entry.cell.column + 1}`,
    );
    expect(service.region(0)).toBe(source);
  } finally {
    session.destroy();
  }
});

it('matches the real canonical parser for admitted table marks, escapes and alignment', async () => {
  const source =
    '| **head** | _head_ | code | link |\n| :--- | :---: | ---: | --- |\n| **bold** and *italic* | escaped \\| pipe and \\\\ slash | `a\\|b` | [link](https://example.com) |';
  const session = new DocumentSession(
    new SourceJournal(() => source, 1),
    document.createElement('div'),
  );
  try {
    await session.seek(source.indexOf('bold'));
    const dom = document.createElement('div');
    dom.innerHTML = await processMarkdownToHTML(source);
    const native = DOMParser.fromSchema(session.editor!.schema).parse(dom).firstChild!;
    for (const needle of ['bold', 'escaped', '`a', '[link]']) {
      await session.seek(source.indexOf(needle));
      for (const entry of session.projection!.table!.entries) {
        expect(session.editor!.state.doc.nodeAt(entry.pm)!.toJSON()).toEqual(
          native.child(entry.cell.row).child(entry.cell.column).toJSON(),
        );
      }
    }
  } finally {
    session.destroy();
  }
});

it('preserves Enter inside an oversized cell across eviction with bounded structural context', async () => {
  const source =
    '| H |\n| --- |\n| ' + 'before '.repeat(30000) + 'TARGET ' + 'after '.repeat(30000) + '|';
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  const at = source.indexOf('TARGET');
  try {
    await session.seek(at);
    session.editor!.commands.setTextSelection(session.projection!.pmAt(at));
    session.editor!.commands.splitBlock();
    expect(session.error).toBe('');
    const live = session.editor!.state.selection.$head.parent.textContent.slice(0, 6);
    expect(live).toBe('TARGET');
    const old = session.editor!;
    await session.seek(at);
    expect(old.isDestroyed).toBe(true);
    expect(session.editor!.state.selection.$head.parentOffset).toBe(0);
    expect(session.editor!.state.selection.$head.parent.textContent.slice(0, 6)).toBe('TARGET');
    expect(session.editor!.state.selection.$head.index(3)).toBe(1);
    expect(service.region(0)).toBe(source);
    await session.history();
    expect(session.editor!.state.selection.$head.index(3)).toBe(0);
    await session.history(true);
    expect(session.editor!.state.selection.$head.index(3)).toBe(1);
    expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(4096);
  } finally {
    session.destroy();
  }
});

it('appends only at the true table end and selects logical column zero in the new row', async () => {
  const source =
    '| ' +
    Array.from({ length: 80 }, (_, n) => `H${n}`).join(' | ') +
    ' |\n| ' +
    Array(80).fill('---').join(' | ') +
    ' |\n| ' +
    Array.from({ length: 80 }, (_, n) => `C${n}`).join(' | ') +
    ' |';
  const service = new SourceJournal(() => source, 1),
    session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(source.indexOf('C79'));
    session.editor!.commands.setTextSelection(session.projection!.pmAt(source.indexOf('C79')));
    session.editor!.view.someProp('handleKeyDown', (handler) =>
      handler(session.editor!.view, new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.error).toBe('');
    const selected = session.projection!.table!.entries.find(
      (e) => e.cell.from === session.selection.table!.head.cell,
    )!;
    expect(selected.cell.row).toBe(2);
    expect(selected.cell.column).toBe(0);
    expect(service.region(0).startsWith(source)).toBe(true);
    const dom = document.createElement('div');
    dom.innerHTML = await processMarkdownToHTML(service.region(0));
    const table = DOMParser.fromSchema(session.editor!.schema).parse(dom).firstChild!;
    expect(table.childCount).toBe(3);
    expect(table.child(2).childCount).toBe(80);
    await session.history();
    expect(service.region(0)).toBe(source);
    await session.history(true);
    expect(session.selection.table!.head.cell).toBe(selected.cell.from);
  } finally {
    session.destroy();
  }
});

it('pages repeated empty paragraphs instead of retaining an ever-growing native cell', async () => {
  const source = '| H |\n| --- |\n| text |';
  const service = new SourceJournal(() => source, 1),
    session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(source.indexOf('text') + 4);
    session.editor!.commands.setTextSelection(session.projection!.pmAt(source.indexOf('text') + 4));
    for (let n = 0; n < 180; n++) {
      expect(session.editor!.commands.splitBlock()).toBe(true);
      expect(session.error).toBe('');
      await Promise.resolve();
    }
    expect(session.selection.table!.head.block).toBe(180);
    expect(service.region(0)).toBe(source);
    expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(4096);
    expect(session.snapshot().pmNodes).toBeLessThanOrEqual(256);
    const old = session.editor!;
    await session.seek(session.selection.head);
    expect(old.isDestroyed).toBe(true);
    expect(session.selection.table!.head.block).toBe(180);
    await session.history();
    await session.history(true);
    expect(session.selection.table!.head.block).toBe(180);
  } finally {
    session.destroy();
  }
});

for (const literal of ['\\', '|', '`', '\\|'])
  it(`keeps native code-cell literal ${JSON.stringify(literal)} and untouched neighboring source`, async () => {
    const source = '| H | R |\n| --- | ---: |\n| `beforeafter` | untouched **source** |';
    const service = new SourceJournal(() => source, 1),
      session = new DocumentSession(service, document.createElement('div'));
    try {
      const at = source.indexOf('after');
      await session.seek(at);
      session.editor!.commands.setTextSelection(session.projection!.pmAt(at));
      session.editor!.view.dispatch(session.editor!.state.tr.insertText(literal));
      expect(session.error).toBe('');
      expect(session.editor!.state.selection.$head.parent.textContent).toBe(
        'before' + literal + 'after',
      );
      expect(service.region(0).endsWith('| untouched **source** |')).toBe(true);
      const dom = document.createElement('div');
      dom.innerHTML = await processMarkdownToHTML(service.region(0));
      const native = DOMParser.fromSchema(session.editor!.schema).parse(dom);
      expect(native.firstChild!.child(1).child(0).toJSON()).toEqual(
        session.editor!.state.doc.firstChild!.child(1).child(0).toJSON(),
      );
      await session.seek(session.selection.head);
      await session.history();
      expect(service.region(0)).toBe(source);
      await session.history(true);
      expect(session.editor!.state.selection.$head.parent.textContent).toBe(
        'before' + literal + 'after',
      );
    } finally {
      session.destroy();
    }
  });

it('matches canonical URL sanitation for native table link marks', async () => {
  const source =
    '| H |\n| --- |\n| [unsafe](javascript:alert(1)) and [safe](https://example.com) |';
  const session = new DocumentSession(
    new SourceJournal(() => source, 1),
    document.createElement('div'),
  );
  try {
    await session.seek(source.indexOf('unsafe'));
    const dom = document.createElement('div');
    dom.innerHTML = await processMarkdownToHTML(source);
    const native = DOMParser.fromSchema(session.editor!.schema).parse(dom);
    expect(session.editor!.state.doc.firstChild!.toJSON()).toEqual(native.firstChild!.toJSON());
  } finally {
    session.destroy();
  }
});
