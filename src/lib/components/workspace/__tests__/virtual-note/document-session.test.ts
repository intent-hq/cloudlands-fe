import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { SourceProjection } from './source-projection';
import { SourceJournal, fixture, LIMITS, mapSelection, type Event } from './source-journal';
const schema = new Schema({
  nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} },
  marks: { bold: {}, link: { attrs: { href: {} } } },
});
const range = (n: number) => ({ anchor: n, head: n, affinity: 1 as const, revision: 1 });
const event = (from: number, insert = 'x'): Event => ({
  changes: [{ from, to: from, insert, removed: '' }],
  before: range(from),
  after: range(from + insert.length),
  anchorsBefore: [],
  anchorsAfter: [],
});

describe('exact source provenance', () => {
  const original =
    'café 🌍 repeated repeated [link](https://example.test)\n \n\nsecond repeated\n\n* untouched\n- markers\n';
  it('insertion, bold and join preserve independently specified Markdown including unrelated syntax', () => {
    let source = original;
    const apply = (make: (p: SourceProjection, t: Transform) => Transform) => {
      const p = new SourceProjection(source),
        t = make(p, new Transform(schema.nodeFromJSON(p.content)));
      for (const step of t.steps)
        for (const s of p.translate(step, t.before))
          source = source.slice(0, s.from) + s.insert + source.slice(s.to);
    };
    apply((p, t) => t.insert(p.pmAt(8), schema.text('NEW ')));
    expect(source).toBe(
      'café 🌍 NEW repeated repeated [link](https://example.test)\n \n\nsecond repeated\n\n* untouched\n- markers\n',
    );
    apply((p, t) => t.addMark(p.pmAt(12), p.pmAt(20), schema.marks.bold.create()));
    expect(source).toBe(
      'café 🌍 NEW **repeated** repeated [link](https://example.test)\n \n\nsecond repeated\n\n* untouched\n- markers\n',
    );
    apply((p, t) => t.delete(p.pmAt(source.indexOf('\n')), p.pmAt(source.indexOf('second'))));
    expect(source).toBe(
      'café 🌍 NEW **repeated** repeated [link](https://example.test)second repeated\n\n* untouched\n- markers\n',
    );
  });
  it('reverse affinity survives a nonoverlapping earlier insertion', () => {
    expect(
      mapSelection(
        { anchor: 20, head: 12, affinity: -1, revision: 1 },
        { from: 2, to: 2, insert: '🌍' },
        2,
      ),
    ).toEqual({ anchor: 22, head: 14, affinity: -1, revision: 2 });
  });
});

describe('backing source and separately paged journal', () => {
  it('has bounded random reads without materializing intervening source records', () => {
    const generated: number[] = [];
    const store = new SourceJournal((id) => {
      generated.push(id);
      return fixture(id);
    });
    generated.length = 0;
    expect(store.read(store.start(9999), store.length).source).toBe(fixture(9999));
    expect(generated).toEqual([9999]);
    expect(store.maxRead).toBeLessThanOrEqual(4096);
  });
  it('groups 1000 inserts into one event, streaming undo pages without a lifetime edit limit', () => {
    const store = new SourceJournal();
    for (let i = 0; i < 1000; i++) {
      store.apply(event(i).changes[0]);
      store.record(event(i), i > 0);
    }
    store.save();
    expect(store.depth).toBe(1);
    for (const c of store.changes(0, true))
      store.apply({ from: c.from, to: c.from + c.insert.length, insert: c.removed });
    expect(store.region(0)).toBe(fixture(0));
    expect(store.stats.journalPages).toBe(1000);
    expect(store.stats.maxJournalRead).toBeLessThanOrEqual(LIMITS.journalPage);
  });
  it('rolls history at the native 100-event horizon plus 20-event overflow', () => {
    const store = new SourceJournal();
    for (let i = 0; i < 121; i++) store.record(event(i), false);
    expect(store.depth).toBe(100);
    expect(store.event(0).before.anchor).toBe(21);
    expect([...store.changes(99)][0].from).toBe(120);
  });
  it('lost acknowledgement retry applies exactly once; stale/conflicting writes retain drafts and history', () => {
    const store = new SourceJournal();
    const splice = { from: 3, to: 3, insert: 'X' };
    store.loseAcknowledgement = true;
    expect(() => store.commit('one', 1, splice)).toThrow('Acknowledgement lost');
    expect(store.commit('one', 1, splice)).toBe(2);
    store.record(event(3, 'X'), false);
    expect(() => store.commit('conflict', 1, splice)).toThrow('Write conflict');
    expect(store.writes).toBe(1);
    expect(store.region(0)).toBe(
      'RegXion 0000 — café 🌍. repeated repeated [link](https://example.test).\n\n',
    );
    expect(store.dirty).toEqual([0]);
    expect(store.depth).toBe(1);
  });
  it('bounds receipt and diagnostic retention independently', () => {
    const store = new SourceJournal();
    for (let i = 0; i < 100; i++) {
      store.commit(String(i), store.revision, { from: 0, to: 0, insert: 'x' });
      store.read(0, 1);
    }
    expect(store.stats.receiptCount).toBe(32);
    expect(store.stats.logCount).toBe(32);
  });
  it('rejects stale source revision and annotation generation', () => {
    const store = new SourceJournal();
    const original = store.annotations(0, 200, 1, 1);
    expect(original.items).toHaveLength(1);
    store.generation++;
    expect(() => store.annotations(0, 200, 1, 1)).toThrow('Stale annotations');
    store.apply({ from: 0, to: 0, insert: 'x' });
    expect(() => store.read(0, 1, 1)).toThrow('Stale source');
  });
});

it('rebases paged inverse history and bookmarks after an earlier nonoverlapping insertion', () => {
  const store = new SourceJournal();
  const from = store.start(9999);
  store.apply(event(from, 'draft').changes[0]);
  store.record(event(from, 'draft'), false);
  const remote = { from: 0, to: 0, insert: 'earlier' };
  store.apply(remote);
  store.rebase(remote);
  expect(store.event(0).before.anchor).toBe(from + 7);
  const change = [...store.changes(0)][0];
  store.apply({
    from: change.from,
    to: change.from + change.insert.length,
    insert: change.removed,
  });
  expect(store.region(9999)).toBe(fixture(9999));
  expect(store.region(0)).toBe('earlier' + fixture(0));
});

it('bold toggle removes only its exact delimiters and retains surrounding source', () => {
  const source = 'before **café 🌍** after\n \n[link](https://example.test)\n';
  const projection = new SourceProjection(source),
    doc = schema.nodeFromJSON(projection.content);
  const tr = new Transform(doc).removeMark(8, 15, schema.marks.bold);
  let result = source;
  for (const splice of projection.translate(tr.steps[0], doc))
    result = result.slice(0, splice.from) + splice.insert + result.slice(splice.to);
  expect(result).toBe('before café 🌍 after\n \n[link](https://example.test)\n');
});

it('cutting from inside a link across a seam preserves the surviving link prefix and destination', () => {
  const source = 'before [link](https://example.test).\n\ncontinuation\n\n';
  const projection = new SourceProjection(source),
    doc = schema.nodeFromJSON(projection.content);
  const tr = new Transform(doc).delete(
    projection.pmAt(source.indexOf('nk')),
    projection.pmAt(source.indexOf('continuation') + 4),
  );
  let result = source;
  for (const splice of projection.translate(tr.steps[0], doc))
    result = result.slice(0, splice.from) + splice.insert + result.slice(splice.to);
  expect(result).toBe('before [li](https://example.test)inuation\n\n');
});

it('a seam-spanning source anchor moves after insertion and disappears when fully deleted', () => {
  const store = new SourceJournal();
  const original = { ...store.anchors[0] };
  expect(original.from).toBeLessThan(store.start(1));
  expect(original.to).toBeGreaterThan(store.start(1));
  store.apply({ from: 0, to: 0, insert: 'prefix ' });
  expect(store.anchors[0]).toEqual({ ...original, from: original.from + 7, to: original.to + 7 });
  store.apply({ from: original.from + 7, to: original.to + 7, insert: '' });
  expect(store.annotations(0, 200, store.revision, store.generation).items).toEqual([]);
});

it('a collapsed caret after a link emits an insertion, never a reversed source range', () => {
  const source = 'before [li](https://example.test)after\n\n';
  const projection = new SourceProjection(source),
    doc = schema.nodeFromJSON(projection.content);
  const offset = source.indexOf('after');
  const tr = new Transform(doc).insert(projection.pmAt(offset), schema.text('NEW'));
  expect(projection.translate(tr.steps[0], doc)).toEqual([
    { from: offset, to: offset, insert: 'NEW' },
  ]);
});

it('invalid source intervals cannot corrupt a draft', () => {
  const store = new SourceJournal();
  expect(() => store.apply({ from: 10, to: 2, insert: 'bad' })).toThrow('Invalid source range');
  expect(store.region(0)).toBe(fixture(0));
  expect(store.revision).toBe(1);
});

// Review regressions: expectations are independently specified source and PM results.
describe('source conservation after every accepted edit', () => {
  for (const kind of ['literal', 'bold-end', 'partial-bold', 'bold-link', 'bold-split'])
    it(`persists and reloads ${kind}`, () => {
      let source =
        kind === 'bold-link'
          ? '[link](https://example.test)\n\n'
          : '**Region** café 🌍 repeated repeated\n\n';
      let doc = schema.nodeFromJSON(new SourceProjection(source).content);
      const edit = (run: (t: Transform) => Transform) => {
        const t = run(new Transform(doc));
        for (let i = 0; i < t.steps.length; i++) {
          const p = new SourceProjection(source);
          for (const s of p.translate(t.steps[i], t.docs[i]))
            source = source.slice(0, s.from) + s.insert + source.slice(s.to);
        }
        doc = t.doc;
        expect(schema.nodeFromJSON(new SourceProjection(source).content).toJSON()).toEqual(
          doc.toJSON(),
        );
      };
      if (kind === 'literal') {
        let pos = 1;
        for (const c of 'a**b**c ') edit((t) => t.insert(pos++, schema.text(c)));
        expect(source).toBe('a\\*\\*b\\*\\*c **Region** café 🌍 repeated repeated\n\n');
      } else if (kind === 'bold-end') {
        edit((t) => t.insert(7, schema.text('Z', [schema.marks.bold.create()])));
        expect(source).toBe('**RegionZ** café 🌍 repeated repeated\n\n');
      } else if (kind === 'partial-bold') {
        edit((t) => t.removeMark(3, 5, schema.marks.bold));
        expect(source).toBe('**Re**gi**on** café 🌍 repeated repeated\n\n');
      } else if (kind === 'bold-link') {
        edit((t) => t.addMark(1, 5, schema.marks.bold.create()));
        expect(source).toBe('[**link**](https://example.test)\n\n');
      } else {
        edit((t) => t.split(4));
        expect(source).toBe('**Reg**\n\n**ion** café 🌍 repeated repeated\n\n');
      }
    });
});

it('rebases each historical coordinate through intervening local edits and the redo branch', () => {
  const store = new SourceJournal();
  for (const [pos, value] of [
    [10, 'A'],
    [0, 'BBBBB'],
  ] as const) {
    store.apply(event(pos, value).changes[0]);
    store.record(event(pos, value), false);
  }
  const remote = { from: 12, to: 12, insert: 'R' };
  store.apply(remote);
  store.rebase(remote);
  for (let i = 1; i >= 0; i--) {
    for (const c of store.changes(i, true))
      store.apply({ from: c.from, to: c.from + c.insert.length, insert: c.removed });
    store.cursor--;
  }
  expect(store.region(0)).toBe(
    'Region R0000 — café 🌍. repeated repeated [link](https://example.test).\n\n',
  );
  for (let i = 0; i < 2; i++) {
    for (const c of store.changes(i)) store.apply(c);
    store.cursor++;
  }
  expect(store.region(0)).toBe(
    'BBBBBRegion R000A0 — café 🌍. repeated repeated [link](https://example.test).\n\n',
  );
});

it('pages a large replacement inverse as one undoable event', () => {
  const store = new SourceJournal(() => 'x'.repeat(3000) + '\n\n', 1);
  const change = store.apply({ from: 0, to: 3000, insert: 'y'.repeat(3000) });
  store.record({ ...event(0), changes: [change] }, false);
  for (const c of store.changes(0, true))
    store.apply({ from: c.from, to: c.from + c.insert.length, insert: c.removed });
  expect(store.region(0)).toBe('x'.repeat(3000) + '\n\n');
  for (const c of store.changes(0)) store.apply(c);
  expect(store.region(0)).toBe('y'.repeat(3000) + '\n\n');
  expect(store.stats.maxJournalRead).toBeLessThanOrEqual(LIMITS.journalPage);
});

it('keeps redo history and source unchanged when admission fails', () => {
  const store = new SourceJournal();
  const change = store.apply({ from: 0, to: 0, insert: 'A' });
  store.record({ ...event(0, 'A'), changes: [change] }, false);
  store.apply({ from: 0, to: 1, insert: '' });
  store.cursor = 0;
  const revision = store.revision,
    anchors = structuredClone(store.anchors);
  expect(() =>
    store.atomic(() => {
      const change = store.apply({ from: 2, to: 2, insert: 'X' });
      store.record({ ...event(2), changes: [change] }, false);
      throw new Error('injected storage failure');
    }),
  ).toThrow('injected storage failure');
  expect(store.region(0)).toBe(fixture(0));
  expect(store.revision).toBe(revision);
  expect(store.anchors).toEqual(anchors);
  expect(store.cursor).toBe(0);
  expect(store.depth).toBe(1);
  for (const c of store.changes(0)) store.apply(c);
  expect(store.region(0)).toBe('A' + fixture(0));
});

it('maps a remote operation through both the undo and redo chains', () => {
  const store = new SourceJournal();
  for (const [from, insert] of [
    [10, 'A'],
    [0, 'BBBBB'],
  ] as const) {
    const c = store.apply({ from, to: from, insert });
    store.record({ ...event(from, insert), changes: [c] }, false);
  }
  for (const c of store.changes(1, true))
    store.apply({ from: c.from, to: c.from + c.insert.length, insert: c.removed });
  store.cursor--;
  const remote = { from: 7, to: 7, insert: 'R' };
  store.atomic(() => {
    store.apply(remote);
    store.rebase(remote);
  });
  for (const c of store.changes(1)) store.apply(c);
  store.cursor++;
  expect(store.region(0)).toBe(
    'BBBBBRegion R000A0 — café 🌍. repeated repeated [link](https://example.test).\n\n',
  );
  for (let i = 1; i >= 0; i--) {
    for (const c of store.changes(i, true))
      store.apply({ from: c.from, to: c.from + c.insert.length, insert: c.removed });
    store.cursor--;
  }
  expect(store.region(0)).toBe(
    'Region R0000 — café 🌍. repeated repeated [link](https://example.test).\n\n',
  );
});

it('admits source and inverse pages within budget without retaining a renderer change array', () => {
  const store = new SourceJournal(() => 'x'.repeat(7000) + '\n\n', 1);
  store.atomic(() => {
    store.beginChanges();
    store.stage({ from: 0, to: 7000, insert: 'y'.repeat(7000) });
    store.record({ ...event(0), changes: [] }, false);
  });
  expect(store.depth).toBe(1);
  expect(store.stats.backingStagedJournalBytes).toBe(0);
  expect(store.maxSpliceBytes).toBeLessThanOrEqual(LIMITS.request);
  for (const c of store.changes(0, true))
    store.apply({ from: c.from, to: c.from + c.insert.length, insert: c.removed });
  expect(store.region(0)).toBe('x'.repeat(7000) + '\n\n');
  expect(store.maxJournalRead).toBeLessThanOrEqual(LIMITS.journalPage);
});
