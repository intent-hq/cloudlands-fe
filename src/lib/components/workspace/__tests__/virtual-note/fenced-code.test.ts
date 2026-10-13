import { expect, it } from 'vitest';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';

export const codeLine = '\tconst café = "**literal** [link](url) `code` \\escape 🌍";  \n';
export const fenced = (repeats = 1600) =>
  '````typescript extra-info\n' + codeLine.repeat(repeats) + '````\n\nAfter prose';

for (const repeats of [1600, 20000])
  it(`edits literal fenced code with both delimiters unloaded (${repeats} lines)`, async () => {
    const source = fenced(repeats);
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      for (const at of [30000, source.length - 6000]) {
        await session.seek(at);
        const editor = session.editor!;
        expect(editor.state.doc.firstChild!.type.name).toBe('codeBlock');
        expect(editor.state.doc.firstChild!.attrs.language).toBe('typescript');
        expect(editor.state.doc.textContent).toBe(session.projection!.source);
        expect(session.projection!.marks).toHaveLength(0);
        editor.commands.setTextSelection(session.projection!.pmAt(at));
        editor.view.dispatch(editor.state.tr.insertText(' **NEW**\t\n'));
        expect(session.error).toBe('');
        const changed = source.slice(0, at) + ' **NEW**\t\n' + source.slice(at);
        expect(service.region(0)).toBe(changed);
        session.save();
        await session.seek(0);
        expect(editor.isDestroyed).toBe(true);
        await session.history();
        expect(service.region(0)).toBe(source);
        expect(session.selection.head).toBe(at);
        await session.history(true);
        expect(service.region(0)).toBe(changed);
        await session.history();
      }
      const stats = session.snapshot();
      expect(stats.maxSourceRead).toBeLessThanOrEqual(4096);
      expect(stats.maxInlineContextBytes).toBeLessThanOrEqual(4096);
      expect(stats.maxParsedBytes).toBeLessThanOrEqual(16384);
      expect(stats.cachePages).toBeLessThanOrEqual(4);
    } finally {
      session.destroy();
    }
  });

it('keeps real opening and closing boundaries, literal syntax and exact fence spelling', async () => {
  const source = fenced();
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    for (const at of [source.indexOf('\n') + 1, source.indexOf('\n````')]) {
      await session.seek(at);
      const e = session.editor!;
      expect(e.state.doc.firstChild!.type.name).toBe('codeBlock');
      e.commands.setTextSelection(session.projection!.pmAt(at));
      e.view.dispatch(e.state.tr.insertText('\t **literal**\n'));
      expect(session.error).toBe('');
      expect(service.region(0)).toBe(source.slice(0, at) + '\t **literal**\n' + source.slice(at));
      await session.history();
      expect(service.region(0)).toBe(source);
    }
  } finally {
    session.destroy();
  }
});
it('refreshes unloaded language metadata while retaining a draft and chronological undo', async () => {
  const source = fenced();
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(30000);
    const e = session.editor!;
    e.commands.setTextSelection(session.projection!.pmAt(30000));
    e.view.dispatch(e.state.tr.insertText('A'));
    expect(session.error).toBe('');
    session.remote({ from: 4, to: 14, insert: 'text' });
    expect(session.editor!.state.doc.firstChild!.attrs.language).toBe('text');
    const remote = source.slice(0, 4) + 'text' + source.slice(14);
    expect(service.region(0)).toBe(remote.slice(0, 29994) + 'A' + remote.slice(29994));
    await session.history();
    expect(service.region(0)).toBe(remote);
    await session.history(true);
    expect(session.selection.head).toBe(29995);
  } finally {
    session.destroy();
  }
});
it('rejects delayed fenced context after local edits without losing draft/history', async () => {
  const source = fenced();
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(30000);
    const old = service.inlineContext(28000, 32096);
    let release!: () => void;
    session.delayFetch = () => new Promise((resolve) => (release = resolve));
    const pending = session.seek(60000);
    const e = session.editor!;
    e.commands.setTextSelection(session.projection!.pmAt(30000));
    e.view.dispatch(e.state.tr.insertText('Z'));
    expect(session.error).toBe('');
    release();
    expect(await pending).toBe(false);
    expect(service.region(0)).toBe(source.slice(0, 30000) + 'Z' + source.slice(30000));
    expect(() => service.inlineContext(old.from, old.to, old.revision)).toThrow(
      'Stale inline context',
    );
    session.delayFetch = undefined;
    await session.history();
    expect(service.region(0)).toBe(source);
  } finally {
    session.destroy();
  }
});
it('native Enter exits a real code end and Backspace rejoins without changing unloaded code', async () => {
  const source = '````text metadata\n' + codeLine.repeat(1600) + '\n\n````\n\nAfter prose';
  const service = new SourceJournal(() => source, 1),
    session = new DocumentSession(service, document.createElement('div'));
  try {
    const at = source.indexOf('\n````');
    await session.seek(at);
    const e = session.editor!;
    e.commands.setTextSelection(session.projection!.pmAt(at));
    e.view.someProp('handleKeyDown', (handler) =>
      handler(e.view, new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })),
    );
    expect(session.error).toBe('');
    expect(e.state.selection.$from.parent.type.name).toBe('paragraph');
    e.view.dispatch(e.state.tr.insertText('EXIT'));
    expect(session.error).toBe('');
    expect(service.region(0)).toBe(
      source.slice(0, at - 2) +
        source.slice(at, source.indexOf('After prose')) +
        'EXIT\n\nAfter prose',
    );
    await session.history();
    expect(service.region(0)).toBe(source);
  } finally {
    session.destroy();
  }
});

for (const marker of ['```', '~~~~~'])
  it(`preserves ${marker[0]} fences, empty info and literal internal backticks`, async () => {
    const source =
      marker + '\n' + '  **raw**\t`literal`\\slash 🌍\n'.repeat(4000) + marker + '  \n\nAfter';
    const service = new SourceJournal(() => source, 1),
      p = new DocumentSession(service, document.createElement('div'));
    try {
      await p.seek(30000);
      const e = p.editor!;
      expect(e.state.doc.firstChild!.type.name).toBe('codeBlock');
      expect(e.state.doc.firstChild!.attrs.language).toBe(null);
      e.commands.setTextSelection(p.projection!.pmAt(30000));
      e.view.dispatch(e.state.tr.insertText('`**[]**`'));
      expect(p.error).toBe('');
      expect(service.region(0)).toBe(source.slice(0, 30000) + '`**[]**`' + source.slice(30000));
      await p.history();
      expect(service.region(0)).toBe(source);
    } finally {
      p.destroy();
    }
  });
it('a remote overlapping code edit explicitly retains the local draft and history', async () => {
  const source = fenced(),
    service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(30000);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(30000));
    p.editor!.view.dispatch(p.editor!.state.tr.insertText('DRAFT'));
    const before = service.region(0);
    expect(() => p.remote({ from: 29999, to: 30006, insert: 'remote' })).toThrow(/Conflict/);
    expect(service.region(0)).toBe(before);
    expect(service.depth).toBe(1);
    await p.history();
    expect(service.region(0)).toBe(source);
  } finally {
    p.destroy();
  }
});
it('rejects obsolete fence metadata before replacing the live code editor', async () => {
  const source = fenced(),
    service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(30000);
    const old = p.editor;
    const context = service.inlineContext.bind(service);
    service.inlineContext = (from, to) => ({ ...context(from, to), revision: 0 });
    await expect(p.seek(60000)).rejects.toThrow('Stale inline context response');
    expect(p.editor).toBe(old);
    expect(old!.isDestroyed).toBe(false);
    expect(service.depth).toBe(0);
  } finally {
    p.destroy();
  }
});
it('supports a real document ending in fenced code and its native trailing paragraph', async () => {
  const source = '```text\n' + codeLine.repeat(1600) + '```';
  const service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(source.length);
    const e = p.editor!;
    e.commands.setTextSelection(p.projection!.pmAt(source.lastIndexOf('\n```')));
    e.view.dispatch(e.state.tr.insertText('Z'));
    expect(p.error).toBe('');
    expect(service.region(0)).toBe(source.slice(0, -4) + 'Z' + source.slice(-4));
    await p.history();
    expect(service.region(0)).toBe(source);
  } finally {
    p.destroy();
  }
});
it('remote closer removal changes the end to literal code while retaining earlier local undo', async () => {
  const source = fenced(),
    service = new SourceJournal(() => source, 1),
    p = new DocumentSession(service, document.createElement('div'));
  try {
    await p.seek(30000);
    p.editor!.commands.setTextSelection(p.projection!.pmAt(30000));
    p.editor!.view.dispatch(p.editor!.state.tr.insertText('Z'));
    const at = source.indexOf('\n````') + 1;
    p.remote({ from: at + 1, to: at + 5, insert: '' });
    await Promise.resolve();
    const expected = source.slice(0, at) + source.slice(at + 4);
    await p.seek(service.length - 5);
    expect(p.editor!.state.doc.firstChild!.type.name).toBe('codeBlock');
    expect(p.editor!.state.doc.firstChild!.textContent.endsWith('After prose')).toBe(true);
    expect(service.region(0)).toBe(expected.slice(0, 30000) + 'Z' + expected.slice(30000));
    await p.history();
    expect(service.region(0)).toBe(expected);
  } finally {
    p.destroy();
  }
});
