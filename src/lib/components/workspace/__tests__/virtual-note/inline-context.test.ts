import { Editor } from '@tiptap/core';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
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

for (const [kind, open, close] of [
  ['bold', '**', '**'],
  ['link', '[', '](https://example.test/path)'],
  ['combined', '[**', '**](https://example.test/path)'],
]) {
  const source =
    'x'.repeat(6141) +
    open +
    'repeated café 🌍 text repeated. '.repeat(2600).trimEnd() +
    close +
    ' tail';
  const at = 6141 + open.length - 2048;
  it(`does not render an empty ${kind} span at the crop end`, async () => {
    const session = new DocumentSession(
      new SourceJournal(() => source, 1),
      document.createElement('div'),
    );
    try {
      await session.seek(at);
      const from = session.projection!.start;
      expect(session.editor!.getText()).toBe('x'.repeat(6141 - from));
      expect(
        session.projection!.tokens.every(
          (t) =>
            t.from >= from && t.to <= session.projection!.start + session.projection!.source.length,
        ),
      ).toBe(true);
    } finally {
      session.destroy();
    }
  });
  it(`accepts typing before an unloaded ${kind} opener and conserves source/history`, async () => {
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.seek(at);
      session.editor!.commands.setTextSelection(at - session.projection!.start + 1);
      session.editor!.commands.insertContent('Z');
      expect(session.error).toBe('');
      expect(service.region(0)).toBe(source.slice(0, at) + 'Z' + source.slice(at));
      expect(session.selection.head).toBe(at + 1);
      expect(service.depth).toBe(1);
      session.save();
      await session.seek(65000);
      await session.seek(at);
      await session.history();
      expect(service.region(0)).toBe(source);
      expect(session.selection.head).toBe(at);
      await session.history(true);
      expect(service.region(0)).toBe(source.slice(0, at) + 'Z' + source.slice(at));
    } finally {
      session.destroy();
    }
  });
}

for (const [kind, open, close] of [
  ['bold', '**', '**'],
  ['link', '[', '](https://example.test/path)'],
  ['combined', '[**', '**](https://example.test/path)'],
])
  it(`does not render empty inherited ${kind} at a crop starting before its closer`, async () => {
    const text = 'repeated café 🌍 text repeated. '.repeat(2600).trimEnd();
    const source = open + text + close + 'y'.repeat(6141);
    const session = new DocumentSession(
      new SourceJournal(() => source, 1),
      document.createElement('div'),
    );
    try {
      await session.seek(open.length + text.length + 2048);
      const native = new Editor(
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
      try {
        // A punctuation-adjacent closer followed immediately by a word is literal
        // in the locked parser. Preserve that native grammar at the crop edge.
        const tail = native.getText().lastIndexOf('y'.repeat(6141));
        const offset =
          tail + session.projection!.start - (open.length + text.length + close.length);
        expect(session.editor!.getText()).toBe(
          native.getText().slice(offset, offset + session.projection!.source.length),
        );
      } finally {
        native.destroy();
      }
      expect(session.projection!.context!.before).toEqual([]);
    } finally {
      session.destroy();
    }
  });

for (const prefixLength of [6141, 24573])
  for (const [kind, open, close] of [
    ['bold', '**', '**'],
    ['link', '[', '](https://example.test/path)'],
    ['combined', '[**', '**](https://example.test/path)'],
  ])
    it(`remote ${kind} opener refreshes a safe closing edge after ${prefixLength} characters`, async () => {
      const original = 'x'.repeat(prefixLength) + close + 'y'.repeat(83000);
      const expected = open + original;
      const at = prefixLength + 2048;
      const service = new SourceJournal(() => original, 1);
      const session = new DocumentSession(service, document.createElement('div'));
      try {
        await session.seek(at);
        session.editor!.commands.setTextSelection(session.projection!.pmAt(at));
        session.remote({ from: 0, to: 0, insert: open });
        const display = session.editor!.getText();
        const selected = { ...session.selection };
        session.editor!.commands.insertContent('Z');
        const position = at + open.length;
        const changed = expected.slice(0, position) + 'Z' + expected.slice(position);
        expect({ display: display.slice(0, 8), error: session.error }).toEqual({
          display: 'yyyyyyyy',
          error: '',
        });
        expect(selected.head).toBe(position);
        expect(service.region(0)).toBe(changed);
        expect(session.selection.head).toBe(position + 1);
        expect(service.depth).toBe(1);
        session.save();
        const editor = session.editor!;
        await session.seek(80000);
        expect(editor.isDestroyed).toBe(true);
        await session.seek(position);
        await session.history();
        expect(service.region(0)).toBe(expected);
        expect(session.selection.head).toBe(position);
        await session.history(true);
        expect(service.region(0)).toBe(changed);
        expect(session.selection.head).toBe(position + 1);
        expect(session.snapshot().maxSourceRead).toBeLessThanOrEqual(4096);
        expect(session.snapshot().activeBytes).toBeLessThanOrEqual(16384);
      } finally {
        session.destroy();
      }
    });

for (const [kind, open, close] of [
  ['bold', '**', '**'],
  ['link', '[', '](https://example.test/path)'],
  ['combined', '[**', '**](https://example.test/path)'],
])
  it(`remote ${kind} closer keeps the after-window refresh boundary safe`, async () => {
    const original = 'x'.repeat(6141) + open + 'y'.repeat(83000);
    const service = new SourceJournal(() => original, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      const at = 6141 + open.length - 2048;
      await session.seek(at);
      session.editor!.commands.setTextSelection(session.projection!.pmAt(at));
      session.remote({ from: original.length, to: original.length, insert: close });
      await Promise.resolve();
      const expected = original + close;
      expect(session.editor!.getText()).toBe('x'.repeat(6141 - session.projection!.start));
      expect(session.projection!.context!.revision).toBe(service.revision);
      session.editor!.commands.insertContent('Z');
      expect(session.error).toBe('');
      expect(service.region(0)).toBe(expected.slice(0, at) + 'Z' + expected.slice(at));
      expect(session.selection.head).toBe(at + 1);
      await session.history();
      expect(service.region(0)).toBe(expected);
    } finally {
      session.destroy();
    }
  });
