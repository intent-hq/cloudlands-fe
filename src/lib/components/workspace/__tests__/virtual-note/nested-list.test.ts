import { joinBackward } from '@tiptap/pm/commands';
import { DOMParser } from '@tiptap/pm/model';
import { expect, it, beforeAll, afterAll } from 'vitest';
import { store as appStore } from '$store/renderer/configured-store';
let dispose: (() => void) | undefined;
beforeAll(() => {
  dispose = appStore.init();
});
afterAll(() => dispose?.());
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';

for (const kind of ['bulletList', 'orderedList', 'taskList']) {
  it(`preserves native ${kind} ancestors and ordinals with unloaded siblings`, async () => {
    const marker = (i: number) =>
      kind === 'orderedList' ? `${17 + i}. ` : kind === 'taskList' ? '- [ ] ' : '- ';
    const lines = Array.from(
      { length: 1600 },
      (_, i) =>
        `${marker(i)}item ${String(i).padStart(4, '0')} café with repeated text and exact spelling.`,
    );
    const source = lines.join('\n');
    const at = source.indexOf('item 0800') + 5;
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.seek(at);
      const editor = session.editor!;
      const html = document.createElement('div');
      html.innerHTML = await processMarkdownToHTML(source);
      const canonical = DOMParser.fromSchema(editor.schema).parse(html);
      expect(canonical.firstChild!.type.name).toBe(kind);
      expect(canonical.firstChild!.childCount).toBe(1600);
      editor.commands.setTextSelection(session.projection!.pmAt(at));
      expect(editor.state.selection.$from.node(1).type.name).toBe(kind);
      expect(editor.state.selection.$from.parentOffset).toBe(5);
      if (kind === 'orderedList') {
        const list = editor.state.selection.$from.node(1);
        const itemIndex = editor.state.selection.$from.index(1);
        expect(list.attrs.start + itemIndex).toBe(817);
      }
      editor.view.dispatch(editor.state.tr.insertText('NEW'));
      expect(session.error).toBe('');
      expect(
        service.region(0) === source.slice(0, at) + 'NEW' + source.slice(at),
        'exact source',
      ).toBe(true);
      session.save();
      await session.seek(0);
      expect(editor.isDestroyed).toBe(true);
      await session.history();
      expect(service.region(0)).toBe(source);
      expect(session.selection.head).toBe(at);
      await session.history(true);
      expect(
        service.region(0) === source.slice(0, at) + 'NEW' + source.slice(at),
        'exact source',
      ).toBe(true);
      const stats = session.snapshot();
      expect(stats.maxSourceRead).toBeLessThanOrEqual(4096);
      expect(stats.maxInlineContextBytes).toBeLessThanOrEqual(4096);
      expect(stats.maxParsedBytes).toBeLessThanOrEqual(16384);
      expect(stats.cacheBytes).toBeLessThanOrEqual(16384);
      expect(stats.cachePages).toBeLessThanOrEqual(4);
      expect(stats.pmNodes).toBeLessThanOrEqual(256);
    } finally {
      session.destroy();
    }
  });
}

for (const repeats of [4000, 60000]) {
  it(`keeps unloaded ancestors for an oversized nested item (${repeats} words)`, async () => {
    const body = 'long café repeated text '.repeat(repeats);
    const prefix = '17. outer parent\n    - middle parent\n      - ';
    const source = prefix + body + '\n18. next root';
    const at = prefix.length + Math.floor(body.length / 2);
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.seek(at);
      const editor = session.editor!;
      const html = document.createElement('div');
      html.innerHTML = await processMarkdownToHTML(source);
      const canonical = DOMParser.fromSchema(editor.schema).parse(html);
      const expectedTypes = [
        'doc',
        'orderedList',
        'listItem',
        'bulletList',
        'listItem',
        'bulletList',
        'listItem',
        'paragraph',
      ];
      let nativePosition = 0;
      canonical.descendants((node, pos) => {
        if (node.isText && node.text === body.trimEnd()) nativePosition = pos + at - prefix.length;
      });
      const native = canonical.resolve(nativePosition);
      expect(Array.from({ length: native.depth + 1 }, (_, d) => native.node(d).type.name)).toEqual(
        expectedTypes,
      );
      editor.commands.setTextSelection(session.projection!.pmAt(at));
      const actual = editor.state.selection.$from;
      expect(Array.from({ length: actual.depth + 1 }, (_, d) => actual.node(d).type.name)).toEqual(
        expectedTypes,
      );
      expect(editor.state.doc.textContent).not.toContain('outer parent');
      expect(editor.state.doc.textContent).not.toContain('middle parent');
      editor.view.dispatch(editor.state.tr.insertText('Z'));
      expect(session.error).toBe('');
      expect(
        service.region(0) === source.slice(0, at) + 'Z' + source.slice(at),
        'exact source',
      ).toBe(true);
      await session.history();
      expect(service.region(0)).toBe(source);
      expect(session.snapshot().maxParsedBytes).toBeLessThanOrEqual(16384);
      expect(session.snapshot().listMetadataBytes).toBeLessThanOrEqual(4096);
      expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(4096);
      expect(session.snapshot().listProjectionPayloadBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
      expect(session.snapshot().sourceReplicaPayloadBytes).toBeLessThanOrEqual(256 * 1024);
    } finally {
      session.destroy();
    }
  });
}

for (const key of ['Enter', 'Tab', 'Shift-Tab', 'Backspace', 'Delete']) {
  it(`translates native list ${key} without changing unrelated items`, async () => {
    const lines = Array.from(
      { length: 1600 },
      (_, i) => `- item ${String(i).padStart(4, '0')} text preserved.`,
    );
    const source = lines.join('\n'),
      base = source.indexOf('item 0800');
    const service = new SourceJournal(() => source, 1),
      session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.seek(base);
      const editor = session.editor!;
      const at =
        key === 'Backspace' ? base : key === 'Delete' ? base + lines[800].length - 2 : base + 5;
      editor.commands.setTextSelection(session.projection!.pmAt(at));
      const event = new KeyboardEvent('keydown', {
        key: key === 'Shift-Tab' ? 'Tab' : key,
        shiftKey: key === 'Shift-Tab',
        cancelable: true,
      });
      editor.view.someProp('handleKeyDown', (h) => h(editor.view, event));
      expect(session.error).toBe('');
      let expected = source;
      if (key === 'Enter') expected = source.slice(0, at) + '\n- ' + source.slice(at);
      if (key === 'Tab') expected = source.slice(0, base - 2) + '  ' + source.slice(base - 2);
      if (key === 'Shift-Tab' || key === 'Backspace')
        expected =
          source.slice(0, base - 2) +
          '\n' +
          source.slice(base, base + lines[800].length - 2) +
          '\n' +
          source.slice(base + lines[800].length - 2);
      if (key === 'Delete') expected = source.slice(0, at) + source.slice(at + 3);
      expect(service.region(0).slice(base - 60, base + 120)).toBe(
        expected.slice(base - 60, base + 120),
      );
      expect(service.region(0) === expected, 'exact expected source').toBe(true);
    } finally {
      session.destroy();
    }
  });
}

it('indents and lifts a numbered item with native start values', async () => {
  const source = Array.from({ length: 1600 }, (_, i) => `${17 + i}. item ${i} exact text`).join(
    '\n',
  );
  const base = source.indexOf('817. item 800'),
    at = base + 5 + 6;
  const service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(at);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
    p.editor!.commands.sinkListItem('listItem');
    expect(p.error).toBe('');
    const expected = source.slice(0, base) + '     1. ' + source.slice(base + 5);
    expect(service.region(0).slice(base - 20, base + 100)).toBe(
      expected.slice(base - 20, base + 100),
    );
    expect(service.region(0) === expected).toBe(true);
    p.editor!.commands.liftListItem('listItem');
    expect(p.error).toBe('');
    expect(service.region(0).slice(base - 20, base + 100)).toBe(
      source.slice(base - 20, base + 100),
    );
    expect(service.region(0) === source).toBe(true);
  } finally {
    p.destroy();
  }
});

it('remote unloaded ancestor numbering preserves drafts, selection and chronological undo', async () => {
  const source =
    '17. parent\n' +
    Array.from(
      { length: 1600 },
      (_, i) => `    - nested ${String(i).padStart(4, '0')} exact café text unchanged.`,
    ).join('\n') +
    '\n18. after';
  const at = source.indexOf('nested 0800') + 8;
  const service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(at);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
    p.editor!.view.dispatch(p.editor!.state.tr.insertText('A').setTime(1000));
    expect(p.error).toBe('');
    p.remote({ from: 0, to: 2, insert: '27' });
    expect(p.editor!.state.doc.firstChild!.attrs.start).toBe(27);
    p.editor!.view.dispatch(p.editor!.state.tr.insertText('B').setTime(2000));
    expect(p.error).toBe('');
    const remote = '27' + source.slice(2),
      edited = remote.slice(0, at) + 'AB' + remote.slice(at);
    expect(service.region(0) === edited).toBe(true);
    p.save();
    await p.seek(0);
    await p.seek(10000);
    await p.seek(30000);
    await p.history();
    expect(service.region(0) === remote.slice(0, at) + 'A' + remote.slice(at)).toBe(true);
    await p.history();
    expect(service.region(0) === remote).toBe(true);
    await p.history(true);
    await p.history(true);
    expect(service.region(0) === edited).toBe(true);
    expect(p.selection.head).toBe(at + 2);
  } finally {
    p.destroy();
  }
});

it('stale list context and delayed navigation leave the live draft and history intact', async () => {
  const source =
    '- parent\n' +
    Array.from(
      { length: 1600 },
      (_, i) => `  - nested ${i} text intact and sufficiently long.`,
    ).join('\n');
  const at = source.indexOf('nested 800') + 6;
  const service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(at);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
    let release!: () => void;
    p.delayFetch = () => new Promise((resolve) => (release = resolve));
    const pending = p.seek(60000),
      old = p.editor;
    p.editor!.view.dispatch(p.editor!.state.tr.insertText('DRAFT'));
    expect(p.error).toBe('');
    release();
    expect(await pending).toBe(false);
    expect(p.editor).toBe(old);
    expect(service.depth).toBe(1);
    p.delayFetch = undefined;
    const context = service.inlineContext.bind(service);
    service.inlineContext = (from, to) => ({ ...context(from, to), revision: 0 });
    await expect(p.seek(60000)).rejects.toThrow('Stale inline context response');
    expect(p.editor).toBe(old);
    expect(old!.isDestroyed).toBe(false);
    service.inlineContext = context;
    await p.history();
    expect(service.region(0) === source).toBe(true);
  } finally {
    p.destroy();
  }
});

it('splits an oversized nested item with its marker and ancestors outside the window', async () => {
  const prefix = '- parent\n  - previous\n  - ',
    body = 'long repeated café text '.repeat(5000),
    source = prefix + body + '\n- after';
  const at = prefix.length + 30001,
    service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(at);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
    p.editor!.view.someProp('handleKeyDown', (h) =>
      h(p.editor!.view, new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })),
    );
    expect(p.error).toBe('');
    expect(service.region(0) === source.slice(0, at) + '\n  - ' + source.slice(at)).toBe(true);
    expect(p.selection.head).toBe(at + 5);
  } finally {
    p.destroy();
  }
});

it('indents the middle of an oversized item when its previous sibling is unloaded', async () => {
  const prefix = '- previous\n- ',
    body = 'long repeated café text '.repeat(5000),
    source = prefix + body + '\n- after';
  const at = prefix.length + 30001,
    service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(at);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
    expect(p.editor!.commands.sinkListItem('listItem')).toBe(true);
    expect(p.error).toBe('');
    expect(service.region(0) === source.replace('\n- long', '\n  - long')).toBe(true);
    expect(p.selection.head).toBe(at + 2);
  } finally {
    p.destroy();
  }
});

it('reindents unloaded descendants when their oversized parent is indented', async () => {
  const prefix = '- previous\n- ',
    body = 'abcdefghijklmnop'.repeat(5000),
    children = Array.from({ length: 1200 }, (_, i) => `  - child ${i} preserved text`).join('\n'),
    source = prefix + body + '\n' + children + '\n- after';
  const at = prefix.length + 30001,
    service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(at);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(at));
    p.editor!.commands.sinkListItem('listItem');
    expect(p.error).toBe('');
    const expected =
      '- previous\n  - ' +
      body +
      '\n' +
      children
        .split('\n')
        .map((line) => '  ' + line)
        .join('\n') +
      '\n- after';
    expect(service.region(0) === expected, 'descendant source structure').toBe(true);
    p.save();
    await p.seek(0);
    await p.history();
    expect(service.region(0) === source).toBe(true);
    await p.history(true);
    expect(service.region(0) === expected).toBe(true);
    expect(p.selection.head).toBe(at + 2);
  } finally {
    p.destroy();
  }
});

it('exits a real empty final item then types a paragraph without synthetic source', async () => {
  const source = '- before\n- item',
    service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(source.length);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(source.length));
    const enter = () =>
      p.editor!.view.someProp('handleKeyDown', (h) =>
        h(p.editor!.view, new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })),
      );
    enter();
    expect(p.error).toBe('');
    expect(service.region(0)).toBe(source + '\n- ');
    enter();
    expect(p.error).toBe('');
    expect(service.region(0)).toBe(source + '\n\n\n');
    p.editor!.view.dispatch(p.editor!.state.tr.insertText('NEXT'));
    expect(p.error).toBe('');
    expect(service.region(0)).toBe(source + '\n\nNEXT\n');
    expect(p.selection.head).toBe(source.length + 6);
  } finally {
    p.destroy();
  }
});

it('canonical parser preserves a nested ordered list start independently of the proof', async () => {
  const html = await processMarkdownToHTML('27. parent\n    - child\n28. after');
  const element = document.createElement('div');
  element.innerHTML = html;
  expect(element.querySelector('ol')?.getAttribute('start'), html).toBe('27');
});

it('a long list seek at the real document end includes the final item', async () => {
  const source = Array.from(
      { length: 1600 },
      (_, i) => `- item ${i} preserved text long enough`,
    ).join('\n'),
    service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(source.length);
    expect(p.snapshot().windowTo).toBe(source.length);
    expect(p.editor!.state.doc.textContent).toContain('item 1599');
  } finally {
    p.destroy();
  }
});

it('translates the native joinBackward transaction after lifting an item', async () => {
  const source = '- before\n- item\n- after',
    service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(11);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(11));
    p.editor!.commands.liftListItem('listItem');
    expect(p.error).toBe('');
    expect(joinBackward(p.editor!.state, (tr) => p.editor!.view.dispatch(tr))).toBe(true);
    expect(p.error).toBe('');
    expect(service.region(0)).toBe(source);
  } finally {
    p.destroy();
  }
});

it('preserves a zero-based ordered list ordinal through native editing', async () => {
  const source = '0. zero\n1. one',
    service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(5);
    expect(p.editor!.state.doc.firstChild!.attrs.start).toBe(0);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(5));
    p.editor!.commands.insertContent('Z');
    expect(service.region(0)).toBe('0. zeZro\n1. one');
    expect(p.error).toBe('');
  } finally {
    p.destroy();
  }
});

for (const source of ['- first\n+ second\n* third', '17. first\n18) second']) {
  it(`preserves canonical mixed marker groups: ${source}`, async () => {
    const service = new SourceJournal(() => source, 1),
      session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.seek(source.indexOf('second'));
      const html = document.createElement('div');
      html.innerHTML = await processMarkdownToHTML(source);
      const canonical = DOMParser.fromSchema(session.editor!.schema).parse(html);
      const actual = session.editor!.getJSON();
      expect(actual.content!.at(-1)).toEqual({ type: 'paragraph' });
      expect({ ...actual, content: actual.content!.slice(0, -1) }).toEqual(canonical.toJSON());
      session.editor!.commands.setTextSelection(
        session.projection!.pmAt(source.indexOf('second') + 3),
      );
      session.editor!.commands.insertContent('Z');
      expect(session.error).toBe('');
      expect(service.region(0)).toBe(source.replace('second', 'secZond'));
      session.save();
      await session.seek(0);
      await session.history();
      expect(service.region(0)).toBe(source);
    } finally {
      session.destroy();
    }
  });
}
