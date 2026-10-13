import { expect, it } from 'vitest';
import { SourceJournal } from './source-journal';
const selection = { anchor: 0, head: 0, affinity: 1 as const, revision: 1 };
const record = (s: SourceJournal) =>
  s.record(
    { changes: [], before: selection, after: selection, anchorsBefore: [], anchorsAfter: [] },
    false,
  );
const seams = (s: SourceJournal, from = 0, to = s.length) => s.inlineContext(from, to).seams ?? [];

it('rolls source and seam admission back together and rejects stale metadata', () => {
  const source = '- before\n\n- after',
    s = new SourceJournal(() => source, 1),
    from = source.indexOf('- after');
  s.setSeams(0, s.length, [{ from, kind: 'bulletList', start: 1 }], s.revision, false);
  const revision = s.revision,
    context = s.inlineContext(0, s.length);
  expect(() =>
    s.atomic(() => {
      s.beginChanges();
      s.stage({ from: 2, to: 2, insert: 'X' });
      s.setSeams(0, s.length, [], s.revision);
      throw new Error('reject');
    }),
  ).toThrow('reject');
  expect(s.region(0)).toBe(source);
  expect(s.revision).toBe(revision);
  expect(s.inlineContext(0, s.length)).toEqual(context);
  expect(s.depth).toBe(0);
  s.setSeams(0, s.length, [], s.revision, false);
  expect(() => s.inlineContext(0, s.length, revision)).toThrow('Stale');
  expect(() => s.setSeams(0, s.length, [], revision)).toThrow('Stale');
});

it('invalidating a boundary is deterministic and local undo restores its exact position', () => {
  const source = '- before\n\n- after',
    s = new SourceJournal(() => source, 1),
    from = source.indexOf('- after');
  s.setSeams(0, s.length, [{ from, kind: 'bulletList', start: 1 }], s.revision, false);
  s.beginChanges();
  s.stage({ from: from - 2, to: from + 2, insert: '' });
  record(s);
  expect(seams(s)).toEqual([]);
  expect(s.region(0)).toBe('- beforeafter');
  s.atomic(() => {
    for (const c of s.changes(0, true)) s.replay(c, false);
  });
  expect(s.region(0)).toBe(source);
  expect(seams(s)).toEqual([{ from, kind: 'bulletList', start: 1 }]);
  s.atomic(() => {
    for (const c of s.changes(0)) s.replay(c, true);
  });
  expect(seams(s)).toEqual([]);
  expect(s.region(0)).toBe('- beforeafter');
});

it('maps remote edits through seam history and rejects overlapping remote replacement atomically', () => {
  const source = '- before\n\n- after',
    s = new SourceJournal(() => source, 1),
    from = source.indexOf('- after');
  s.beginChanges();
  s.setSeams(0, s.length, [{ from, kind: 'bulletList', start: 1 }], s.revision);
  record(s);
  const remote = { from: 2, to: 2, insert: 'X' };
  s.atomic(() => {
    s.apply(remote);
    s.rebase(remote);
  });
  expect(seams(s)[0].from).toBe(from + 1);
  s.atomic(() => {
    for (const c of s.changes(0, true)) s.replay(c, false);
  });
  expect(seams(s)).toEqual([]);
  expect(s.region(0)).toBe('- Xbefore\n\n- after');
  s.atomic(() => {
    for (const c of s.changes(0)) s.replay(c, true);
  });
  expect(seams(s)[0].from).toBe(from + 1);
  const revision = s.revision;
  expect(() =>
    s.atomic(() => {
      const r = { from: from + 1, to: from + 3, insert: 'prose ' };
      s.apply(r);
      s.rebase(r);
    }),
  ).toThrow('retained list seam history');
  expect(s.revision).toBe(revision);
  expect(s.region(0)).toBe('- Xbefore\n\n- after');
  expect(seams(s)[0].from).toBe(from + 1);
});

it('pages dense boundary history and returns only window-relevant context', () => {
  const source = Array.from({ length: 600 }, (_, i) => `- item ${i}`).join('\n\n'),
    s = new SourceJournal(() => source, 1);
  const offsets = [...source.matchAll(/^- /gm)].map((m) => m.index!);
  for (const from of offsets.slice(1))
    s.setSeams(from, from + 1, [{ from, kind: 'bulletList', start: 1 }], s.revision, false);
  const at = offsets[300],
    window = s.listWindow(at - 1000, at + 1000, at),
    context = s.inlineContext(window.from, window.to);
  expect(context.seams!.length).toBeLessThanOrEqual(10);
  expect(
    new TextEncoder().encode(s.slice(window.from, window.to) + JSON.stringify(context)).byteLength,
  ).toBeLessThanOrEqual(4096);
  s.beginChanges();
  s.stage({ from: 0, to: s.length, insert: 'plain' });
  record(s);
  expect(s.stats.backingSeamCount).toBe(0);
  s.atomic(() => {
    for (const c of s.changes(0, true)) s.replay(c, false);
  });
  expect(s.region(0)).toBe(source);
  expect(s.stats.backingSeamCount).toBe(599);
  expect(s.stats.maxJournalRead).toBeLessThanOrEqual(4096);
  expect(s.stats.journalPages).toBeGreaterThan(599);
});

it('resets inherited ordered boundary ordinals at a real intervening paragraph', () => {
  const source = '7. before\n\n9. after\n\nparagraph\n\n3. final',
    s = new SourceJournal(() => source, 1),
    from = source.indexOf('9.');
  s.setSeams(0, s.length, [{ from, kind: 'orderedList', start: 9 }], s.revision, false);
  const list = s.inlineContext(0, s.length).lists!;
  expect(list.find((i) => i.from === source.indexOf('3.'))!.ordinal).toBe(3);
});

it('an invalid boundary batch restores earlier removals, source revision, and journal pages', () => {
  const source = '- before\n\n- after',
    s = new SourceJournal(() => source, 1),
    from = source.indexOf('- after');
  s.setSeams(0, s.length, [{ from, kind: 'bulletList', start: 1 }], s.revision, false);
  const revision = s.revision;
  expect(() =>
    s.setSeams(0, s.length, [{ from: 3, kind: 'orderedList', start: 7 }], s.revision),
  ).toThrow('Invalid');
  expect(s.revision).toBe(revision);
  expect(seams(s)).toEqual([{ from, kind: 'bulletList', start: 1 }]);
  expect(s.stats.backingStagedJournalBytes).toBe(0);
});

it('fault injection between history pages publishes neither partial source nor partial boundaries', () => {
  const source = Array.from({ length: 100 }, (_, i) => `- item ${i}`).join('\n\n'),
    s = new SourceJournal(() => source, 1);
  for (const match of source.matchAll(/^- /gm))
    if (match.index)
      s.setSeams(
        match.index,
        match.index + 1,
        [{ from: match.index, kind: 'bulletList', start: 1 }],
        s.revision,
        false,
      );
  s.beginChanges();
  s.stage({ from: 0, to: s.length, insert: 'plain' });
  record(s);
  const revision = s.revision;
  expect(() =>
    s.atomic(() => {
      let n = 0;
      for (const c of s.changes(0, true)) {
        s.replay(c, false);
        if (++n === 4) throw new Error('injected page failure');
      }
    }),
  ).toThrow('injected');
  expect(s.region(0)).toBe('plain');
  expect(s.revision).toBe(revision);
  expect(s.stats.backingSeamCount).toBe(0);
  s.atomic(() => {
    for (const c of s.changes(0, true)) s.replay(c, false);
  });
  expect(s.region(0)).toBe(source);
  expect(s.stats.backingSeamCount).toBe(99);
  const restoredRevision = s.revision;
  expect(() =>
    s.atomic(() => {
      let n = 0;
      for (const c of s.changes(0)) {
        s.replay(c, true);
        if (++n === 4) throw new Error('injected redo failure');
      }
    }),
  ).toThrow('injected redo');
  expect(s.region(0)).toBe(source);
  expect(s.revision).toBe(restoredRevision);
  expect(s.stats.backingSeamCount).toBe(99);
  s.atomic(() => {
    for (const c of s.changes(0)) s.replay(c, true);
  });
  expect(s.region(0)).toBe('plain');
  expect(s.stats.backingSeamCount).toBe(0);
});

it('final-state validation rolls back a malformed history page', () => {
  const s = new SourceJournal(() => '- item', 1),
    revision = s.revision;
  expect(() =>
    s.atomic(() =>
      s.replay(
        {
          from: 0,
          to: 0,
          insert: '',
          removed: '',
          seam: { before: null, after: { from: 3, kind: 'orderedList', start: 1 } },
        },
        true,
      ),
    ),
  ).toThrow('Invalid final');
  expect(s.revision).toBe(revision);
  expect(s.stats.backingSeamCount).toBe(0);
});

it('a remote marker removal invalidates its boundary while retaining unrelated local draft history', () => {
  const source = '- before\n\n- after',
    s = new SourceJournal(() => source, 1),
    from = source.indexOf('- after');
  s.setSeams(0, s.length, [{ from, kind: 'bulletList', start: 1 }], s.revision, false);
  s.beginChanges();
  s.stage({ from: 2, to: 2, insert: 'LOCAL' });
  record(s);
  const remote = { from: from + 5, to: from + 6, insert: '#' };
  s.atomic(() => {
    s.apply(remote);
    s.rebase(remote);
  });
  expect(s.region(0)).toBe('- LOCALbefore\n\n# after');
  expect(s.stats.backingSeamCount).toBe(0);
  expect(s.depth).toBe(1);
  s.atomic(() => {
    for (const c of s.changes(0, true)) s.replay(c, false);
  });
  expect(s.region(0)).toBe('- before\n\n# after');
  expect(s.stats.backingSeamCount).toBe(0);
});

it('rejects a zero-width remote insertion that invalidates retained boundary history at admission', () => {
  const source = '- before\n\n- after',
    s = new SourceJournal(() => source, 1);
  s.beginChanges();
  s.setSeams(0, s.length, [{ from: 10, kind: 'bulletList', start: 1 }]);
  record(s);
  const revision = s.revision;
  expect(() =>
    s.atomic(() => {
      const remote = { from: 10, to: 10, insert: 'prefix' };
      s.apply(remote);
      s.rebase(remote);
    }),
  ).toThrow('Conflict');
  expect(s.region(0)).toBe(source);
  expect(s.revision).toBe(revision);
  expect(s.depth).toBe(1);
  s.atomic(() => {
    for (const c of s.changes(0, true)) s.replay(c, false);
  });
  s.atomic(() => {
    for (const c of s.changes(0)) s.replay(c, true);
  });
  expect(seams(s)).toEqual([{ from: 10, kind: 'bulletList', start: 1 }]);
});
