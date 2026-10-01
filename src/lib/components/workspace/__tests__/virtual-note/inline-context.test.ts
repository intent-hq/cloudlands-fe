import { expect, it } from 'vitest';
import { SourceJournal } from './source-journal';
import { DocumentSession } from './document-session';

it('does not split a delimiter or link destination at either crop edge', async () => {
  const source =
    'x'.repeat(2049) +
    '[**' +
    'word '.repeat(16000).trimEnd() +
    '**](https://example.test/path) tail';
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    for (const at of [
      4098,
      4099,
      4100,
      source.indexOf('](https') - 2047,
      source.indexOf('https') - 2046,
    ]) {
      await session.seek(at);
      expect(session.editor!.getText()).not.toMatch(/[\[\]*]|https/);
      expect(session.projection!.context?.revision).toBe(service.revision);
      expect(session.snapshot().maxInlineContextBytes).toBeLessThanOrEqual(4096);
    }
  } finally {
    session.destroy();
  }
});

it('rejects a delayed context navigation after delimiter edits and rebuilds only changed backing indexes', async () => {
  const source = '**' + 'word '.repeat(16000).trimEnd() + '**';
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(20000);
    const old = service.inlineContext(18000, 22096);
    const builds = service.backingIndexBuilds;
    await session.seek(40000);
    expect(service.backingIndexBuilds).toBe(builds);
    let release!: () => void;
    session.delayFetch = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const pending = session.seek(60000);
    session.editor!.commands.setTextSelection({ from: 1801, to: 1805 });
    session.editor!.commands.unsetBold();
    expect(session.error).toBe('');
    const draft = service.region(0);
    release();
    expect(await pending).toBe(false);
    expect(service.region(0)).toBe(draft);
    expect(() => service.inlineContext(old.from, old.to, old.revision)).toThrow(
      'Stale inline context',
    );
    expect(service.backingIndexBuilds).toBeGreaterThan(builds);
    session.delayFetch = undefined;
    await session.history();
    expect(service.region(0)).toBe(source);
  } finally {
    session.destroy();
  }
});

for (const repeats of [2400, 36000])
  for (const kind of ['bold', 'link', 'combined'])
    it(`preserves ${kind} source and history in ${repeats} repeated Unicode words`, async () => {
      const text = 'repeated café 🌍 text repeated. '.repeat(repeats).trimEnd();
      const open = kind === 'bold' ? '**' : kind === 'link' ? '[' : '[**';
      const close =
        kind === 'bold'
          ? '**'
          : kind === 'link'
            ? '](https://example.test/path)'
            : '**](https://example.test/path)';
      const source = open + text + close;
      const service = new SourceJournal(() => source, 1);
      const session = new DocumentSession(service, document.createElement('div'));
      try {
        for (const at of [20000, source.length - 6000]) {
          await session.seek(at);
          const e = session.editor!;
          const marks = e.state.doc.firstChild!.firstChild!.marks.map((m) => m.type.name);
          expect(marks).toContain(kind === 'bold' ? 'bold' : 'link');
          if (kind === 'combined') expect(marks).toContain('bold');
          e.commands.setTextSelection(session.projection!.pmAt(at));
          e.commands.insertContent('NEW');
          expect(session.error).toBe('');
          expect(service.region(0)).toBe(source.slice(0, at) + 'NEW' + source.slice(at));
          session.save();
          await session.seek(0);
          await session.history();
          expect(service.region(0)).toBe(source);
          expect(session.selection.head).toBe(at);
          await session.history(true);
          expect(service.region(0)).toBe(source.slice(0, at) + 'NEW' + source.slice(at));
          await session.history();
        }
        const stats = session.snapshot();
        expect(stats.maxSourceRead).toBeLessThanOrEqual(4096);
        expect(stats.maxParsedBytes).toBeLessThanOrEqual(16384);
        expect(stats.cachePages).toBeLessThanOrEqual(4);
        expect(stats.retainedEditorStates).toBe(0);
      } finally {
        session.destroy();
      }
    });

it('refreshes visible inherited marks when a remote edit removes an unloaded opener', async () => {
  const source = '**' + 'word '.repeat(16000).trimEnd() + '**';
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(20000);
    session.editor!.commands.setTextSelection(1000);
    session.remote({ from: 0, to: 2, insert: '' });
    await Promise.resolve();
    expect(session.editor!.state.doc.firstChild!.firstChild!.marks).toHaveLength(0);
    expect(session.projection!.context?.before).toHaveLength(0);
    expect(service.region(0)).toBe(source.slice(2));
  } finally {
    session.destroy();
  }
});

it('refuses a stale context response before replacing the active editor', async () => {
  const source = '**' + 'word '.repeat(16000).trimEnd() + '**';
  const service = new SourceJournal(() => source, 1);
  const session = new DocumentSession(service, document.createElement('div'));
  try {
    await session.seek(20000);
    const editor = session.editor;
    const read = service.inlineContext.bind(service);
    service.inlineContext = (from, to) => ({ ...read(from, to), revision: 0 });
    await expect(session.seek(40000)).rejects.toThrow('Stale inline context response');
    expect(session.editor).toBe(editor);
    expect(editor!.isDestroyed).toBe(false);
    expect(service.depth).toBe(0);
  } finally {
    session.destroy();
  }
});
