import { expect, it } from 'vitest';
import { SourceJournal } from './source-journal';
const selection = { anchor: 0, head: 0, affinity: 1 as const, revision: 1 };
const record = (s: SourceJournal) =>
  s.record(
    { changes: [], before: selection, after: selection, anchorsBefore: [], anchorsAfter: [] },
    false,
  );
const seams = (s: SourceJournal, from = 0, to = s.length) =>
  s.inlineContext(from, to).paragraphSeams ?? [];
const seeded = () => {
  const s = new SourceJournal(() => 'before\n\n\nafter', 1);
  s.beginChanges();
  s.setParagraphSeam({ from: 8, to: 9 }, s.revision);
  record(s);
  return s;
};
it('pages deletion boundary state, preserves source and distinguishes a fresh session', () => {
  const s = seeded();
  expect(seams(s)).toEqual([{ from: 8, to: 9 }]);
  expect(s.region(0)).toBe('before\n\n\nafter');
  s.save();
  expect(seams(new SourceJournal(() => s.region(0), 1))).toEqual([]);
  s.atomic(() => {
    for (const c of s.changes(0, true)) s.replay(c, false);
  });
  expect(seams(s)).toEqual([]);
  s.atomic(() => {
    for (const c of s.changes(0)) s.replay(c, true);
  });
  expect(seams(s)).toEqual([{ from: 8, to: 9 }]);
  expect(s.stats.maxJournalRead).toBeLessThanOrEqual(4096);
});
it('rolls source, boundary state, revision and staged history back on failure', () => {
  const s = seeded(),
    revision = s.revision,
    context = s.inlineContext(0, s.length);
  expect(() =>
    s.atomic(() => {
      s.beginChanges();
      s.stage({ from: 7, to: 10, insert: 'X' });
      record(s);
      throw Error('injected');
    }),
  ).toThrow('injected');
  expect(s.revision).toBe(revision);
  expect(s.region(0)).toBe('before\n\n\nafter');
  expect(s.inlineContext(0, s.length)).toEqual(context);
  expect(s.depth).toBe(1);
  expect(() => s.setParagraphSeam({ from: 8, to: 9 }, revision - 1)).toThrow('Stale');
  expect(() => s.setParagraphSeam({ from: 1, to: 2 }, revision)).toThrow('Invalid');
  expect(s.revision).toBe(revision);
});
it('journals local boundary invalidation and restores it chronologically', () => {
  const s = seeded();
  s.beginChanges();
  s.stage({ from: 8, to: 9, insert: 'X' });
  record(s);
  expect(seams(s)).toEqual([]);
  expect(s.region(0)).toBe('before\n\nXafter');
  s.atomic(() => {
    for (const c of s.changes(1, true)) s.replay(c, false);
  });
  expect(seams(s)).toEqual([{ from: 8, to: 9 }]);
  expect(s.region(0)).toBe('before\n\n\nafter');
  s.atomic(() => {
    for (const c of s.changes(1)) s.replay(c, true);
  });
  expect(seams(s)).toEqual([]);
});
for (const remote of [
  { from: 8, to: 8, insert: 'X' },
  { from: 8, to: 9, insert: '' },
  { from: 7, to: 10, insert: 'Y' },
])
  it(`rejects remote boundary conflicts atomically ${JSON.stringify(remote)}`, () => {
    const s = seeded(),
      revision = s.revision;
    expect(() =>
      s.atomic(() => {
        s.apply(remote);
        s.rebase(remote);
      }),
    ).toThrow('retained paragraph seam');
    expect(s.revision).toBe(revision);
    expect(s.region(0)).toBe('before\n\n\nafter');
    expect(seams(s)).toEqual([{ from: 8, to: 9 }]);
    s.atomic(() => {
      for (const c of s.changes(0, true)) s.replay(c, false);
    });
    s.atomic(() => {
      for (const c of s.changes(0)) s.replay(c, true);
    });
    expect(seams(s)).toEqual([{ from: 8, to: 9 }]);
  });
it('maps accepted remote edits through undo and retained redo without source loss', () => {
  const s = seeded();
  const remote = { from: 2, to: 2, insert: 'REMOTE' };
  s.atomic(() => {
    s.apply(remote);
    s.rebase(remote);
  });
  expect(seams(s)).toEqual([{ from: 14, to: 15 }]);
  s.atomic(() => {
    for (const c of s.changes(0, true)) s.replay(c, false);
  });
  s.cursor = 0;
  const second = { from: 0, to: 0, insert: 'Z' };
  s.atomic(() => {
    s.apply(second);
    s.rebase(second);
  });
  s.atomic(() => {
    for (const c of s.changes(0)) s.replay(c, true);
  });
  expect(seams(s)).toEqual([{ from: 15, to: 16 }]);
  expect(s.region(0)).toBe('ZbeREMOTEfore\n\n\nafter');
});
it('returns only local boundary context from a large backing seam index', () => {
  const source = Array.from({ length: 600 }, (_, n) => `paragraph${n}\n\n\n`).join('');
  const s = new SourceJournal(() => source, 1);
  for (const m of source.matchAll(/\n\n\n/g))
    s.setParagraphSeam({ from: m.index + 2, to: m.index + 3 }, s.revision, false);
  const at = source.indexOf('paragraph300');
  const context = s.inlineContext(at, at + 100);
  expect(context.paragraphSeams!.length).toBeLessThan(10);
  expect(new TextEncoder().encode(JSON.stringify(context)).length).toBeLessThanOrEqual(4096);
  expect(s.stats.backingParagraphSeamCount).toBe(600);
});
